// Each person's own shopping list and packing list for a trip. They stay on this phone (inside the vault)
// and are never synced; backups carry them, and a new trip can start from the last trip's packing list.

export type ListKind = 'shopping' | 'packing';

export interface ListEntry {
  id: string;
  text: string;
  done?: boolean;
  for?: string; // shopping: who it is for
  qty?: string; // shopping: how many, as written ("12 盒")
  at?: { item: string; shop?: string }; // shopping: where to buy it, an itinerary item and one of its shops
  where?: string; // the same in words, in archived trips (which keep no item ids)
  t: number; // when it was added, for order
}

export interface Lists {
  shopping: ListEntry[];
  packing: ListEntry[];
}

export const KINDS: readonly (readonly [ListKind, string, string])[] = [
  ['shopping', '購物', '已買'],
  ['packing', '行前準備', '已準備'],
];

export const MAX_ENTRIES = 300;
const LIMITS = { text: 80, for: 30, qty: 20, id: 24 };

export const emptyLists = (): Lists => ({ shopping: [], packing: [] });

export function newEntryId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b & 31]).join('');
}

/** A new entry from what was typed; undefined when nothing is left after trimming. */
export function entry(text: string, extra: Partial<Omit<ListEntry, 'id' | 'text'>> = {}, t = Date.now()): ListEntry | undefined {
  const name = text.trim().slice(0, LIMITS.text);
  if (!name) return undefined;
  const e: ListEntry = { id: newEntryId(), text: name, t };
  const forWho = extra.for?.trim().slice(0, LIMITS.for);
  const qty = extra.qty?.trim().slice(0, LIMITS.qty);
  if (forWho) e.for = forWho;
  if (qty) e.qty = qty;
  if (extra.at) e.at = extra.at;
  if (extra.done) e.done = true;
  return e;
}

/** Pasted text, one thing per line, without the bullets and checkboxes people copy along ("- ", "1.", "☐", "[x]"). */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•・‧▪︎☐☑✓✔□■]|\[[ xX✓]?\]|\d{1,3}[.)、])\s*/u, '').trim())
    .filter(Boolean);
}

/** The packing list a new trip starts from: same things, nothing ticked, new ids. */
export function copyPacking(from: ListEntry[], now = Date.now()): ListEntry[] {
  return from.slice(0, MAX_ENTRIES).map((e, i) => ({ id: newEntryId(), text: e.text, t: now + i }));
}

const isText = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;

function readEntry(x: unknown): ListEntry | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const e = x as Record<string, unknown>;
  if (!isText(e.id, LIMITS.id) || !isText(e.text, LIMITS.text) || !(e.text as string).trim() || !Number.isFinite(e.t)) return undefined;
  const out: ListEntry = { id: e.id as string, text: e.text as string, t: e.t as number };
  if (e.done === true) out.done = true;
  if (isText(e.for, LIMITS.for) && e.for) out.for = e.for as string;
  if (isText(e.qty, LIMITS.qty) && e.qty) out.qty = e.qty as string;
  if (isText(e.where, 120) && e.where) out.where = e.where as string;
  const at = e.at as Record<string, unknown> | undefined;
  if (at && typeof at === 'object' && isText(at.item, 64) && (at.shop === undefined || isText(at.shop, 32))) {
    out.at = at.shop ? { item: at.item as string, shop: at.shop as string } : { item: at.item as string };
  }
  return out;
}

/** Checks lists read from a backup (or anything stored) before they are trusted. */
export function readLists(x: unknown): Lists | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const l = x as Record<string, unknown>;
  const one = (y: unknown) => (Array.isArray(y) ? y.slice(0, MAX_ENTRIES).map(readEntry).filter((e): e is ListEntry => !!e) : []);
  return { shopping: one(l.shopping), packing: one(l.packing) };
}

export const hasEntries = (l: Lists | undefined) => !!l && (l.shopping.length > 0 || l.packing.length > 0);

/** Things to do first, then the ones ticked off; each part in the order they were added. */
export function ordered(list: ListEntry[]): { todo: ListEntry[]; done: ListEntry[] } {
  const sorted = [...list].sort((x, y) => x.t - y.t || x.id.localeCompare(y.id));
  return { todo: sorted.filter((e) => !e.done), done: sorted.filter((e) => e.done) };
}

/** "給媽媽・2 盒" */
export const entryDetail = (e: ListEntry) => [e.for && `給${e.for}`, e.qty].filter(Boolean).join('・');

/** The lists as plain text, for the backup's text file. `where` names an entry's place to buy. */
export function listsText(lists: Lists, where: (e: ListEntry) => string = (e) => e.where ?? ''): string {
  const out: string[] = [];
  for (const [kind, name] of KINDS) {
    const list = lists[kind];
    if (!list.length) continue;
    const { todo, done } = ordered(list);
    out.push('', `■ ${name}清單`);
    for (const e of [...todo, ...done]) {
      const detail = [entryDetail(e), where(e) && `在${where(e)}買`].filter(Boolean).join('，');
      out.push(`${e.done ? '[v]' : '[ ]'} ${e.text}${detail ? `（${detail}）` : ''}`);
    }
  }
  return out.join('\n');
}
