// The join QR Code: everything a newcomer needs in one scan, so they no longer scan the organizer's
// identity, then the invite, then sync.
//
// Join (kind 0x04): [kind][format 1][card count 1] then per card [length 2][identity card],
//   [invite length 2][invite], [bundle length 4][bundle].
// The cards are the people the invite lists. Their ids are hashes of their keys and the organizer signed
// the list of ids, so a card that matches a listed id is the person the organizer met. The newcomer trusts
// the organizer's card because they scan it face to face, just as they would scan the organizer's identity.

import type { Bytes } from './bytes';
import { concat } from './bytes';
import type { PublicIdentity } from './crypto';
import { EnrollFailure, readIdentityCard } from './enroll';
import { KINDS } from './transfer';

const FORMAT = 1;

export interface Join {
  cards: PublicIdentity[];
  invite: Bytes;
  bundle: Bytes;
}

export function makeJoin(cards: Bytes[], invite: Bytes, bundle: Bytes): Bytes {
  if (cards.length > 64 || invite.length > 0xffff) throw new Error('too much for a join code');
  const parts: ArrayLike<number>[] = [[KINDS.join, FORMAT, cards.length]];
  for (const c of cards) parts.push(u16(c.length), c);
  parts.push(u16(invite.length), invite, u32(bundle.length), bundle);
  return concat(...parts);
}

export async function readJoin(bytes: Bytes): Promise<Join> {
  const fail = new EnrollFailure('format');
  if (bytes[0] !== KINDS.join || bytes[1] !== FORMAT || bytes.length < 3) throw fail;
  let at = 3;
  const take = (n: number) => {
    if (at + n > bytes.length) throw fail;
    const out = bytes.slice(at, at + n);
    at += n;
    return out;
  };
  const len = (n: 2 | 4) => take(n).reduce((v, b) => v * 256 + b, 0);
  const cards: PublicIdentity[] = [];
  for (let i = 0; i < bytes[2]; i++) cards.push(await readIdentityCard(take(len(2))));
  const invite = take(len(2));
  const bundle = take(len(4));
  if (at !== bytes.length) throw fail;
  return { cards, invite, bundle };
}

const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
