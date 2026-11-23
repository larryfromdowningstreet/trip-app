// The shops to visit at a stop (a mall, a shopping street). Each shop is its own field of the item,
// "shop.<id>", so two people adding shops never conflict; removing one sets its field to null.

export const SHOP = 'shop.';
export const MAX_SHOPS = 60;
const LIMITS = { n: 60, w: 40, b: 200 };

/** What a shop field holds: name, where (floor, wing), what to buy, and when it was added (for order). */
export interface ShopValue {
  n: string;
  w?: string;
  b?: string;
  t: number;
}

export interface Shop {
  id: string;
  name: string;
  where: string;
  buy: string;
  t: number;
}

export const isShopField = (field: string) => field.startsWith(SHOP) && /^[0-9A-Za-z]{1,24}$/.test(field.slice(SHOP.length));

const isText = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;

/** Shape check for a shop value read from outside. */
export function isShopValue(v: unknown): v is ShopValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const s = v as ShopValue;
  return isText(s.n, LIMITS.n) && s.n.trim() !== '' && Number.isFinite(s.t) &&
    (s.w === undefined || isText(s.w, LIMITS.w)) && (s.b === undefined || isText(s.b, LIMITS.b));
}

/** The shops of an item, in the order they were added. */
export function shopsOf(values: Record<string, unknown>): Shop[] {
  return Object.entries(values)
    .filter(([f, v]) => isShopField(f) && isShopValue(v))
    .map(([f, v]) => {
      const s = v as ShopValue;
      return { id: f.slice(SHOP.length), name: s.n, where: s.w ?? '', buy: s.b ?? '', t: s.t };
    })
    .sort((x, y) => x.t - y.t || x.id.localeCompare(y.id));
}

/** A shop as stored, trimmed and cut to length; undefined when it has no name. */
export function shopValue(s: { name: string; where?: string; buy?: string; t: number }): ShopValue | undefined {
  const n = s.name.trim().slice(0, LIMITS.n);
  if (!n) return undefined;
  const w = (s.where ?? '').trim().slice(0, LIMITS.w);
  const b = (s.buy ?? '').trim().slice(0, LIMITS.b);
  return { n, ...(w && { w }), ...(b && { b }), t: s.t };
}

/** One line for plain text: 店名（位置）：想買. */
export const shopLine = (s: Pick<Shop, 'name' | 'where' | 'buy'>) =>
  `${s.name}${s.where ? `（${s.where}）` : ''}${s.buy ? `：${s.buy}` : ''}`;

export function newShopId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b & 31]).join('');
}
