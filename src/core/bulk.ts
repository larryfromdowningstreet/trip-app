// Adding many itinerary items at once, and the instructions that let an AI produce them.
//
// Two ways in, both pasted as text (or read from a file):
//   JSON   what an AI is asked to write: {"items": [ {...}, ... ], "shopping": [...], "packing": [...]} or just the array
//          (shopping and packing go into this person's own lists, which are never synced)
//   table  rows copied from a spreadsheet: a header row, then tab- or comma-separated values
// Everything is checked like any outside input: known fields only, plain types, sane lengths.

import { MAX_ENTRIES } from './lists';
import { MAX_SHOPS, SHOP, newShopId, shopValue } from './shops';

export const MAX_ITEMS = 500;

export interface Parsed {
  items: Record<string, unknown>[];
  shopping: ListDraft[];
  packing: ListDraft[];
  problems: string[]; // one line per row that was skipped or changed, for the preview
}

/** A list entry as written; `shop` names a stop or a shop of one, matched against the itinerary when imported. */
export interface ListDraft {
  text: string;
  for?: string;
  qty?: string;
  shop?: string;
}

/** Field name as written (English key or Chinese heading) → item field. */
const ALIASES: Record<string, string> = {
  date: 'date', 日期: 'date', day: 'day', 第幾天: 'day', 天: 'day',
  start: 'start', 開始: 'start', 開始時間: 'start', 時間: 'start',
  end: 'end', 結束: 'end', 結束時間: 'end',
  type: 'type', 類型: 'type',
  title: 'title', 標題: 'title', 名稱: 'title', 行程: 'title', 地點名稱: 'title',
  addresslocal: 'addressLocal', address: 'addressLocal', 地址: 'addressLocal', 當地地址: 'addressLocal', 當地語言地址: 'addressLocal',
  lat: 'lat', 緯度: 'lat', lng: 'lng', lon: 'lng', 經度: 'lng', coords: 'coords', 座標: 'coords',
  transport: 'transport', 交通: 'transport', 交通方式: 'transport',
  booking: 'booking', 預約: 'booking', 預約資訊: 'booking', 訂位: 'booking',
  note: 'note', notes: 'note', todo: 'note', 備註: 'note', 說明: 'note', 想做的事: 'note',
  shops: 'shops', 店家: 'shops', 店家清單: 'shops', 想逛的店: 'shops',
};

const TYPES: Record<string, string> = {
  sight: 'sight', 景點: 'sight', transport: 'transport', 交通: 'transport', meal: 'meal', 用餐: 'meal', 餐廳: 'meal',
  stay: 'stay', 住宿: 'stay', 飯店: 'stay', gather: 'gather', 集合: 'gather',
};

const LIMITS: Record<string, number> = { title: 80, addressLocal: 200, transport: 200, booking: 200, note: 1000 };

