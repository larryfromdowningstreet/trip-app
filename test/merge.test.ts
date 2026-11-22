import { describe, expect, it } from 'vitest';
import { addItem, deleteItem, merge, resolve, setField } from '../src/core/merge';
import { type ChangeRecord, accepts, isChangeRecord } from '../src/core/model';
import { group, plain, shuffled } from './helpers';

describe('merge', () => {
  it('builds items from adds and edits', async () => {
    const [a] = await group('A');
    a.write((_, st) => addItem(st, { title: '淺草寺', date: '2027-03-01', lat: 35.71 }, 'I1'));
    a.write((s, st) => setField(s, st, 'I1', 'title', '淺草寺・雷門'));
    expect(a.state().items.get('I1')!.values).toEqual({ title: '淺草寺・雷門', date: '2027-03-01', lat: 35.71 });
    expect(a.state().conflicts).toEqual([]);
  });

  it('gives the same result in any arrival order, duplicates included', async () => {
    const [a, b, c] = await group('A', 'B', 'C');
    const all: ChangeRecord[] = [];
    all.push(a.write((_, st) => addItem(st, { title: 'x', note: 'n' }, 'I1')));
    for (const p of [b, c]) p.log.add(all);
    all.push(b.write((s, st) => setField(s, st, 'I1', 'title', 'from B')));
    all.push(c.write((s, st) => setField(s, st, 'I1', 'title', 'from C')));
    all.push(c.write((s, st) => setField(s, st, 'I1', 'note', 'C note')));
    all.push(a.write((_, st) => addItem(st, { title: 'y' }, 'I2')));
    a.log.add(all);
    all.push(a.write((s, st) => deleteItem(s, st, 'I2')));

    const expected = merge(all);
    for (let seed = 1; seed <= 25; seed++) {
      const got = merge(shuffled([...all, ...all.slice(0, 3)], seed));
      expect(plain(got)).toEqual(plain(expected));
      expect(got.conflicts.map((k) => k.shown)).toEqual(expected.conflicts.map((k) => k.shown));
    }
  });

  it('flags two unseen edits of one field and shows the later one', async () => {
    const [a, b] = await group('A', 'B');
    const add = a.write((_, st) => addItem(st, { title: 'old' }, 'I1'));
    b.log.add([add]);
    const ea = a.write((s, st) => setField(s, st, 'I1', 'title', 'A says'));
    b.clock += 60_000; // B edits a minute later
    const eb = b.write((s, st) => setField(s, st, 'I1', 'title', 'B says'));
    a.log.add([eb]);

    const s = a.state();
    expect(s.items.get('I1')!.values.title).toBe('B says');
    expect(s.items.get('I1')!.pending).toBe(true);
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0].options).toEqual([ea, eb]);

    a.write((st, stamp) => resolve(st, stamp, st.conflicts[0], ea));
    expect(a.state().conflicts).toEqual([]);
    expect(a.state().items.get('I1')!.values.title).toBe('A says');
  });

  it('edits to different fields never conflict', async () => {
    const [a, b] = await group('A', 'B');
    b.log.add([a.write((_, st) => addItem(st, { title: 't', note: 'n' }, 'I1'))]);
    const ea = a.write((s, st) => setField(s, st, 'I1', 'title', 'T'));
    const eb = b.write((s, st) => setField(s, st, 'I1', 'note', 'N'));
    a.log.add([eb]);
    b.log.add([ea]);
    expect(a.state().conflicts).toEqual([]);
    expect(plain(a.state())).toEqual(plain(b.state()));
    expect(a.state().items.get('I1')!.values).toEqual({ title: 'T', note: 'N' });
  });

  it('deletes when the deleter saw everything', async () => {
    const [a, b] = await group('A', 'B');
    b.log.add([a.write((_, st) => addItem(st, { title: 't' }, 'I1'))]);
    b.log.add([a.write((s, st) => setField(s, st, 'I1', 'title', 'T2'))]);
    b.write((s, st) => deleteItem(s, st, 'I1'));
    expect(b.state().items.has('I1')).toBe(false);
  });

  it('keeps an item edited by someone the deleter had not seen, and lets an organizer decide', async () => {
    const [a, b] = await group('A', 'B');
    b.log.add([a.write((_, st) => addItem(st, { title: 't' }, 'I1'))]);
    const del = a.write((s, st) => deleteItem(s, st, 'I1'));
    b.clock += 60_000;
    const edit = b.write((s, st) => setField(s, st, 'I1', 'title', 'still going'));
    a.log.add([edit]);

    const s = a.state();
    expect(s.items.get('I1')!.values.title).toBe('still going');
    expect(s.conflicts).toEqual([expect.objectContaining({ kind: 'delete', shown: edit, options: [del, edit] })]);

    // keep it
    const keep = a.log.all().concat(a.write((st, stamp) => resolve(st, stamp, st.conflicts[0], edit)));
    expect(merge(keep).conflicts).toEqual([]);
    expect(merge(keep).items.get('I1')!.values.title).toBe('still going');
  });

  it('can delete after a delete-vs-edit conflict', async () => {
    const [a, b] = await group('A', 'B');
    b.log.add([a.write((_, st) => addItem(st, { title: 't' }, 'I1'))]);
    const del = a.write((s, st) => deleteItem(s, st, 'I1'));
    a.log.add([b.write((s, st) => setField(s, st, 'I1', 'title', 'edit'))]);
    a.write((st, stamp) => resolve(st, stamp, st.conflicts[0], del));
    expect(a.state().items.has('I1')).toBe(false);
    expect(a.state().conflicts).toEqual([]);
  });

  it('waits for the add before showing an item, and keeps unknown fields', async () => {
    const [a] = await group('A');
    const add = a.write((_, st) => addItem(st, { title: 't', future: { x: 1 } }, 'I1'));
    const edit = a.write((s, st) => setField(s, st, 'I1', 'title', 'T'));
    expect(merge([edit]).items.size).toBe(0);
    expect(merge([edit, add]).items.get('I1')!.values).toEqual({ title: 'T', future: { x: 1 } });
  });

  it('ignores a known field with the wrong type', async () => {
    const [a] = await group('A');
    a.write((_, st) => addItem(st, { title: 't', lat: 'north' }, 'I1'));
    a.write((s, st) => ({ ...setField(s, st, 'I1', 'title', 42) }));
    expect(a.state().items.get('I1')!.values).toEqual({ title: 't' });
  });
});

