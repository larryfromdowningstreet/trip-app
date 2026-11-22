// What screens need to know about a trip, worked out from its merged state. No storage, no DOM.

import type { Bytes } from '../core/bytes';
import type { PublicIdentity } from '../core/crypto';
import type { ItemState, TripState } from '../core/merge';
import type { Batch } from '../core/bundle';
import type { Vector } from '../core/log';
import type { ChangeRecord, Trust } from '../core/model';

export interface TripMeta {
  id: string;
  name: string;
  start: string; // YYYY-MM-DD
  end: string;
  role: 'organizer' | 'member'; // what this phone's owner is in this trip
  people: number;
  lastSync?: number;
  code?: string; // sync code at the last sync
}

export interface Member extends PublicIdentity {
  trust: Trust; // how this phone treats their changes
}

export interface TripData {
  key: Bytes;
  members: Member[];
  records: ChangeRecord[]; // everything this phone has accepted, its own and others'
  batches: Batch[]; // others' changes exactly as they signed them, to pass on when collecting
  synced: Vector; // what this phone had at its last confirmed sync
  fresh: string[]; // items others changed in the last sync
}

export const TYPES = [
  ['sight', '景點'],
  ['transport', '交通'],
  ['meal', '用餐'],
  ['stay', '住宿'],
  ['gather', '集合'],
] as const;

/** Names of item fields as people see them (conflicts, forms). */
export const FIELD_NAMES: Record<string, string> = {
  date: '日期', start: '開始時間', end: '結束時間', type: '類型', title: '標題', place: '地點',
  addressLocal: '當地語言地址', lat: '座標', lng: '座標', transport: '交通方式', booking: '預約資訊',
  note: '備註', owner: '負責人',
};

// ---- dates and times ------------------------------------------------------
// Item dates and times are local to the destination. On the trip the phone is in that time zone too.

const WEEKDAYS = '日一二三四五六';
const pad = (n: number) => String(n).padStart(2, '0');

export const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const toMinutes = (hhmm: unknown) =>
  typeof hhmm === 'string' && /^\d{1,2}:\d{2}$/.test(hhmm) ? Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]) : undefined;

const parts = (date: string) => date.split('-').map(Number);
const asDate = (date: string) => new Date(Date.UTC(parts(date)[0], parts(date)[1] - 1, parts(date)[2]));

export function tripDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = asDate(start); d <= asDate(end) && days.length < 60; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export const daysBetween = (from: string, to: string) => Math.round((+asDate(to) - +asDate(from)) / 86_400_000);
export const weekday = (date: string) => WEEKDAYS[asDate(date).getUTCDay()];
export const shortDay = (date: string) => `${parts(date)[1]}/${parts(date)[2]}`;
export const longDay = (date: string) => `${parts(date)[1]} 月 ${parts(date)[2]} 日（${weekday(date)}）`;
export const yearDay = (date: string) => `${parts(date)[0]}/${parts(date)[1]}/${parts(date)[2]}`;

export function tripRange(meta: TripMeta): string {
  const sameYear = parts(meta.start)[0] === parts(meta.end)[0];
  return `${yearDay(meta.start)} – ${sameYear ? shortDay(meta.end) : yearDay(meta.end)}`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  if (dateOf(d) === dateOf(new Date(now))) return `今天 ${clock(ms)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${clock(ms)}`;
}

// ---- items ------------------------------------------------------------------

export function itemsOn(state: TripState, date: string): ItemState[] {
  return [...state.items.values()]
    .filter((i) => i.values.date === date)
    .sort((x, y) =>
      (toMinutes(x.values.start) ?? 9999) - (toMinutes(y.values.start) ?? 9999) ||
      String(x.values.title ?? '').localeCompare(String(y.values.title ?? '')) ||
      (x.id < y.id ? -1 : 1));
}

/** Items with no date or a date outside the trip, so they are not lost from view. */
export const undated = (state: TripState, days: string[]) =>
  [...state.items.values()].filter((i) => !days.includes(String(i.values.date ?? '')));

