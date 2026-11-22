// Meeting face to face: identity cards, and the invite an organizer shows to bring people into a trip.
//
// Identity card (kind 0x01), safe to be photographed, holds only a nickname and public keys:
//   [kind][format 1][name length 1][name UTF-8][signing key 65][encryption key 65]
// Invite (kind 0x03), signed by the organizer showing it:
//   [kind][format 1][organizer id 8][signature 64][deflated JSON]
//   The JSON lists who is in the trip and their roles, holds the trip key encrypted separately for each
//   newcomer, and the trip's name and dates encrypted with the trip key. Nothing is parsed before the
//   signature checks out, and each phone only takes in people it has scanned with its own camera.

import { Inflate, deflateSync } from 'fflate';
import { type Bytes, concat, fromBase64, fromHex, fromUtf8, randomBytes, toBase64, toHex, utf8 } from './bytes';
import {
  type Identity, type KeyId, type PublicIdentity, importTripKey, keyIdOf, sign, unwrapTripKey, verify, wrapTripKey,
} from './crypto';
import { KINDS } from './transfer';

const FORMAT = 1;
const KEY = 65;
const ID = 8;
const SIG = 64;
const MAX_NAME = 60; // bytes
const MAX_INVITE = 16 << 10;
const MAX_INVITE_OPEN = 64 << 10;

export type Role = 'organizer' | 'member';
export const ROLES: readonly (readonly [Role, string])[] = [['organizer', '主揪'], ['member', '成員']];

export class EnrollFailure extends Error {
  constructor(readonly code: 'format' | 'too-large' | 'unknown-inviter' | 'bad-signature' | 'other-trip') {
    super(code);
  }
}

// ---- identity card --------------------------------------------------------

export function identityCard(me: PublicIdentity): Bytes {
  const name = utf8(me.name).slice(0, MAX_NAME);
  return concat([KINDS.identity, FORMAT, name.length], name, me.signKey, me.encKey);
}

export async function readIdentityCard(bytes: Bytes): Promise<PublicIdentity> {
  const fail = new EnrollFailure('format');
  if (bytes[0] !== KINDS.identity || bytes[1] !== FORMAT || bytes.length < 3) throw fail;
  const nameLength = bytes[2];
  if (bytes.length !== 3 + nameLength + 2 * KEY) throw fail;
  const name = fromUtf8(bytes.subarray(3, 3 + nameLength)).trim();
  const signKey = bytes.slice(3 + nameLength, 3 + nameLength + KEY);
  const encKey = bytes.slice(3 + nameLength + KEY);
  if (!name) throw fail;
  try {
    // Importing checks that both are real points on the curve.
    await crypto.subtle.importKey('raw', signKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    await crypto.subtle.importKey('raw', encKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch {
    throw fail;
  }
  return { id: await keyIdOf(signKey), name, signKey, encKey };
}

// ---- invite -------------------------------------------------------------------

export interface TripInfo {
  id: string;
  name: string;
  start: string;
  end: string;
}

export interface Listed {
  id: KeyId;
  name: string;
  role: Role;
}

interface InviteBody {
  v: 1;
  trip: string;
  people: Listed[];
  keys: Record<KeyId, string>;
  meta: string;
}

export interface Invite {
  trip: string;
  from: KeyId;
  people: Listed[];
  info?: Omit<TripInfo, 'id'>; // readable once the phone has the trip key
  key?: Bytes; // the trip key, if this invite brings this phone in
}

export async function makeInvite(trip: TripInfo, tripKey: Bytes, me: Identity, people: Listed[], newcomers: PublicIdentity[]): Promise<Bytes> {
  const keys: Record<KeyId, string> = {};
  for (const p of newcomers) keys[p.id] = toBase64(await wrapTripKey(tripKey, p.encKey));
  const iv = randomBytes(12);
  const info = utf8(JSON.stringify({ name: trip.name, start: trip.start, end: trip.end }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importTripKey(tripKey), info));
  const body: InviteBody = { v: 1, trip: trip.id, people, keys, meta: toBase64(concat(iv, sealed)) };
  const packed = deflateSync(utf8(JSON.stringify(body)), { level: 9 });
  const head = concat([KINDS.invite, FORMAT], fromHex(me.id));
  return concat(head, await sign(me, concat(head, packed)), packed);
}

/**
 * Checks and reads an invite. `signKeyOf` knows only people this phone trusts (scanned or already members).
 * `me` unwraps a trip key meant for this phone; `keyFor` gives the key of a trip this phone is already in.
 */
export async function openInvite(
  bytes: Bytes,
  signKeyOf: (id: KeyId) => Bytes | undefined,
  me: Identity,
  keyFor: (trip: string) => Bytes | undefined = () => undefined,
): Promise<Invite> {
  if (bytes.length > MAX_INVITE) throw new EnrollFailure('too-large');
  if (bytes[0] !== KINDS.invite || bytes[1] !== FORMAT || bytes.length < 2 + ID + SIG + 1) throw new EnrollFailure('format');
  const from = toHex(bytes.subarray(2, 2 + ID));
  const signature = bytes.slice(2 + ID, 2 + ID + SIG);
  const packed = bytes.slice(2 + ID + SIG);
  const signKey = signKeyOf(from);
  if (!signKey) throw new EnrollFailure('unknown-inviter');
  if (!(await verify(signKey, signature, concat(bytes.subarray(0, 2 + ID), packed)))) throw new EnrollFailure('bad-signature');

  const body = readBody(packed);
  if (!body || !body.people.some((p) => p.id === from && p.role === 'organizer')) throw new EnrollFailure('format');

  const invite: Invite = { trip: body.trip, from, people: body.people };
  const wrapped = body.keys[me.id];
  try {
    const key = wrapped ? await unwrapTripKey(fromBase64(wrapped), me) : keyFor(body.trip);
    if (!key) return invite;
    const meta = fromBase64(body.meta);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: meta.slice(0, 12) }, await importTripKey(key), meta.slice(12));
    const info = JSON.parse(fromUtf8(new Uint8Array(plain)));
    if (![info.name, info.start, info.end].every((x) => typeof x === 'string' && x.length <= 80)) throw new Error();
    return { ...invite, info: { name: info.name, start: info.start, end: info.end }, key: wrapped ? key : undefined };
  } catch {
    throw new EnrollFailure(wrapped ? 'format' : 'other-trip');
  }
}

function readBody(packed: Bytes): InviteBody | undefined {
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    new Inflate((chunk) => {
      size += chunk.length;
      if (size > MAX_INVITE_OPEN) throw new Error('too large');
      chunks.push(chunk);
    }).push(packed, true);
    const b = JSON.parse(fromUtf8(concat(...chunks)));
    const fine = b?.v === 1 && typeof b.trip === 'string' && b.trip.length <= 64 &&
      Array.isArray(b.people) && b.people.length <= 64 &&
      b.people.every((p: Listed) => /^[0-9a-f]{16}$/.test(p?.id) && typeof p.name === 'string' && p.name.length <= 60 &&
        (p.role === 'organizer' || p.role === 'member')) &&
      typeof b.keys === 'object' && b.keys !== null && Object.values(b.keys).every((k) => typeof k === 'string' && k.length < 400) &&
      typeof b.meta === 'string' && b.meta.length < 2000;
    return fine ? b : undefined;
  } catch {
    return undefined;
  }
}
