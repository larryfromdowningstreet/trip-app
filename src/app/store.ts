// The app's state and every action that changes it. Screens read from `app` and call its methods;
// after any change, `app.changed()` re-renders.
//
// Storage: an IndexedDB table (see platform/idb). Only these sit outside the PIN-protected vault:
//   prefs  palette and day/night choice, so the lock screen can be drawn before unlocking
//   keys   this person's private keys, as non-extractable CryptoKeys the browser will not hand out
// Everything else (profile, trips, change records, tickets) is inside the vault.

import { openKV } from '../platform/idb';
import { keepData } from '../platform/device';
import { type Bytes } from '../core/bytes';
import { type Identity, type KeyId, type PublicIdentity, createIdentity, newTripKey, publicPart } from '../core/crypto';
import { openBundle, sealBundle } from '../core/bundle';
import { syncCode } from '../core/codes';
import { EnrollFailure, type Listed, type Role, makeInvite, openInvite } from '../core/enroll';
import { ChangeLog, type Vector } from '../core/log';
import { type Conflict, type TripState, addItem, deleteItem, merge, resolve, setField } from '../core/merge';
import { type Access, type ChangeRecord, type Stamp, accepts, newItemId } from '../core/model';
import type { ThemeSetting } from '../core/sun';
import { keep, lowest, missing, outgoing } from '../core/sync';
import { type KV, type Unlock, Vault } from '../core/vault';
import { type Mode, type Palette, decideMode, showTheme } from './theme';
import { type Member, type TripData, type TripMeta, dateOf, placeFor, tripDays } from './trip';

export type Route =
  | { to: 'install' } | { to: 'onboarding' } | { to: 'lock' } | { to: 'wiped' }
  | { to: 'trips' } | { to: 'newTrip' } | { to: 'settings' } | { to: 'changePin' }
  | { to: 'main' } | { to: 'overview'; day?: string } | { to: 'sync' } | { to: 'members' } | { to: 'conflicts' }
  | { to: 'edit'; item?: string; day?: string } | { to: 'driver'; item: string } | { to: 'ticket'; item: string }
  | { to: 'enroll'; join?: boolean };

export interface Prefs {
  palette: Palette;
  theme: ThemeSetting;
  mode: Mode; // last shown, for drawing the lock screen
  installSkipped?: boolean;
}

export interface OpenTrip {
  meta: TripMeta;
  data: TripData;
  log: ChangeLog;
  state: TripState;
}

interface Session {
  vault: Vault;
  me: Identity;
  trips: TripMeta[];
}

/** One sync, from choosing a role to confirming the codes match. Kept here so it survives a detour to conflicts. */
export interface SyncSession {
  role: 'collect' | 'send';
  step: number;
  heard: Record<KeyId, { added: number; have: Vector; lacking: number }>; // collector: who has been scanned
  full: boolean; // sender: send everything, not just what is new since the last sync
  result?: { added: number; rejected: number; gaps: number }; // sender: after scanning the collector
  retry?: boolean; // sender: codes did not match, scanning again
}

export interface JoinResult {
  name: string;
  joined: boolean; // a new trip on this phone, rather than new people in a trip it had
  added: string[];
  skipped: string[]; // listed in the invite but not scanned by this phone
}

export interface Ticket {
  type: string;
  bytes: Uint8Array;
}

const LOCK_AFTER_MS = 2 * 60_000;
const empty = (v: unknown) => v === undefined || v === null || v === '';
const DEFAULT_PREFS: Prefs = { palette: 'warm', theme: 'auto', mode: 'day' };
const trustFor = (role: Role) => ({ access: role === 'organizer' ? ('edit' as const) : ('view' as const) });

class App {
  kv!: KV;
  prefs: Prefs = DEFAULT_PREFS;
  session?: Session;
  trip?: OpenTrip;
  sync?: SyncSession;
  stack: Route[] = [];
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private hiddenAt = 0;
  private ownBack = false; // our own history.back() also fires popstate

  // ---- start up and re-render -------------------------------------------

