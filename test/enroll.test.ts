import { describe, expect, it } from 'vitest';
import { concat } from '../src/core/bytes';
import { createIdentity, newTripKey, publicPart } from '../src/core/crypto';
import { EnrollFailure, identityCard, makeInvite, openInvite, readIdentityCard } from '../src/core/enroll';
import { Receiver, kindOf, qrFrames } from '../src/core/transfer';

describe('identity card', () => {
  it('round-trips through QR frames and computes the id itself', async () => {
    const me = await createIdentity('小明');
    const card = identityCard(me);
    expect(kindOf(card)).toBe('identity');
    const frames = qrFrames(card);
    expect(frames).toHaveLength(1);
    const got = new Receiver().add(frames[0])!.bytes!;
    expect(await readIdentityCard(got)).toEqual(publicPart(me));
  });

  it('refuses broken cards', async () => {
    const card = identityCard(await createIdentity('A'));
    await expect(readIdentityCard(card.slice(0, -1))).rejects.toEqual(new EnrollFailure('format'));
    const bad = card.slice();
    bad[10] ^= 0xff; // no longer a point on the curve
    await expect(readIdentityCard(bad)).rejects.toEqual(new EnrollFailure('format'));
  });
});

describe('invite', () => {
  const trip = { id: 'T1', name: '京都五日遊', start: '2027-03-10', end: '2027-03-14' };

  const setup = async () => {
    const [org, newbie, old, stranger] = await Promise.all(['小明', '小華', '小美', '路人'].map(createIdentity));
    const key = newTripKey();
    const people = [
      { id: org.id, name: org.name, role: 'organizer' as const },
      { id: newbie.id, name: newbie.name, role: 'member' as const },
      { id: old.id, name: old.name, role: 'organizer' as const },
    ];
    const bytes = await makeInvite(trip, key, org, people, [newbie]);
    return { org, newbie, old, stranger, key, people, bytes };
  };

  it('brings a newcomer in with the trip key, name and dates', async () => {
    const { org, newbie, key, people, bytes } = await setup();
    const invite = await openInvite(bytes, (id) => (id === org.id ? org.signKey : undefined), newbie);
    expect(invite).toEqual({ trip: 'T1', from: org.id, people, info: { name: trip.name, start: trip.start, end: trip.end }, key });
  });

  it('lets a member who already has the key read it, and tells apart another trip', async () => {
    const { org, old, key, bytes } = await setup();
    const known = (id: string) => (id === org.id ? org.signKey : undefined);
    expect((await openInvite(bytes, known, old, () => key)).info?.name).toBe('京都五日遊');
    await expect(openInvite(bytes, known, old, () => newTripKey())).rejects.toEqual(new EnrollFailure('other-trip'));
  });

  it('needs an inviter this phone scanned, and an untouched signature', async () => {
    const { org, newbie, stranger, bytes } = await setup();
    await expect(openInvite(bytes, () => undefined, newbie)).rejects.toEqual(new EnrollFailure('unknown-inviter'));
    await expect(openInvite(bytes, () => stranger.signKey, newbie)).rejects.toEqual(new EnrollFailure('bad-signature'));
    const tampered = concat(bytes.slice(0, -1), [bytes[bytes.length - 1] ^ 1]);
    await expect(openInvite(tampered, () => org.signKey, newbie)).rejects.toEqual(new EnrollFailure('bad-signature'));
  });

  it('gives no key to someone the organizer did not scan', async () => {
    const { org, stranger, bytes } = await setup();
    const invite = await openInvite(bytes, () => org.signKey, stranger);
    expect(invite.key).toBeUndefined();
    expect(invite.info).toBeUndefined();
  });
});
