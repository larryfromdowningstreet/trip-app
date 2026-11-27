import { describe, expect, it } from 'vitest';
import { openBundle, sealBundle, signBatch } from '../src/core/bundle';
import { createIdentity, newTripKey } from '../src/core/crypto';
import { EnrollFailure, identityCard, makeInvite, openInvite } from '../src/core/enroll';
import { makeJoin, readJoin } from '../src/core/join';
import { addItem } from '../src/core/merge';
import { Receiver, kindOf, qrFrames } from '../src/core/transfer';
import { Phone } from './helpers';

const trip = { id: 'T1', name: '京都五日遊', start: '2027-03-10', end: '2027-03-14' };

describe('join code', () => {
  const setup = async () => {
    const org = await Phone.make('小明');
    const [old, newbie] = await Promise.all(['小美', '小華'].map(createIdentity));
    const key = newTripKey();
    for (let i = 0; i < 20; i++) org.write((_, st) => addItem(st, { date: '2027-03-10', title: `景點 ${i}`, note: '走路十分鐘'.repeat(5) }, `ITEM${i}`));
    const people = [
      { id: org.me.id, name: org.me.name, role: 'organizer' as const },
      { id: old.id, name: old.name, role: 'organizer' as const },
      { id: newbie.id, name: newbie.name, role: 'member' as const },
    ];
    const invite = await makeInvite(trip, key, org.me, people, [newbie]);
    const bundle = await sealBundle([await signBatch(trip.id, org.log.all(), org.me)], key, { from: org.me.id, have: org.log.vector() });
    const bytes = makeJoin([org.me, old, newbie].map(identityCard), invite, bundle);
    return { org, old, newbie, key, bytes };
  };

  it('gives a newcomer the organizer, the people listed, the key and the itinerary in one scan', async () => {
    const { org, old, newbie, key, bytes } = await setup();
    expect(kindOf(bytes)).toBe('join');
    const receiver = new Receiver();
    let got: Uint8Array | undefined;
    for (const f of qrFrames(bytes)) got = receiver.add(f)?.bytes ?? got;
    const join = await readJoin(got as typeof bytes);
    expect(join.cards.map((c) => c.id)).toEqual([org.me.id, old.id, newbie.id]);

    const signKeyOf = (id: string) => join.cards.find((c) => c.id === id)?.signKey;
    const invite = await openInvite(join.invite, signKeyOf, newbie);
    expect(invite.key).toEqual(key);
    const opened = await openBundle(join.bundle, invite.trip, invite.key!, signKeyOf);
    expect(opened.rejected).toEqual([]);
    expect(opened.records).toHaveLength(20);
  });

  it('refuses a card that was swapped for someone else', async () => {
    const { newbie, bytes } = await setup();
    const join = await readJoin(bytes);
    const impostor = await createIdentity('小明');
    const cards = [impostor, ...join.cards.slice(1)].map(identityCard);
    const swapped = await readJoin(makeJoin(cards, join.invite, join.bundle));
    const signKeyOf = (id: string) => swapped.cards.find((c) => c.id === id)?.signKey;
    // The impostor's id is not the one the invite was signed by, so the organizer is unknown.
    await expect(openInvite(swapped.invite, signKeyOf, newbie)).rejects.toEqual(new EnrollFailure('unknown-inviter'));
  });

  it('refuses a cut-off code', async () => {
    const { bytes } = await setup();
    await expect(readJoin(bytes.slice(0, -1))).rejects.toEqual(new EnrollFailure('format'));
  });
});