  async boot(installNeeded: boolean) {
    this.kv = await openKV();
    this.prefs = { ...DEFAULT_PREFS, ...((await this.kv.get('prefs')) as Partial<Prefs> | undefined) };
    this.theme(false);
    const hasVault = await Vault.exists(this.kv);
    this.reset(hasVault ? { to: 'lock' } : installNeeded && !this.prefs.installSkipped ? { to: 'install' } : { to: 'onboarding' });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.hiddenAt = Date.now();
      else if (this.session && Date.now() - this.hiddenAt >= LOCK_AFTER_MS) this.lock();
      else this.theme(true);
    });
    addEventListener('popstate', () => (this.ownBack ? (this.ownBack = false) : this.back(true)));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.theme(true));
    setInterval(() => document.visibilityState === 'visible' && this.theme(true), 60_000);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  /** Saves in order, so two quick edits never overwrite each other on disk. */
  private save(work: () => Promise<unknown>): Promise<void> {
    const run = async () => void (await work());
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  // ---- screens ----------------------------------------------------------

  get route(): Route {
    return this.stack.at(-1) ?? { to: 'lock' };
  }

  go(route: Route) {
    this.stack.push(route);
    history.pushState(this.stack.length, '');
    this.changed();
  }

  /** Notes something about the current screen (such as the chosen day) so it is still there after going back. */
  remember(patch: Partial<Route>) {
    Object.assign(this.stack[this.stack.length - 1], patch);
  }

  /** Starts a new history, as the bottom tabs do. */
  reset(route: Route) {
    this.stack = [route];
    history.replaceState(1, '');
    this.changed();
  }

  /** Back one screen. The phone's back gesture lands here too; while locked it does nothing. */
  back(fromBrowser = false) {
    if (this.stack.length > 1 && (this.session || this.route.to !== 'lock')) {
      this.stack.pop();
      if (!fromBrowser) {
        this.ownBack = true;
        history.back();
      }
    } else if (fromBrowser) {
      history.pushState(this.stack.length, ''); // nothing to go back to: stay
    }
    this.changed();
  }

  /** Where to land after unlocking or picking a trip. */
  private home(): Route {
    return this.trip ? { to: 'main' } : { to: 'trips' };
  }

  // ---- appearance -------------------------------------------------------

  theme(animate: boolean) {
    const place = this.trip && placeFor(this.trip.state, dateOf(new Date()));
    const mode = this.session ? decideMode(this.prefs.theme, place) : this.prefs.theme === 'auto' ? this.prefs.mode : this.prefs.theme;
    showTheme(this.prefs.palette, mode, animate);
    if (mode !== this.prefs.mode) this.setPrefs({ mode }, false);
  }

  setPrefs(patch: Partial<Prefs>, redraw = true) {
    this.prefs = { ...this.prefs, ...patch };
    this.kv.set('prefs', this.prefs);
    if (redraw) {
      this.theme(true);
      this.changed();
    }
  }

  // ---- identity and lock ------------------------------------------------

  async createProfile(name: string, pin: string) {
    const me = await createIdentity(name.trim());
    const vault = await Vault.create(this.kv, pin);
    await this.kv.set('keys', { sign: me.signPrivate, enc: me.encPrivate });
    await vault.put('me', publicPart(me));
    await vault.put('trips', []);
    this.session = { vault, me, trips: [] };
    keepData();
    this.reset({ to: 'trips' });
  }

  async unlock(pin: string): Promise<Unlock> {
    const result = await Vault.unlock(this.kv, pin);
    if (!result.ok) {
      if (result.wiped) this.reset({ to: 'wiped' });
      return result;
    }
    const vault = result.vault;
    const keys = (await this.kv.get('keys')) as { sign: CryptoKey; enc: CryptoKey };
    const me = { ...(await vault.read<Identity>('me'))!, signPrivate: keys.sign, encPrivate: keys.enc };
    this.session = { vault, me, trips: (await vault.read<TripMeta[]>('trips')) ?? [] };
    const current = await vault.read<string>('current');
    if (current) await this.loadTrip(current);
    if (this.stack.length > 1 && this.route.to === 'lock') this.stack.pop(); // back to where they were
    else this.stack = [this.home()];
    this.theme(true);
    this.changed();
    return result;
  }

  lock() {
    this.session = undefined;
    this.trip = undefined;
    this.sync = undefined;
    if (this.route.to !== 'lock') this.stack.push({ to: 'lock' });
    this.changed();
  }

  async changePin(pin: string) {
    await this.session!.vault.changePin(pin);
  }

  /** "Forgot PIN": the same as removing the app's data, which anyone holding the phone could do anyway. */
  async wipe() {
    await this.kv.clear();
    this.session = undefined;
    this.trip = undefined;
    this.prefs = DEFAULT_PREFS;
    this.theme(false);
    this.reset({ to: 'onboarding' });
  }

  get me(): Identity {
    return this.session!.me;
  }

  // ---- trips ------------------------------------------------------------

  get trips(): TripMeta[] {
    return this.session?.trips ?? [];
  }

  async createTrip(name: string, start: string, end: string) {
    const { vault, me } = this.session!;
    const meta: TripMeta = { id: newItemId(), name: name.trim(), start, end, role: 'organizer', people: 1 };
    const data: TripData = {
      key: newTripKey(), members: [{ ...publicPart(me), trust: { access: 'edit' } }], records: [], batches: [], synced: {}, fresh: [],
    };
    await vault.put(`trip:${meta.id}`, data);
    await this.saveTrips([...this.trips, meta]);
    await this.openTrip(meta.id);
  }

  async openTrip(id: string) {
    await this.loadTrip(id);
    await this.session!.vault.put('current', id);
    this.reset({ to: 'main' });
    this.theme(true);
  }

  private async loadTrip(id: string) {
    const { vault, trips } = this.session!;
    const meta = trips.find((t) => t.id === id);
    const stored = meta && (await vault.read<TripData>(`trip:${id}`));
    if (!meta || !stored) return void (this.trip = undefined);
    const data: TripData = { ...stored, batches: stored.batches ?? [], synced: stored.synced ?? {}, fresh: stored.fresh ?? [] };
    const log = new ChangeLog(data.records);
    this.trip = { meta, data, log, state: this.compute(log, data.members) };
    this.sync = undefined;
  }

  private compute(log: ChangeLog, members: Member[]): TripState {
    return merge(log.all().filter(this.accepted(members)));
  }

  private accepted(members: Member[]) {
    const trust = new Map(members.map((m) => [m.id, m.trust]));
    return (r: { a: string; s: number }) => accepts(trust.get(r.a), r);
  }

  private saveTrips(trips: TripMeta[]) {
    this.session!.trips = trips;
    return this.session!.vault.put('trips', trips);
  }

  private saveTrip() {
    const { meta, data, log } = this.trip!;
    data.records = log.all();
    return this.save(() => this.session!.vault.put(`trip:${meta.id}`, data));
  }

  get isOrganizer(): boolean {
    return this.trip?.meta.role === 'organizer';
  }

  get days(): string[] {
    return this.trip ? tripDays(this.trip.meta.start, this.trip.meta.end) : [];
  }

  member(id: string): Member | undefined {
    return this.trip?.data.members.find((m) => m.id === id);
  }

  // ---- editing (each change becomes one signed-later record) -----------

  private write(build: (state: TripState, stamp: Stamp) => ChangeRecord) {
    const trip = this.trip!;
    const stamp = { a: this.me.id, s: trip.log.nextSeq(this.me.id), t: Date.now() };
    trip.log.add([build(trip.state, stamp)]);
    trip.state = this.compute(trip.log, trip.data.members);
  }

  /** New item, or only the fields that actually changed. Text fields clear to '', numbers to null. */
  async saveItem(id: string | undefined, values: Record<string, unknown>) {
    if (!id) {
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => !empty(v)));
      this.write((_, stamp) => addItem(stamp, filled));
    } else {
      const old = this.trip!.state.items.get(id)?.values ?? {};
      for (const [field, value] of Object.entries(values)) {
        if (value === old[field] || (empty(value) && empty(old[field]))) continue;
        this.write((state, stamp) => setField(state, stamp, id, field, value ?? null));
      }
    }
    await this.afterEdit();
  }

  async removeItem(id: string) {
    this.write((state, stamp) => deleteItem(state, stamp, id));
    await this.afterEdit();
  }

  async resolveConflict(conflict: Conflict, choice: ChangeRecord) {
    this.write((state, stamp) => resolve(state, stamp, conflict, choice));
    await this.afterEdit();
  }

  private async afterEdit() {
    this.theme(true); // coordinates may have changed
    this.changed();
    await this.saveTrip();
  }

  /** Blocking keeps what they did up to now and ignores anything they send later. */
  async setAccess(memberId: string, access: Access) {
    const trip = this.trip!;
    const member = trip.data.members.find((m) => m.id === memberId)!;
    member.trust = access === 'blocked' ? { access, blockedAfter: trip.log.vector()[memberId] ?? 0 } : { access };
    trip.state = this.compute(trip.log, trip.data.members);
    this.changed();
    await this.saveTrip();
  }

  // ---- sync: through one collector ------------------------------------------

  beginSync(role: SyncSession['role']) {
    this.sync = { role, step: 0, heard: {}, full: false };
    this.trip!.data.fresh = []; // "剛更新" now means: changed by others in this sync
    this.changed();
  }

  syncStep(step: number, patch: Partial<SyncSession> = {}) {
    Object.assign(this.sync!, patch, { step });
    this.changed();
  }

  endSync() {
    this.sync = undefined;
    this.changed();
  }

  /**
   * The bundle this phone shows. A sender includes what is new since its last confirmed sync (or everything);
   * a collector includes whatever the least up-to-date phone it heard from still lacks.
   */
  async shareBundle(): Promise<Bytes> {
    const { meta, data, log } = this.trip!;
    const s = this.sync!;
    const need = s.role === 'collect' ? lowest([data.synced, ...Object.values(s.heard).map((h) => h.have)]) : s.full ? {} : data.synced;
    const batches = await outgoing(meta.id, this.me, log, data.batches, need, this.accepted(data.members));
    return sealBundle(batches, data.key, { from: this.me.id, have: log.vector() });
  }

  /** Takes in a scanned bundle. Throws BundleFailure when it is not for this trip or was tampered with. */
  async takeBundle(bytes: Bytes) {
    const trip = this.trip!;
    const opened = await openBundle(bytes, trip.meta.id, trip.data.key, (id) => this.member(id)?.signKey);
    const fresh = new Set(trip.data.fresh);
    for (const r of opened.records) if (r.a !== this.me.id && !trip.log.has(r)) fresh.add(r.item);
    const added = trip.log.add(opened.records);
    trip.data.batches = keep(trip.data.batches, opened.batches, this.me.id);
    trip.data.fresh = [...fresh];
    trip.state = this.compute(trip.log, trip.data.members);
    const result = {
      from: opened.header.from,
      added,
      rejected: opened.rejected.length,
      lacking: missing(trip.log.vector(), opened.header.have), // they have things they did not send
      gaps: trip.log.gaps().reduce((n, g) => n + g.missing.length, 0),
    };
    if (this.sync?.role === 'collect' && result.from !== this.me.id) {
      this.sync.heard[result.from] = { added, have: opened.header.have, lacking: result.lacking };
    }
    await this.afterEdit();
    return result;
  }

  /** Both sides agree: remember this point, so next time only what is newer needs to travel. */
  async finishSync() {
    const trip = this.trip!;
    trip.data.synced = trip.log.vector();
    trip.meta.lastSync = Date.now();
    trip.meta.code = await syncCode(trip.state);
    await this.saveTrips(this.trips);
    await this.saveTrip();
    this.changed();
  }

  // ---- meeting face to face: whitelist and invites ---------------------------

  /** An organizer adds the people just scanned (new ones with the role picked) and makes the invite to show them. */
  async invite(scanned: { person: PublicIdentity; role: Role }[]): Promise<Bytes> {
    const { meta, data } = this.trip!;
    for (const { person, role } of scanned) {
      const known = data.members.find((m) => m.id === person.id);
      if (known) known.name = person.name;
      else data.members.push({ ...publicPart(person), trust: trustFor(role) });
    }
    meta.people = data.members.length;
    const roleOf = (m: Member): Role => scanned.find((x) => x.person.id === m.id)?.role ?? (m.trust.access === 'edit' ? 'organizer' : 'member');
    const listed: Listed[] = data.members.map((m) => ({ id: m.id, name: m.name, role: m.id === this.me.id ? 'organizer' : roleOf(m) }));
    const bytes = await makeInvite(meta, data.key, this.me, listed, scanned.map((x) => x.person));
    await this.saveTrips(this.trips);
    await this.afterEdit();
    return bytes;
  }

  /** Reads an organizer's invite. Only people this phone scanned itself are added; the rest are listed as skipped. */
  async acceptInvite(bytes: Bytes, scanned: PublicIdentity[]): Promise<JoinResult> {
    const signKeyOf = (id: KeyId) => scanned.find((p) => p.id === id)?.signKey ?? this.trip?.data.members.find((m) => m.id === id)?.signKey;
    const invite = await openInvite(bytes, signKeyOf, this.me, (id) => (this.trip?.meta.id === id ? this.trip.data.key : undefined));
    const mine = this.trips.find((t) => t.id === invite.trip);
    if (mine && this.trip?.meta.id !== mine.id) {
      await this.loadTrip(mine.id);
      await this.session!.vault.put('current', mine.id);
    }
    const others = invite.people.filter((p) => p.id !== this.me.id);
    const seen = (p: Listed) => scanned.find((x) => x.id === p.id);
    const result: JoinResult = { name: '', joined: !mine, added: [], skipped: others.filter((p) => !seen(p)).map((p) => p.name) };

    if (mine) {
      const { meta, data } = this.trip!;
      for (const p of others) {
        const person = seen(p);
        const known = data.members.find((m) => m.id === p.id);
        if (person && known) known.name = person.name;
        else if (person) (data.members.push({ ...person, trust: trustFor(p.role) }), result.added.push(person.name));
      }
      meta.people = data.members.length;
      result.name = meta.name;
      await this.saveTrips(this.trips);
      await this.afterEdit();
      return result;
    }

    if (!invite.key || !invite.info) throw new EnrollFailure('unknown-inviter'); // the organizer has not scanned this phone
    const role = invite.people.find((p) => p.id === this.me.id)?.role ?? 'member';
    const members: Member[] = [{ ...publicPart(this.me), trust: { access: 'edit' } }];
    for (const p of others) {
      const person = seen(p);
      if (person) (members.push({ ...person, trust: trustFor(p.role) }), result.added.push(person.name));
    }
    const meta: TripMeta = { id: invite.trip, ...invite.info, role, people: members.length };
    const data: TripData = { key: invite.key, members, records: [], batches: [], synced: {}, fresh: [] };
    await this.session!.vault.put(`trip:${meta.id}`, data);
    await this.saveTrips([...this.trips, meta]);
    await this.loadTrip(meta.id);
    await this.session!.vault.put('current', meta.id);
    result.name = meta.name;
    this.changed();
    return result;
  }

  /** A new nickname, also in this phone's own entry of every trip. Others see it after scanning again. */
  async rename(name: string) {
    const { vault, me, trips } = this.session!;
    me.name = name.trim();
    await vault.put('me', publicPart(me));
    for (const t of trips) {
      const data = await vault.read<TripData>(`trip:${t.id}`);
      const self = data?.members.find((m) => m.id === me.id);
      if (data && self) (self.name = me.name, await vault.put(`trip:${t.id}`, data));
    }
    if (this.trip) await this.loadTrip(this.trip.meta.id);
    this.changed();
  }

  // ---- tickets (only on this phone, never synced) -----------------------

  readTicket(item: string) {
    return this.session!.vault.read<Ticket>(`ticket:${this.trip!.meta.id}:${item}`);
  }

  saveTicket(item: string, ticket: Ticket | undefined) {
    const name = `ticket:${this.trip!.meta.id}:${item}`;
    return this.save(() => (ticket ? this.session!.vault.put(name, ticket) : this.session!.vault.remove(name)));
  }
}

export const app = new App();
