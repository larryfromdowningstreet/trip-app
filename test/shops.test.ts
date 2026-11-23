import { describe, expect, it } from 'vitest';
import { archive, itineraryText } from '../src/core/archive';
import { parseBulk } from '../src/core/bulk';
import { addItem, merge, setField } from '../src/core/merge';
import type { ChangeRecord } from '../src/core/model';
import { shopsOf } from '../src/core/shops';
import { group } from './helpers';

describe('shops', () => {
  it('two people adding shops at the same time keep both, without a conflict', async () => {
    const [a, b] = await group('A', 'B');
    const all: ChangeRecord[] = [a.write((_, st) => addItem(st, { title: '心齋橋' }, 'I1'))];
    b.log.add(all);
    all.push(a.write((s, st) => setField(s, st, 'I1', 'shop.AAA', { n: '藥妝店', w: '1F', t: 1 })));
    all.push(b.write((s, st) => setField(s, st, 'I1', 'shop.BBB', { n: '唱片行', b: '黑膠', t: 2 })));
    const state = merge(all);
    expect(state.conflicts).toEqual([]);
    expect(shopsOf(state.items.get('I1')!.values).map((s) => s.name)).toEqual(['藥妝店', '唱片行']);
  });

  it('a removed shop is gone, and malformed shop values are ignored', async () => {
    const [a] = await group('A');
    a.write((_, st) => addItem(st, { title: 'x', 'shop.AAA': { n: '甲', t: 1 }, 'shop.BAD': { n: 5 } }, 'I1'));
    expect(shopsOf(a.state().items.get('I1')!.values).map((s) => s.name)).toEqual(['甲']);
    expect(a.state().items.get('I1')!.values['shop.BAD']).toBeUndefined();
    a.write((s, st) => setField(s, st, 'I1', 'shop.AAA', null));
    expect(shopsOf(a.state().items.get('I1')!.values)).toEqual([]);
  });

  it('bulk import reads shops from JSON and from a table cell', () => {
    const days = ['2027-03-01'];
    const json = parseBulk(JSON.stringify({ items: [{ title: '新宿', shops: [{ name: 'A 店', where: '3F', buy: '耳機' }, '書店'] }] }), days);
    expect(shopsOf(json.items[0]).map((s) => [s.name, s.where, s.buy])).toEqual([['A 店', '3F', '耳機'], ['書店', '', '']]);
    const table = parseBulk('標題\t想做的事\t店家\n商店街\t吃章魚燒\t藥妝店（1F）、伴手禮店', days);
    expect(table.items[0].note).toBe('吃章魚燒');
    expect(shopsOf(table.items[0]).map((s) => [s.name, s.where])).toEqual([['藥妝店', '1F'], ['伴手禮店', '']]);
  });

  it('the plain-text itinerary lists shops', async () => {
    const [a] = await group('A');
    a.write((_, st) => addItem(st, { title: '商場', date: '2027-03-01', 'shop.A1': { n: '甲', w: 'B1', b: '茶葉', t: 1 } }, 'I1'));
    const text = itineraryText(archive({ id: 't', name: '測試', start: '2027-03-01', end: '2027-03-01', people: ['A'] }, a.state()));
    expect(text).toContain('・甲（B1）：茶葉');
  });
});
