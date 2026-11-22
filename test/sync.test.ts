// The collector sync as the app runs it: small bundles based on what each phone last confirmed,
// a collector sharing what the least-up-to-date phone lacks, and a check that nothing is left behind.

import { describe, expect, it } from 'vitest';
import { type Batch, openBundle, sealBundle } from '../src/core/bundle';
import { syncCode } from '../src/core/codes';
import { newTripKey } from '../src/core/crypto';
import { addItem, setField } from '../src/core/merge';
import { type Vector } from '../src/core/log';
import { accepts } from '../src/core/model';
import { keep, lowest, missing, outgoing } from '../src/core/sync';
import { type Phone, group } from './helpers';

const TRIP = 'T';
const key = newTripKey();

/** A phone plus what the app stores for syncing. */
type P = Phone & { stored: Batch[]; synced: Vector };
const accepted = (p: P) => (r: { a: string; s: number }) => accepts(p.trust.get(r.a), r);

async function bundleFrom(p: P, need: Vector) {
  const batches = await outgoing(TRIP, p.me, p.log, p.stored, need, accepted(p));
  return sealBundle(batches, key, { from: p.me.id, have: p.log.vector() });
}

async function take(p: P, bytes: Uint8Array, everyone: P[]) {
  const keys = new Map(everyone.map((q) => [q.me.id, q.me.signKey]));
  const opened = await openBundle(bytes as Uint8Array<ArrayBuffer>, TRIP, key, (id) => keys.get(id));
  p.log.add(opened.records);
  p.stored = keep(p.stored, opened.batches, p.me.id);
  return opened;
}

/** Everyone shows the collector, the collector shows everyone back, everyone confirms. */
async function sync(collector: P, others: P[], everyone: P[]) {
  const haves: Vector[] = [collector.synced];
  for (const p of others) {
    const opened = await take(collector, await bundleFrom(p, p.synced), everyone);
    haves.push(opened.header.have);
  }
  const lacking = others.filter((_, i) => missing(collector.log.vector(), haves[i + 1]) > 0);
  const share = await bundleFrom(collector, lowest(haves));
  for (const p of others) await take(p, share, everyone);
  for (const p of [collector, ...others]) p.synced = p.log.vector();
  return { lacking, size: share.length };
}

const make = async (...names: string[]) =>
  (await group(...names)).map((p) => Object.assign(p, { stored: [] as Batch[], synced: {} as Vector }));

describe('collector sync', () => {
  it('reaches the same itinerary, including a phone that missed the previous sync', async () => {
    const all = await make('A', 'B', 'C', 'D');
    const [a, b, c, d] = all;
    for (let i = 0; i < 30; i++) a.write((_, st) => addItem(st, { title: `item ${i}`, date: '2027-03-10' }, `I${i}`));
    await sync(a, [b, c, d], all);
    const first = await syncCode(a.state());
    for (const p of all) expect(await syncCode(p.state())).toBe(first);

    // D is away; A, B, C keep planning and sync without D, with B collecting
    b.write((s, st) => setField(s, st, 'I1', 'title', 'B edit'));
    c.write((s, st) => setField(s, st, 'I2', 'title', 'C edit'));
    const small = await sync(b, [a, c], all);
    expect(small.size).toBeLessThan(2_000); // only the new changes, not all 30 items again

    // D comes back with its own change; C collects. D's old position makes C share what D lacks.
    d.write((s, st) => setField(s, st, 'I3', 'title', 'D edit'));
    await sync(c, [a, b, d], all);
    const code = await syncCode(c.state());
    for (const p of all) {
      expect(await syncCode(p.state())).toBe(code);
      expect(p.log.gaps()).toEqual([]);
    }
    expect(d.state().items.get('I1')!.values.title).toBe('B edit');
  });

  it('notices when a sender has older changes the collector never got', async () => {
    const all = await make('A', 'B', 'C');
    const [a, b, c] = all;
    a.write((_, st) => addItem(st, { title: 'x' }, 'I1'));
    await sync(a, [b], all); // C was not there
    // Now C collects. B only sends what is new since its last sync (nothing), so C still lacks A's item.
    const result = await sync(c, [b], all);
    expect(result.lacking).toEqual([b]);
    // B sends everything instead
    await take(c, await bundleFrom(b, {}), all);
    expect(c.state().items.has('I1')).toBe(true);
  });

  it('does not pass on what a blocked phone sent after the block', async () => {
    const all = await make('A', 'B', 'Lost');
    const [a, b, lost] = all;
    lost.write((_, st) => addItem(st, { title: 'ok' }, 'I1'));
    await sync(a, [lost, b], all);
    a.trust.set(lost.me.id, { access: 'blocked', blockedAfter: 1 });
    lost.write((s, st) => setField(s, st, 'I1', 'title', 'thief'));
    await take(a, await bundleFrom(lost, lost.synced), all);
    const share = await outgoing(TRIP, a.me, a.log, a.stored, b.synced, accepted(a));
    expect(share.filter((x) => x.author === lost.me.id)).toEqual([]);
  });
});
