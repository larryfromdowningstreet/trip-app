// The data every phone keeps: change records. The itinerary itself is computed from them (see merge.ts).

import type { KeyId } from './crypto';

/** Every field an itinerary item can have, in one place. Forms and validation are built from this. */
export const ITEM_FIELDS = {
  date: 'string', // local date at the destination, YYYY-MM-DD
  start: 'string', // HH:MM
  end: 'string',
  type: 'string', // sight | transport | meal | stay | gather
  title: 'string',
  place: 'string',
  addressLocal: 'string', // in the local language, for taxi drivers
  lat: 'number',
  lng: 'number',
  transport: 'string',
  booking: 'string',
  note: 'string',
  owner: 'string', // which organizer looks after this day or item
} as const;

export type ItemField = keyof typeof ITEM_FIELDS;
export type ItemValues = Partial<Record<ItemField, string | number>>;

export interface RecordRef {
  a: KeyId; // author
  s: number; // that author's sequence number, 1, 2, 3...
}

/**
 * One change by one person. Kept short because it travels in QR Codes.
 * Unknown ops and fields are kept and passed on, so an older app never drops what a newer one wrote.
 */
export interface ChangeRecord extends RecordRef {
  t: number; // UTC milliseconds; only used to pick what to show while a conflict waits
  op: string; // add | set | delete | restore
  item: string;
  f?: string; // field, for set
  v?: unknown; // add: all fields; set: the new value
  r?: RecordRef[]; // the records this one replaces
}

export type Stamp = Pick<ChangeRecord, 'a' | 's' | 't'>;

export const refKey = (r: RecordRef) => `${r.a}:${r.s}`;
export const refOf = ({ a, s }: RecordRef): RecordRef => ({ a, s });

/** How this phone treats each person's changes. Every phone decides for itself. */
export type Access = 'edit' | 'view' | 'blocked';

export interface Trust {
  access: Access;
  blockedAfter?: number; // when blocked: changes up to this number still count
}

export function accepts(trust: Trust | undefined, record: RecordRef): boolean {
  if (!trust) return false;
  if (trust.access === 'edit') return true;
  if (trust.access === 'blocked') return record.s <= (trust.blockedAfter ?? 0);
  return false;
}

export function newItemId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b & 31]).join('');
}

const isRef = (x: unknown): x is RecordRef =>
  typeof x === 'object' && x !== null &&
  typeof (x as RecordRef).a === 'string' && /^[0-9a-f]{16}$/.test((x as RecordRef).a) &&
  Number.isSafeInteger((x as RecordRef).s) && (x as RecordRef).s > 0;

/** Shape check for records read from outside. A valid signature does not make content well-formed. */
export function isChangeRecord(x: unknown): x is ChangeRecord {
  if (!isRef(x)) return false;
  const r = x as ChangeRecord;
  return Number.isFinite(r.t) &&
    typeof r.op === 'string' && r.op.length <= 16 &&
    typeof r.item === 'string' && r.item.length > 0 && r.item.length <= 64 &&
    (r.f === undefined || (typeof r.f === 'string' && r.f.length <= 32)) &&
    (r.r === undefined || (Array.isArray(r.r) && r.r.length <= 64 && r.r.every(isRef)));
}
