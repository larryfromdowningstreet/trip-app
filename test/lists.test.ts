import { describe, expect, it } from 'vitest';
import { archive, itineraryText, readArchive } from '../src/core/archive';
import { aiInstructions, parseBulk } from '../src/core/bulk';
import { copyPacking, entry, ordered, readLists, splitLines } from '../src/core/lists';
import { addItem, merge } from '../src/core/merge';

const days = ['2027-03-10', '2027-03-11'];

describe('own lists', () => {
  it('splits pasted lines and drops the bullets and boxes copied along', () => {
    expect(splitLines('- 護照\n☐ 充電器\n\n1. 轉接頭\n[x] 雨傘\n・ 藥')).toEqual(['護照', '充電器', '轉接頭', '雨傘', '藥']);
  });

  it('keeps the order things were added, ticked ones after the rest', () => {
    const a = entry('A', {}, 1)!, b = entry('B', { done: true }, 2)!, c = entry('C', {}, 3)!;
    const { todo, done } = ordered([c, b, a]);
    expect(todo.map((e) => e.text)).toEqual(['A', 'C']);
    expect(done.map((e) => e.text)).toEqual(['B']);
  });

  it('a new trip copies the packing list unticked, with new ids', () => {
    const old = [entry('護照', { done: true }, 1)!, entry('牙刷', {}, 2)!];
    const copied = copyPacking(old, 100);
    expect(copied.map((e) => [e.text, e.done])).toEqual([['護照', undefined], ['牙刷', undefined]]);
    expect(copied[0].id).not.toBe(old[0].id);
  });

  it('throws away malformed entries read from outside', () => {
    const lists = readLists({ shopping: [{ id: 'A1', text: '面膜', t: 1, qty: '2', for: '媽媽', done: true }, { id: 'X', text: '', t: 1 }, 'junk'], packing: 5 });
    expect(lists).toEqual({ shopping: [{ id: 'A1', text: '面膜', t: 1, qty: '2', for: '媽媽', done: true }], packing: [] });
  });

  it('archives and backups keep the lists, with the place to buy in words', () => {
    const state = merge([addItem({ a: 'A', s: 1, t: 1 }, { title: '錦市場', date: days[0], 'shop.S1': { n: '七味屋', t: 1 } }, 'I1')]);
    const lists = { shopping: [entry('七味粉', { for: '媽媽', qty: '2 罐', at: { item: 'I1', shop: 'S1' } }, 1)!], packing: [entry('護照', { done: true }, 2)!] };
    const a = archive({ id: 'T', name: '京都', start: days[0], end: days[1], people: ['A'] }, state, lists);
    expect(a.lists!.shopping[0]).toMatchObject({ text: '七味粉', where: '錦市場・七味屋' });
    expect(a.lists!.shopping[0].at).toBeUndefined();
    expect(readArchive(JSON.stringify(a))!.lists).toEqual(a.lists);
    const text = itineraryText(a);
    expect(text).toContain('■ 購物清單');
    expect(text).toContain('[ ] 七味粉（給媽媽・2 罐，在錦市場・七味屋買）');
    expect(text).toContain('[v] 護照');
  });

  it('bulk import reads shopping and packing next to items, or on their own', () => {
    const both = parseBulk(JSON.stringify({ items: [{ title: '錦市場', date: days[0] }], shopping: [{ name: '七味粉', qty: '2 罐', shop: '錦市場' }, '抹茶'], packing: ['護照'] }), days);
    expect(both.items).toHaveLength(1);
    expect(both.shopping).toEqual([{ text: '七味粉', qty: '2 罐', shop: '錦市場' }, { text: '抹茶' }]);
    expect(both.packing).toEqual([{ text: '護照' }]);
    const only = parseBulk('```json\n{"packing":["雨傘","牙刷"]}\n```', days);
    expect(only.problems).toEqual([]);
    expect(only.packing.map((d) => d.text)).toEqual(['雨傘', '牙刷']);
  });

  it('the AI format asks for lists, and only lists for someone who cannot edit the itinerary', () => {
    const full = aiInstructions({ name: '京都', days }, [], { lists: { shopping: ['抹茶'], packing: [] } });
    expect(full).toContain('"shopping"');
    expect(full).toContain('"items"');
    expect(full).toContain('購物：抹茶');
    const listsOnly = aiInstructions({ name: '京都', days }, [], { items: false });
    expect(listsOnly).not.toContain('"items"');
    expect(listsOnly).toContain('"packing"');
  });
});