/** When an item is over: its end time, else half an hour after it starts (sooner if the next one starts first). */
function endsAt(items: ItemState[], i: number): number | undefined {
  const start = toMinutes(items[i].values.start);
  const end = toMinutes(items[i].values.end);
  if (end !== undefined && start !== undefined && end > start) return end;
  if (start === undefined) return undefined;
  return Math.min(start + 30, toMinutes(items[i + 1]?.values.start) ?? Infinity);
}

/** Index of the first item on `date` that is not over yet; days still to come start at 0. */
export function nextIndex(items: ItemState[], date: string, now: Date): number {
  const today = dateOf(now);
  if (date > today) return 0;
  if (date < today) return items.length;
  const m = minutesOf(now);
  const i = items.findIndex((_, k) => (endsAt(items, k) ?? 1440) > m);
  return i < 0 ? items.length : i;
}

/** "還有 25 分鐘", "還有 2 小時 5 分", "進行中", or '' when the item is not today. */
export function countdown(items: ItemState[], i: number, date: string, now: Date): string {
  if (date !== dateOf(now)) return '';
  const start = toMinutes(items[i]?.values.start);
  if (start === undefined) return '';
  const left = start - minutesOf(now);
  if (left <= 0) return '進行中';
  if (left < 60) return `還有 ${left} 分鐘`;
  return `還有 ${Math.floor(left / 60)} 小時${left % 60 ? ` ${left % 60} 分` : ''}`;
}

export const timeRange = (v: Record<string, unknown>) =>
  [v.start, v.end].filter((t) => typeof t === 'string' && t).join(' – ');

// ---- places -----------------------------------------------------------------

export interface Place {
  lat: number;
  lng: number;
}

const placeOf = (i: ItemState): Place | undefined =>
  typeof i.values.lat === 'number' && typeof i.values.lng === 'number' ? { lat: i.values.lat, lng: i.values.lng } : undefined;

/** Where the trip is on `date`: that day's first place, else the closest day that has one. */
export function placeFor(state: TripState, date: string): Place | undefined {
  let best: { place: Place; gap: number } | undefined;
  for (const item of state.items.values()) {
    const place = placeOf(item);
    if (!place || typeof item.values.date !== 'string') continue;
    const gap = Math.abs(daysBetween(date, item.values.date));
    if (!best || gap < best.gap) best = { place, gap };
  }
  return best?.place;
}

/** Reads "35.0116, 135.7681" or a map link that contains coordinates. */
export function parseCoords(text: string): Place | undefined {
  const m = /(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text.replace(/%2C/gi, ','));
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

export const formatCoords = (v: Record<string, unknown>) =>
  typeof v.lat === 'number' && typeof v.lng === 'number' ? `${v.lat}, ${v.lng}` : '';

/** A link that opens the phone's map app; the app itself never goes online. */
export function mapLink(v: Record<string, unknown>, navigate: boolean, apple: boolean): string | undefined {
  const where = typeof v.lat === 'number' && typeof v.lng === 'number' ? `${v.lat},${v.lng}` : String(v.addressLocal ?? v.place ?? '');
  if (!where) return undefined;
  const q = encodeURIComponent(where);
  if (apple) return navigate ? `https://maps.apple.com/?daddr=${q}` : `https://maps.apple.com/?q=${encodeURIComponent(String(v.title ?? where))}&ll=${q}`;
  return navigate ? `https://www.google.com/maps/dir/?api=1&destination=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** "Please take me here" in the language the address is written in. */
export function driverAsk(address: string): { lang: string; text: string } {
  if (/[぀-ヿ]/.test(address) || /[都道府県]|丁目/.test(address)) return { lang: 'ja', text: 'この住所までお願いします' };
  if (/[가-힯]/.test(address)) return { lang: 'ko', text: '이 주소로 가 주세요' };
  if (/[฀-๿]/.test(address)) return { lang: 'th', text: 'ช่วยไปส่งที่อยู่นี้ด้วยครับ/ค่ะ' };
  if (/[一-鿿]/.test(address)) return { lang: 'zh-Hant', text: '請載我到這個地址' };
  return { lang: 'en', text: 'Please take me to this address' };
}

export const initial = (name: string) => [...name.trim()].pop() ?? '?';