export function parseBulk(text: string, days: string[]): Parsed {
  const json = text.trim().startsWith('{') || text.trim().startsWith('[') || /```/.test(text) ? fromJson(text) : undefined;
  const rows = json ? json.rows : fromTable(text);
  const out: Parsed = { items: [], shopping: json?.shopping ?? [], packing: json?.packing ?? [], problems: [] };
  if (!rows || (!rows.length && !out.shopping.length && !out.packing.length)) {
    return { ...out, problems: ['看不懂這段內容：請貼上 AI 給的 JSON，或試算表複製的表格（第一列要是欄位名稱）。'] };
  }
  rows.slice(0, MAX_ITEMS).forEach((raw, i) => {
    const { item, problems } = clean(raw, days);
    const label = `第 ${i + 1} 筆${item.title ? `「${item.title}」` : ''}`;
    for (const p of problems) out.problems.push(`${label}：${p}`);
    if (item.title) out.items.push(item);
  });
  if (rows.length > MAX_ITEMS) out.problems.push(`一次最多 ${MAX_ITEMS} 筆，後面 ${rows.length - MAX_ITEMS} 筆沒有讀進來。`);
  return out;
}

function fromJson(text: string): { rows: Record<string, unknown>[]; shopping: ListDraft[]; packing: ListDraft[] } | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    const data = JSON.parse(fenced ? fenced[1] : text);
    const list = Array.isArray(data) ? data : data?.items ?? [];
    if (!Array.isArray(list)) return undefined;
    const lists = Array.isArray(data) ? {} : (data ?? {});
    return {
      rows: list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)),
      shopping: drafts(lists.shopping ?? lists.購物 ?? lists.購物清單),
      packing: drafts(lists.packing ?? lists.行前準備 ?? lists.要帶的東西),
    };
  } catch {
    return undefined;
  }
}

/** List entries as an AI writes them: names, or {name, for, qty, shop}. */
function drafts(x: unknown): ListDraft[] {
  if (!Array.isArray(x)) return [];
  const str = (y: unknown, max: number) => (typeof y === 'string' || typeof y === 'number' ? String(y).trim().slice(0, max) : '');
  return x.slice(0, MAX_ENTRIES).map((e): ListDraft => {
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      const o = e as Record<string, unknown>;
      const d: ListDraft = { text: str(o.name ?? o.text ?? o.名稱, 80) };
      const forWho = str(o.for ?? o.給誰, 30);
      const qty = str(o.qty ?? o.數量, 20);
      const shop = str(o.shop ?? o.where ?? o.在哪買, 80);
      if (forWho) d.for = forWho;
      if (qty) d.qty = qty;
      if (shop) d.shop = shop;
      return d;
    }
    return { text: str(e, 80) };
  }).filter((d) => d.text);
}

function fromTable(text: string): Record<string, unknown>[] | undefined {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return undefined;
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const head = cells(lines[0], sep).map((h) => ALIASES[h.trim().toLowerCase()] ?? ALIASES[h.trim()]);
  if (!head.includes('title')) return undefined;
  return lines.slice(1).map((line) => {
    const row: Record<string, unknown> = {};
    cells(line, sep).forEach((v, i) => head[i] && (row[head[i]] = v.trim()));
    return row;
  });
}

/** Splits one line, honouring "quoted, values" as spreadsheets write them. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') (cur += '"', i++);
    else if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) (out.push(cur), (cur = ''));
    else cur += c;
  }
  out.push(cur);
  return out;
}

const time = (v: unknown) => {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(String(v ?? '').trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
};

const date = (v: unknown) => {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
};

function clean(raw: Record<string, unknown>, days: string[]) {
  const problems: string[] = [];
  const v: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(raw)) {
    const field = ALIASES[k.toLowerCase()] ?? ALIASES[k] ?? (k === 'addressLocal' ? 'addressLocal' : undefined);
    if (field && x !== null && x !== '' && x !== undefined) v[field] = x;
  }
  const item: Record<string, string | number> = {};
  const text = (field: string) => {
    if (v[field] === undefined) return;
    const s = String(v[field]).trim().slice(0, LIMITS[field]);
    if (s) item[field] = s;
  };
  text('title');
  if (!item.title) problems.push('沒有標題，略過');

  const day = Number(v.day);
  const d = date(v.date) ?? (Number.isInteger(day) && day >= 1 && day <= days.length ? days[day - 1] : undefined);
  if (d) item.date = d;
  if (v.date !== undefined || v.day !== undefined) {
    if (!d) problems.push(`看不懂日期「${String(v.date ?? v.day)}」，先放在「口袋名單」`);
    else if (!days.includes(d)) problems.push(`${d} 不在這趟旅程的日期內，先放在「口袋名單」`);
  }
  for (const f of ['start', 'end'] as const) {
    if (v[f] === undefined) continue;
    const t = time(v[f]);
    if (t) item[f] = t;
    else problems.push(`看不懂時間「${String(v[f])}」，略過這個時間`);
  }
  if (v.type !== undefined) {
    const t = TYPES[String(v.type).trim().toLowerCase()] ?? TYPES[String(v.type).trim()];
    if (t) item.type = t;
  }
  const coords = typeof v.coords === 'string' ? /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(v.coords) : undefined;
  const lat = Number(coords ? coords[1] : v.lat);
  const lng = Number(coords ? coords[2] : v.lng);
  if ((v.lat !== undefined || coords) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    item.lat = lat;
    item.lng = lng;
  }
  for (const f of ['addressLocal', 'transport', 'booking', 'note']) text(f);
  const out: Record<string, unknown> = item;
  shopsFrom(v.shops).forEach((s, i) => {
    const value = shopValue({ ...s, t: i });
    if (value) out[SHOP + newShopId()] = value;
  });
  return { item: out, problems };
}

/** Shops as an AI writes them ([{name, where, buy}] or names) or a table cell ("店A、店B (3F)"). */
function shopsFrom(x: unknown): { name: string; where?: string; buy?: string }[] {
  const str = (y: unknown) => (typeof y === 'string' || typeof y === 'number' ? String(y) : '');
  const list = Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[、;；\n]/) : [];
  return list.slice(0, MAX_SHOPS).map((s) => {
    if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      return { name: str(o.name ?? o.店名), where: str(o.where ?? o.位置 ?? o.樓層), buy: str(o.buy ?? o.想買) };
    }
    const m = /^(.*?)[（(]([^）)]*)[）)]\s*$/.exec(str(s).trim());
    return m ? { name: m[1], where: m[2] } : { name: str(s) };
  }).filter((s) => s.name.trim());
}

/** Items already in the trip with the same date, start and title are left out, so pasting twice is harmless. */
export function withoutDuplicates(items: Parsed['items'], existing: Record<string, unknown>[]) {
  const key = (i: Record<string, unknown>) => `${i.date ?? ''}|${i.start ?? ''}|${String(i.title ?? '').trim()}`;
  const seen = new Set(existing.map(key));
  const fresh = items.filter((i) => !seen.has(key(i)) && seen.add(key(i)));
  return { fresh, duplicates: items.length - fresh.length };
}

/** The text to give an AI together with notes, bookings or a messy plan: it explains exactly what to write back.
 *  `items: false` (a member who cannot edit the itinerary) asks only for the two personal lists. */
export function aiInstructions(
  trip: { name: string; days: string[] },
  current: Record<string, unknown>[] = [],
  opts: { items?: boolean; lists?: { shopping: string[]; packing: string[] } } = {},
): string {
  const withItems = opts.items !== false;
  const daysList = trip.days.map((d, i) => `第 ${i + 1} 天 = ${d}`).join('、');
  const now = withItems && current.length
    ? `\n目前已經排好的行程如下，不要重複列出，時間也不要和它們衝突：\n${JSON.stringify(current.map(({ date: d, start, end, title }) => ({ date: d, start, end, title })))}\n`
    : '';
  const have = opts.lists && (opts.lists.shopping.length || opts.lists.packing.length)
    ? `\n我的清單裡已經有這些，不要重複：\n購物：${opts.lists.shopping.join('、') || '（無）'}\n行前準備：${opts.lists.packing.join('、') || '（無）'}\n`
    : '';
  const itemFormat = `  "items": [
    {
      "date": "YYYY-MM-DD（必須在上面的日期內；還沒決定哪天去就省略，會放進口袋名單）",
      "start": "HH:MM（24 小時制，沒有就省略）",
      "end": "HH:MM（沒有就省略）",
      "type": "sight 景點 | transport 交通 | meal 用餐 | stay 住宿 | gather 集合，擇一填英文",
      "title": "簡短名稱（必填）",
      "addressLocal": "當地語言的完整地址，給計程車司機看（例如日本就用日文地址）",
      "lat": 緯度數字,
      "lng": 經度數字,
      "transport": "怎麼過去",
      "booking": "訂位代號、時間、人數等",
      "note": "想做的事、要提醒大家的事",
      "shops": [{"name": "店名", "where": "樓層或位置（沒有就省略）", "buy": "想買什麼（沒有就省略）"}]
    }
  ],
`;
  const listFormat = `  "shopping": [{"name": "要買的東西（必填）", "for": "給誰（沒有就省略）", "qty": "數量，例如 2 盒（沒有就省略）", "shop": "在哪買：行程名稱或店名（沒有就省略）"}],
  "packing": ["要帶的東西", "…"]`;
  const rules = withItems
    ? `1. 一個地點或一段移動是一筆；同一天依時間排序。購物中心或商店街裡想逛的店放在該筆的 shops，不要拆成很多筆。
2. 沒有把握的欄位就省略，不要猜，尤其是座標、地址和訂位資訊。座標請確認是該地點本身，不要用城市中心代替。
3. 要買的東西放 shopping，要帶的東西（行李、證件、藥品等）放 packing；資料裡沒有就給空陣列。
4. 只使用上面列出的欄位名稱，數字不要加引號。`
    : `1. 要買的東西放 shopping，要帶的東西（行李、證件、藥品等）放 packing；資料裡沒有就給空陣列。
2. shop 只寫資料裡提到的地點或店名，沒有就省略。
3. 只使用上面列出的欄位名稱。`;
  const example = withItems
    ? `{"items":[{"date":"${trip.days[0] ?? '2027-03-10'}","start":"13:30","end":"15:00","type":"sight","title":"清水寺","addressLocal":"京都府京都市東山区清水1丁目294","lat":34.9949,"lng":135.785,"transport":"市巴士 206 號到五條坂，步行 10 分鐘"}],"shopping":[{"name":"七味粉","for":"媽媽","qty":"2 罐","shop":"清水寺"}],"packing":["護照","轉接頭"]}`
    : `{"shopping":[{"name":"七味粉","for":"媽媽","qty":"2 罐"}],"packing":["護照","轉接頭"]}`;
  return `請把我接下來提供的資料（筆記、${withItems ? '訂位確認信、網頁內容' : '購物清單、行李清單'}等）整理${withItems ? '成旅遊行程和清單' : '成清單'}，只輸出一個 JSON 程式碼區塊，不要其他說明。

旅程：${trip.name}
日期：${daysList}
${now}${have}
格式：
\`\`\`json
{
${withItems ? itemFormat : ''}${listFormat}
}
\`\`\`

規則：
${rules}

範例：
\`\`\`json
${example}
\`\`\`

我的資料如下：
`;
}
