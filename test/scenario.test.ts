// Four organizers edit offline, then sync face to face through one collector, with every byte
// going through the same path as the app: bundle → Base45 → animated QR frames → back.

import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from '../src/core/base45';
import { type Batch, openBundle, sealBundle, signBatch } from '../src/core/bundle';
import { syncCode } from '../src/core/codes';
import { newTripKey } from '../src/core/crypto';
import { FrameCollector, toFrames } from '../src/core/frames';
import { addItem, deleteItem, setField } from '../src/core/merge';
import { type Phone, group, plain, shuffled } from './helpers';

const TRIP = 'tokyo-2027';
const tripKey = newTripKey();

/** What a phone shows: its own records signed fresh, plus other people's batches exactly as received. */
async function show(p: Phone, relayed: Map<Phone, Batch[]>): Promise<string[]> {
  const mine = p.log.all().filter((r) => r.a === p.me.id);
  const bundle = await sealBundle([await signBatch(TRIP, mine, p.me), ...(relayed.get(p) ?? [])], tripKey, { from: p.me.id, have: p.log.vector() });
  return toFrames(encodeBase45(bundle), 400);
}

/** The camera catches frames in any order, some twice. */
async function scan(p: Phone, frames: string[], relayed: Map<Phone, Batch[]>, everyone: Phone[], seed: number) {
  const collector = new FrameCollector();
  let text: string | undefined;
  for (const f of shuffled([...frames, ...frames.slice(0, 2)], seed)) text = collector.add(f)?.text ?? text;
  const keys = new Map(everyone.map((q) => [q.me.id, q.me.signKey]));
  const opened = await openBundle(decodeBase45(text!), TRIP, tripKey, (id) => keys.get(id));
  expect(opened.rejected).toEqual([]);
  p.log.add(opened.records);
  relayed.set(p, [...(relayed.get(p) ?? []), ...opened.batches.filter((b) => b.author !== p.me.id)]);
  return opened;
}

/** One collector round: everyone shows the collector, then the collector shows everyone. */
async function round(collector: Phone, others: Phone[], relayed: Map<Phone, Batch[]>, everyone: Phone[]) {
  let seed = 1;
  for (const p of others) await scan(collector, await show(p, relayed), relayed, everyone, seed++);
  const back = await show(collector, relayed);
  for (const p of others) await scan(p, back, relayed, everyone, seed++);
}

describe('four organizers, one collector', () => {
  it('ends with the same itinerary and the same code on every phone', async () => {
    const phones = await group('A', 'B', 'C', 'D');
    const [a, b, c, d] = phones;
    const relayed = new Map<Phone, Batch[]>();

    a.write((_, st) => addItem(st, { date: '2027-03-01', title: '淺草寺', lat: 35.7148, lng: 139.7967 }, 'SENSOJI'));
    a.write((_, st) => addItem(st, { date: '2027-03-01', title: '晴空塔' }, 'SKYTREE'));
    a.write((_, st) => addItem(st, { date: '2027-03-02', title: '築地早餐', type: 'meal' }, 'TSUKIJI'));
    await round(a, [b, c, d], relayed, phones);
    const firstCode = await syncCode(a.state());
    for (const p of phones) expect(await syncCode(p.state())).toBe(firstCode);

    // Apart, with no signal, everyone plans:
    a.write((s, st) => setField(s, st, 'SENSOJI', 'start', '09:00'));
    b.write((s, st) => setField(s, st, 'SENSOJI', 'start', '10:30')); // same field as A
    c.write((s, st) => deleteItem(s, st, 'SKYTREE'));
    d.write((s, st) => setField(s, st, 'SKYTREE', 'note', '要先買票')); // edits what C deleted
    b.write((_, st) => addItem(st, { date: '2027-03-02', title: '新宿御苑' }, 'GYOEN'));
    d.write((_, st) => addItem(st, { date: '2027-03-03', title: '富士急' }, 'FUJIQ'));
    c.write((s, st) => setField(s, st, 'TSUKIJI', 'start', '07:00'));

    await round(a, [b, c, d], relayed, phones);

    const code = await syncCode(a.state());
    expect(code).not.toBe(firstCode);
    for (const p of phones) {
      expect(await syncCode(p.state())).toBe(code);
      expect(plain(p.state())).toEqual(plain(a.state()));
    }
    const s = a.state();
    expect(s.items.size).toBe(5); // nothing lost, SKYTREE kept for a decision
    expect(s.conflicts.map((k) => [k.item, k.kind]).sort()).toEqual([['SENSOJI', 'field'], ['SKYTREE', 'delete']]);
    expect(s.items.get('TSUKIJI')!.values.start).toBe('07:00');

    // An organizer settles both; one more round and everyone agrees again
    b.write((st, stamp) => {
      const k = st.conflicts.find((x) => x.item === 'SENSOJI')!;
      return setField(st, stamp, k.item, k.field!, '09:30');
    });
    b.write((s2, stamp) => deleteItem(s2, stamp, 'SKYTREE'));
    await round(a, [b, c, d], relayed, phones);
    for (const p of phones) {
      const st = p.state();
      expect(st.conflicts).toEqual([]);
      expect(st.items.has('SKYTREE')).toBe(false);
      expect(st.items.get('SENSOJI')!.values.start).toBe('09:30');
      expect(await syncCode(st)).toBe(await syncCode(a.state()));
    }
  }, 60_000);

  it('ignores a lost phone after it is blocked, but keeps what it did before', async () => {
    const phones = await group('A', 'B', 'C', 'D');
    const [a, b, c, d] = phones;
    const relayed = new Map<Phone, Batch[]>();
    const before = d.write((_, st) => addItem(st, { title: 'D 的行程' }, 'DPLAN'));
    await round(a, [b, c, d], relayed, phones);

    for (const p of [a, b, c]) p.trust.set(d.me.id, { access: 'blocked', blockedAfter: before.s });
    d.write((s, st) => setField(s, st, 'DPLAN', 'title', '被改掉了'));
    d.write((s, st) => deleteItem(s, st, 'DPLAN'));
    await round(a, [b, c, d], relayed, phones);

    for (const p of [a, b, c]) expect(p.state().items.get('DPLAN')!.values.title).toBe('D 的行程');
  }, 60_000);
});
