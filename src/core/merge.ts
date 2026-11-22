// Turns a set of change records into the itinerary. The order records arrive in never matters.
//
// Each field of each item keeps its own history: a change names the record it replaces.
//   - One newest record ("head") for a field: that is the value.
//   - Two heads: two people changed the same thing without seeing each other's change. That is a
//     conflict; the later one is shown until an organizer picks.
//   - A delete names every head it saw. If someone edited the item meanwhile, the item stays and
//     an organizer decides, so nothing is lost by accident.

import { ITEM_FIELDS, type ChangeRecord, type RecordRef, type Stamp, refKey, refOf, newItemId } from './model';

export interface Conflict {
  item: string;
  kind: 'field' | 'delete';
  field?: string;
  options: ChangeRecord[]; // oldest first
  shown: ChangeRecord; // what is displayed until someone decides
}

export interface ItemState {
  id: string;
  values: Record<string, unknown>;
  heads: Record<string, ChangeRecord[]>;
  pending: boolean; // waiting for an organizer
}

export interface TripState {
  items: Map<string, ItemState>;
  conflicts: Conflict[];
}

const newer = (x: ChangeRecord, y: ChangeRecord) => (x.t !== y.t ? x.t > y.t : x.a !== y.a ? x.a > y.a : x.s > y.s);
const latest = (list: ChangeRecord[]) => list.reduce((best, r) => (newer(r, best) ? r : best));
const oldestFirst = (list: ChangeRecord[]) => [...list].sort((x, y) => (newer(x, y) ? 1 : -1));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fits(field: string, value: unknown): boolean {
  const type = ITEM_FIELDS[field as keyof typeof ITEM_FIELDS];
  return type === undefined || value === null || typeof value === type; // null clears; unknown fields come from newer apps
}

export const valueOf = (record: ChangeRecord, field: string): unknown =>
  record.op === 'add' ? (record.v as Record<string, unknown>)[field] : record.v;

export function merge(records: Iterable<ChangeRecord>): TripState {
  const byRef = new Map<string, ChangeRecord>();
  const byItem = new Map<string, ChangeRecord[]>();
  for (const r of records) {
    const key = refKey(r);
    if (byRef.has(key)) continue;
    byRef.set(key, r);
    push(byItem, r.item, r);
  }

  const state: TripState = { items: new Map(), conflicts: [] };
  for (const [id, list] of byItem) {
    const candidates = new Map<string, ChangeRecord[]>();
    const replaced = new Map<string, Set<string>>();
    const deletes: ChangeRecord[] = [];
    const restored = new Set<string>();
    let created = false;

    for (const r of list) {
      if (r.op === 'add' && isObject(r.v)) {
        created = true;
        for (const [f, v] of Object.entries(r.v)) if (fits(f, v)) push(candidates, f, r);
      } else if (r.op === 'set' && r.f && fits(r.f, r.v)) {
        push(candidates, r.f, r);
        for (const ref of r.r ?? []) replaced.set(r.f, (replaced.get(r.f) ?? new Set()).add(refKey(ref)));
      } else if (r.op === 'delete') {
        deletes.push(r);
      } else if (r.op === 'restore') {
        for (const ref of r.r ?? []) restored.add(refKey(ref));
      }
    }
    if (!created) continue; // its creation has not arrived yet

    const item: ItemState = { id, values: {}, heads: {}, pending: false };
    for (const [field, list] of candidates) {
      const heads = list.filter((r) => !replaced.get(field)?.has(refKey(r)));
      if (heads.length === 0) continue;
      const shown = latest(heads);
      item.heads[field] = heads;
      item.values[field] = valueOf(shown, field);
      if (heads.length > 1) {
        item.pending = true;
        state.conflicts.push({ item: id, kind: 'field', field, options: oldestFirst(heads), shown });
      }
    }

    const active = deletes.filter((d) => !restored.has(refKey(d)));
    if (active.length > 0) {
      const all = unique(Object.values(item.heads).flat());
      const sawEverything = (d: ChangeRecord) => {
        const seen = ancestors(d.r ?? [], byRef);
        return all.every((h) => seen.has(refKey(h)));
      };
      if (active.some(sawEverything)) continue; // deleted
      const d = latest(active);
      const seen = ancestors(d.r ?? [], byRef);
      const unseen = all.filter((h) => !seen.has(refKey(h)));
      item.pending = true;
      state.conflicts.push({ item: id, kind: 'delete', options: oldestFirst([...active, ...unseen]), shown: latest(unseen) });
    }
    state.items.set(id, item);
  }
  return state;
}

function ancestors(refs: RecordRef[], byRef: Map<string, ChangeRecord>): Set<string> {
  const seen = new Set<string>();
  const queue = refs.map(refKey);
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ref of byRef.get(key)?.r ?? []) queue.push(refKey(ref));
  }
  return seen;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const unique = (list: ChangeRecord[]) => [...new Map(list.map((r) => [refKey(r), r])).values()];

// ---- making changes ------------------------------------------------------
// Each builder returns one new record. The caller stamps it with its own id, next number and time.

export const addItem = (stamp: Stamp, values: Record<string, unknown>, id = newItemId()): ChangeRecord =>
  ({ ...stamp, op: 'add', item: id, v: values });

export function setField(state: TripState, stamp: Stamp, item: string, field: string, value: unknown): ChangeRecord {
  const heads = state.items.get(item)?.heads[field] ?? [];
  return { ...stamp, op: 'set', item, f: field, v: value, r: heads.map(refOf) };
}

export function deleteItem(state: TripState, stamp: Stamp, item: string): ChangeRecord {
  const heads = unique(Object.values(state.items.get(item)?.heads ?? {}).flat());
  return { ...stamp, op: 'delete', item, r: heads.map(refOf) };
}

/** An organizer picks one side of a conflict. */
export function resolve(state: TripState, stamp: Stamp, conflict: Conflict, choice: ChangeRecord): ChangeRecord {
  if (conflict.kind === 'field') {
    return setField(state, stamp, conflict.item, conflict.field!, valueOf(choice, conflict.field!));
  }
  if (choice.op === 'delete') return deleteItem(state, stamp, conflict.item);
  const deletes = conflict.options.filter((r) => r.op === 'delete');
  return { ...stamp, op: 'restore', item: conflict.item, r: deletes.map(refOf) };
}