describe('trust', () => {
  it('edit counts, view never does, blocked counts only up to the cut-off', () => {
    const r = (s: number) => ({ a: '0123456789abcdef', s });
    expect(accepts({ access: 'edit' }, r(9))).toBe(true);
    expect(accepts({ access: 'view' }, r(1))).toBe(false);
    expect(accepts(undefined, r(1))).toBe(false);
    expect(accepts({ access: 'blocked', blockedAfter: 3 }, r(3))).toBe(true);
    expect(accepts({ access: 'blocked', blockedAfter: 3 }, r(4))).toBe(false);
  });

  it('a lost phone keeps its earlier changes but not later ones', async () => {
    const [a, lost] = await group('A', 'Lost');
    const ok = lost.write((_, st) => addItem(st, { title: 'real plan' }, 'I1'));
    a.log.add([ok]);
    a.trust.set(lost.me.id, { access: 'blocked', blockedAfter: ok.s });
    const bad = lost.write((s, st) => setField(s, st, 'I1', 'title', 'thief edit'));
    a.log.add([bad, lost.write((s, st) => deleteItem(s, st, 'I1'))]);
    expect(a.state().items.get('I1')!.values.title).toBe('real plan');
  });

  it('checks the shape of records from outside', () => {
    const good = { a: '0123456789abcdef', s: 1, t: 1, op: 'set', item: 'I1', f: 'title', v: 'x', r: [] };
    expect(isChangeRecord(good)).toBe(true);
    expect(isChangeRecord({ ...good, a: 'XYZ' })).toBe(false);
    expect(isChangeRecord({ ...good, s: 0 })).toBe(false);
    expect(isChangeRecord({ ...good, item: '' })).toBe(false);
    expect(isChangeRecord({ ...good, r: Array(65).fill({ a: good.a, s: 1 }) })).toBe(false);
    expect(isChangeRecord(null)).toBe(false);
  });
});

describe('clearing', () => {
  it('a field set to null is cleared, for numbers too', async () => {
    const [a] = await group('A');
    a.write((_, st) => addItem(st, { title: 't', lat: 35.1, lng: 135.2 }, 'I1'));
    a.write((s, st) => setField(s, st, 'I1', 'lat', null));
    expect(a.state().items.get('I1')!.values).toEqual({ title: 't', lat: null, lng: 135.2 });
  });
});
