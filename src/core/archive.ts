// A finished trip in its compact form: only what the itinerary finally says, no change history,
// no keys, no tickets. This is what archived trips keep, and the trip.json inside a backup.

import type { TripState } from './merge';
import { shopLine, shopsOf } from './shops';

export interface Archived {
  v: 1;
  id: string;
  name: string;
  start: string;
  end: string;
  archivedAt: number;
  people: string[];
  items: Record<string, unknown>[]; // each item's fields, ordered by date and time
}

const byWhen = (x: Record<string, unknown>, y: Record<string, unknown>) =>
  `${x.date ?? '~'} ${x.start ?? '~'}`.localeCompare(`${y.date ?? '~'} ${y.start ?? '~'}`);

const tidy = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== '' && v !== undefined));

export function archive(trip: Omit<Archived, 'v' | 'items' | 'archivedAt'>, state: TripState, now = Date.now()): Archived {
  const items = [...state.items.values()].map((i) => tidy(i.values)).sort(byWhen);
  return { v: 1, ...trip, archivedAt: now, items };
}

const isText = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;

/** Checks a trip.json read from a backup file before it is trusted. */
export function readArchive(json: string): Archived | undefined {
  try {
    const a = JSON.parse(json);
    const fine = a?.v === 1 && isText(a.id, 64) && isText(a.name, 80) && isText(a.start, 10) && isText(a.end, 10) &&
      Number.isFinite(a.archivedAt) && Array.isArray(a.people) && a.people.length <= 64 && a.people.every((p: unknown) => isText(p, 60)) &&
      Array.isArray(a.items) && a.items.length <= 5000 &&
      a.items.every((i: unknown) => i && typeof i === 'object' && !Array.isArray(i) && JSON.stringify(i).length < 8000);
    return fine ? a : undefined;
  } catch {
    return undefined;
  }
}

const LINES: [string, string][] = [['addressLocal', '地址'], ['transport', '交通'], ['booking', '預約'], ['note', '想做的事']];

/** The itinerary as plain text, readable without this app. */
export function itineraryText(a: Archived): string {
  const out = [`${a.name}`, `${a.start} – ${a.end}`, `同行：${a.people.join('、')}`, ''];
  let day = '';
  for (const i of a.items) {
    const date = typeof i.date === 'string' ? i.date : '未排日期';
    if (date !== day) out.push('', `■ ${(day = date)}`);
    const time = [i.start, i.end].filter((t) => typeof t === 'string' && t).join('–');
    out.push(`${time ? `${time}  ` : ''}${String(i.title ?? '')}`);
    for (const [k, label] of LINES) if (typeof i[k] === 'string') out.push(`    ${label}：${i[k]}`);
    if (typeof i.lat === 'number' && typeof i.lng === 'number') out.push(`    座標：${i.lat}, ${i.lng}`);
    const shops = shopsOf(i);
    if (shops.length) out.push(`    店家：`, ...shops.map((s) => `      ・${shopLine(s)}`));
  }
  return `${out.join('\n').trim()}\n`;
}
