import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type Batch, BundleFailure, openBundle, sealBundle, signBatch } from '../src/core/bundle';
import { concat, randomBytes, utf8 } from '../src/core/bytes';
import {
  createIdentity, importTripKey, keyIdOf, newTripKey, sign, unwrapTripKey, verify, wrapTripKey,
} from '../src/core/crypto';
import { addItem } from '../src/core/merge';
import { group } from './helpers';

describe('keys', () => {
  it('signatures check out only with the right key and data', async () => {
    const [a, b] = await Promise.all([createIdentity('A'), createIdentity('B')]);
    expect(a.id).toBe(await keyIdOf(a.signKey));
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
    const sig = await sign(a, utf8('hello'));
    expect(await verify(a.signKey, sig, utf8('hello'))).toBe(true);
    expect(await verify(a.signKey, sig, utf8('hellO'))).toBe(false);
    expect(await verify(b.signKey, sig, utf8('hello'))).toBe(false);
  });

  it('a wrapped trip key opens only for its recipient', async () => {
    const [a, b] = await Promise.all([createIdentity('A'), createIdentity('B')]);
    const key = newTripKey();
    const wrapped = await wrapTripKey(key, a.encKey);
    expect(wrapped.length).toBe(65 + 12 + 48);
    expect(await unwrapTripKey(wrapped, a)).toEqual(key);
    await expect(unwrapTripKey(wrapped, b)).rejects.toThrow();
  });
});

describe('bundle', () => {
  const TRIP = 'trip-1';
  const head = (from: string) => ({ from, have: {} });
  const setup = async () => {
    const phones = await group('A', 'B', 'C');
    const keys = new Map(phones.map((p) => [p.me.id, p.me.signKey]));
    return { phones, tripKey: newTripKey(), signKeyOf: (id: string) => keys.get(id) };
  };

  it('round-trips, and a collector can pass others’ batches on unchanged', async () => {
    const { phones: [a, b, c], tripKey, signKeyOf } = await setup();
    const ra = a.write((_, st) => addItem(st, { title: 'A plan' }));
    const rb = b.write((_, st) => addItem(st, { title: 'B plan' }));

    const fromA = await openBundle(await sealBundle([await signBatch(TRIP, [ra], a.me)], tripKey, { from: a.me.id, have: { [a.me.id]: 1 } }), TRIP, tripKey, signKeyOf);
    expect(fromA.records).toEqual([ra]);
    expect(fromA.header).toEqual({ from: a.me.id, have: { [a.me.id]: 1 } });
    expect(fromA.rejected).toEqual([]);

    // C collected A's batch earlier and now forwards it with B's
    const fromB = await openBundle(await sealBundle([await signBatch(TRIP, [rb], b.me)], tripKey, head(b.me.id)), TRIP, tripKey, signKeyOf);
    const relay = await sealBundle([...fromA.batches, ...fromB.batches], tripKey, head(c.me.id));
    const atC = await openBundle(relay, TRIP, tripKey, signKeyOf);
    expect(atC.records).toEqual([ra, rb]);
  });

  it('refuses the wrong trip key and any changed byte', async () => {
    const { phones: [a], tripKey, signKeyOf } = await setup();
    const sealed = await sealBundle([await signBatch(TRIP, [a.write((_, st) => addItem(st, {}))], a.me)], tripKey, head(a.me.id));
    await expect(openBundle(sealed, TRIP, newTripKey(), signKeyOf)).rejects.toEqual(new BundleFailure('decrypt'));
    const flipped = sealed.slice();
    flipped[flipped.length - 5] ^= 1;
    await expect(openBundle(flipped, TRIP, tripKey, signKeyOf)).rejects.toEqual(new BundleFailure('decrypt'));
    await expect(openBundle(sealed.subarray(0, 10), TRIP, tripKey, signKeyOf)).rejects.toEqual(new BundleFailure('format'));
  });

  it('drops only the bad batches', async () => {
    const { phones: [a, b], tripKey, signKeyOf } = await setup();
    const stranger = await createIdentity('X');
    const good = await signBatch(TRIP, [a.write((_, st) => addItem(st, {}))], a.me);
    const unknown = await signBatch(TRIP, [{ a: stranger.id, s: 1, t: 1, op: 'add', item: 'I', v: {} }], stranger);
    const rb = b.write((_, st) => addItem(st, {}));
    const forged: Batch = { ...(await signBatch(TRIP, [rb], b.me)), signature: (await signBatch(TRIP, [], b.me)).signature };
    const otherTrip = await signBatch('trip-2', [b.write((_, st) => addItem(st, {}))], b.me);
    const json = utf8(JSON.stringify({ v: 1, trip: TRIP, records: [{ ...rb, a: a.me.id }] })); // B signs a record claiming to be A's
    const mislabeled: Batch = { author: b.me.id, json, signature: await sign(b.me, json) };

    const out = await openBundle(await sealBundle([good, unknown, forged, otherTrip, mislabeled], tripKey, head(a.me.id)), TRIP, tripKey, signKeyOf);
    expect(out.batches).toEqual([good]);
    expect(out.rejected.map((r) => r.reason)).toEqual(['unknown-author', 'bad-signature', 'wrong-trip', 'format']);
  });

  it('refuses a malformed header', async () => {
    const { tripKey, signKeyOf } = await setup();
    const sealed = await sealBundle([], tripKey, { from: 'not-an-id', have: {} });
    await expect(openBundle(sealed, TRIP, tripKey, signKeyOf)).rejects.toEqual(new BundleFailure('format'));
  });

  it('will not sign someone else’s records', async () => {
    const { phones: [a, b] } = await setup();
    await expect(signBatch(TRIP, [b.write((_, st) => addItem(st, {}))], a.me)).rejects.toThrow();
  });

  it('refuses oversized input before and after inflating', async () => {
    const { tripKey, signKeyOf } = await setup();
    const huge = concat([2, 1], new Uint8Array(1 << 20));
    await expect(openBundle(huge, TRIP, tripKey, signKeyOf)).rejects.toEqual(new BundleFailure('too-large'));

    const bomb = deflateSync(new Uint8Array(5 << 20), { level: 9 }); // small sealed, 5 MB once opened
    const iv = randomBytes(12);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importTripKey(tripKey), bomb));
    const bytes = concat([2, 1], iv, sealed);
    expect(bytes.length).toBeLessThan(20_000);
    await expect(openBundle(bytes, TRIP, tripKey, signKeyOf)).rejects.toEqual(new BundleFailure('too-large'));
  });
});
