import { describe, expect, it } from 'vitest';
import { addItem } from '../src/core/merge';
import { ChangeLog } from '../src/core/log';
import { syncCode, whitelistCode } from '../src/core/codes';
import { merge } from '../src/core/merge';
import { publicPart } from '../src/core/crypto';
import { group, shuffled } from './helpers';

const rec = (a: string, s: number) => ({ a, s, t: s, op: 'add', item: `${a}${s}`, v: {} });
const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

describe('change log', () => {
  it('counts only new records', () => {
    const log = new ChangeLog([rec(A, 1)]);
    expect(log.add([rec(A, 1), rec(A, 2)])).toBe(1);
    expect(log.size).toBe(2);
    expect(log.has({ a: A, s: 2 })).toBe(true);
    expect(log.nextSeq(A)).toBe(3);
    expect(log.nextSeq(B)).toBe(1);
  });

  it('knows what is missing and what the other side lacks', () => {
    const log = new ChangeLog([rec(A, 1), rec(A, 2), rec(A, 5), rec(B, 2)]);
    expect(log.vector()).toEqual({ [A]: 2, [B]: 0 });
    expect(log.gaps()).toEqual([
      { author: A, missing: [3, 4] },
      { author: B, missing: [1] },
    ]);
    expect(log.since({ [A]: 2 }).map((r) => `${r.a[0]}${r.s}`).sort()).toEqual(['a5', 'b2']);
  });
});

describe('compare codes', () => {
  it('same itinerary gives the same sync code, a change gives another', async () => {
    const [a] = await group('A');
    for (let i = 0; i < 5; i++) a.write((_, st) => addItem(st, { title: `t${i}`, date: '2027-03-0' + i }, `I${i}`));
    const records = a.log.all();
    const code = await syncCode(merge(records));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await syncCode(merge(shuffled(records, 7)))).toBe(code);
    expect(await syncCode(merge(records.slice(1)))).not.toBe(code);
  });

  it('same people give the same whitelist code, in any order', async () => {
    const phones = await group('A', 'B', 'C');
    const people = phones.map((p) => publicPart(p.me));
    const code = await whitelistCode(people);
    expect(await whitelistCode([...people].reverse())).toBe(code);
    expect(await whitelistCode(people.slice(1))).not.toBe(code);
  });
});
