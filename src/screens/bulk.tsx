// Bulk import: paste (or pick a file of) many items at once, plus entries for this person's own shopping and
// packing lists. To get that text, hand the app's format instructions plus your own notes to an AI, and paste
// back what it writes. Members who cannot edit the itinerary import lists only.

import { useMemo, useState } from 'preact/hooks';
import { app } from '../app/store';
import { itemsOn, shortDay, undated } from '../app/trip';
import { type ListDraft, MAX_ITEMS, aiInstructions, parseBulk, withoutDuplicates } from '../core/bulk';
import { type ListEntry, type ListKind, entry } from '../core/lists';
import { shopsOf } from '../core/shops';
import { copyText, shareText } from '../platform/device';
import { Icon } from '../ui/icons';
import { BackBar } from '../ui/kit';

const MAX_FILE = 2 << 20;

export function Bulk() {
  const trip = app.trip!;
  const days = app.days;
  const [withCurrent, setWithCurrent] = useState(true);
  const [sent, setSent] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = useMemo(() => [...trip.state.items.values()].map((i) => i.values), [trip.state]);

  const canEdit = app.isOrganizer;
  const parsed = useMemo(() => (text.trim() ? parseBulk(text, days) : undefined), [text]);
  const items = canEdit && parsed ? withoutDuplicates(parsed.items, existing) : { fresh: [], duplicates: 0 };
  const { fresh, duplicates } = items;
  const ignored = !canEdit && parsed ? parsed.items.length : 0;
  const newIn = (kind: ListKind) => {
    const have = new Set(trip.lists[kind].map((e) => e.text.trim().toLowerCase()));
    return (parsed?.[kind] ?? []).filter((d) => !have.has(d.text.toLowerCase()) && have.add(d.text.toLowerCase()));
  };
  const shopping = newIn('shopping');
  const packing = newIn('packing');
  const total = fresh.length + shopping.length + packing.length;

  const instructions = () => {
    const current = withCurrent ? [...days.flatMap((d) => itemsOn(trip.state, d)), ...undated(trip.state, days)].map((i) => i.values) : [];
    const lists = withCurrent ? { shopping: trip.lists.shopping.map((e) => e.text), packing: trip.lists.packing.map((e) => e.text) } : undefined;
    return aiInstructions({ name: trip.meta.name, days }, current, { items: canEdit, lists });
  };
  const copy = async () => setSent((await copyText(instructions())) ? '已複製，貼到 AI 對話裡，接著貼上你的資料' : '複製失敗，請改用分享');
  const share = async () => setSent((await shareText(instructions())) ? '' : '這支手機不支援分享，請改用複製');

  const pick = async (e: { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file && file.size <= MAX_FILE) setText(await file.text());
    else if (file) setText('');
  };

  const run = async () => {
    setBusy(true);
    if (fresh.length) await app.addItems(fresh);
    const now = Date.now();
    const toEntries = (list: ListDraft[], kind: ListKind) => list
      .map((d, i) => entry(d.text, kind === 'shopping' ? { for: d.for, qty: d.qty, at: d.shop ? placeNamed(d.shop) : undefined } : {}, now + i))
      .filter((e): e is ListEntry => !!e);
    if (shopping.length) await app.addEntries('shopping', toEntries(shopping, 'shopping'));
    if (packing.length) await app.addEntries('packing', toEntries(packing, 'packing'));
    if (fresh.length) {
      const first = fresh.map((i) => i.date).filter((d): d is string => typeof d === 'string' && days.includes(d)).sort()[0];
      app.reset({ to: 'overview', day: first });
    } else {
      app.setPrefs({ listTab: shopping.length ? 'shopping' : 'packing' });
      app.reset({ to: 'lists' });
    }
  };

  return (
    <div class="screen">
      <BackBar title={canEdit ? '批次匯入' : '批次匯入清單'} />
      <main class="body end">
        <section class="card pad stack" style={{ gap: '10px' }}>
          <h2 class="legend" style={{ margin: 0 }}>1. 請 AI 幫忙整理（可略過）</h2>
          <p class="small muted">
            把「格式說明」貼給 ChatGPT、Claude 等 AI，再貼上你的{canEdit ? '筆記、訂位確認信或網頁內容' : '購物清單或行李清單'}。
            AI 會照格式整理好，複製它的回答貼到下面。{canEdit ? '行程會同步給大家；購物和行前準備只加到你自己的清單。' : '你在這趟旅程只能看行程，所以這裡只匯入你自己的購物和行前準備清單。'}
          </p>
          <label class="check-line small">
            <input type="checkbox" checked={withCurrent} onChange={() => setWithCurrent(!withCurrent)} />
            {canEdit ? `附上目前已排的 ${existing.length} 筆和我的清單，讓 AI 避免重複` : '附上我的清單，讓 AI 避免重複'}
          </label>
          <div class="pair">
            <button class="btn soft" onClick={copy}>複製格式說明</button>
            <button class="btn line" onClick={share}><Icon name="share" />分享給 AI</button>
          </div>
          {sent && <p class="small" role="status">{sent}</p>}
          <p class="small danger-text">AI 可能會給錯的時間、地址或座標，匯入前請務必查證，尤其是座標（貼到 Google 地圖搜尋確認位置）。</p>
          <p class="tiny muted">說明裡只有旅程名稱、日期{withCurrent ? (canEdit ? '、已排行程的時間與名稱和清單項目' : '和清單項目') : ''}，沒有成員或鑰匙。</p>
        </section>

        <section class="stack" style={{ gap: '8px' }}>
          <h2 class="legend" style={{ margin: 0 }}>2. 貼上要匯入的內容</h2>
          <textarea class="input" rows={7} value={text} onInput={(e) => setText(e.currentTarget.value)} aria-label="要匯入的內容"
            placeholder={canEdit ? 'AI 給的 JSON，或從試算表複製的表格\n（第一列是欄位名稱：日期、開始、結束、類型、標題、地址、座標、交通、預約、想做的事、店家）' : 'AI 給的 JSON'} />
          <label class="btn line">
            <Icon name="list" />選擇檔案（.json、.csv、.txt）
            <input type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" hidden onChange={pick} />
          </label>
        </section>

        {parsed && (
          <section class="stack" style={{ gap: '8px' }} aria-live="polite">
            <h2 class="legend" style={{ margin: 0 }}>3. 確認</h2>
            <p class={total ? 'ok-chip' : 'small muted'}>
              {total ? <><Icon name="check" />可以匯入{summary(fresh.length, shopping.length, packing.length)}</> : '沒有可以匯入的項目'}
              {duplicates > 0 && `（${duplicates} 筆行程已經有了，略過）`}
            </p>
            {ignored > 0 && <p class="small muted">另有 {ignored} 筆行程沒有匯入：只有主揪能改行程。</p>}
            {parsed.problems.length > 0 && (
              <ul class="note warn stack" style={{ gap: '4px', alignItems: 'stretch' }}>
                {parsed.problems.slice(0, 20).map((p) => <li>{p}</li>)}
                {parsed.problems.length > 20 && <li>…還有 {parsed.problems.length - 20} 則</li>}
              </ul>
            )}
            {fresh.length > 0 && (
              <ol class="card plan">
                {fresh.slice(0, 50).map((i) => (
                  <li class="plan-row">
                    <time>{typeof i.date === 'string' ? shortDay(i.date) : '—'}</time>
                    <span class="name">{i.start ? `${i.start}  ` : ''}{i.title}</span>
                  </li>
                ))}
                {fresh.length > 50 && <li class="plan-row muted">…還有 {fresh.length - 50} 筆</li>}
              </ol>
            )}
            {shopping.length > 0 && <p class="small"><b>購物：</b>{shopping.map((d) => d.text).join('、')}</p>}
            {packing.length > 0 && <p class="small"><b>行前準備：</b>{packing.map((d) => d.text).join('、')}</p>}
          </section>
        )}

        <button class="btn primary tall push-end" disabled={!total || busy} onClick={run}>
          {busy ? '匯入中…' : total ? `匯入${summary(fresh.length, shopping.length, packing.length)}` : '匯入'}
        </button>
        <p class="tiny muted center">
          {canEdit ? `一次最多 ${MAX_ITEMS} 筆行程。匯入的行程和手動新增的一樣，下次同步會傳給大家；清單只在你的手機上。` : '清單只在你的手機上，不會同步。'}
        </p>
      </main>
    </div>
  );
}

const summary = (items: number, shopping: number, packing: number) =>
  ' ' + [items && `${items} 筆行程`, shopping && `${shopping} 項購物`, packing && `${packing} 項行前準備`].filter(Boolean).join('、');

/** A stop or shop named in a list entry ("在哪買"): a shop name first, then a stop's title. */
function placeNamed(name: string): ListEntry['at'] {
  const want = name.trim().toLowerCase();
  const items = [...app.trip!.state.items.values()];
  for (const i of items) {
    const shop = shopsOf(i.values).find((s) => s.name.trim().toLowerCase() === want);
    if (shop) return { item: i.id, shop: shop.id };
  }
  const exact = items.find((i) => String(i.values.title ?? '').trim().toLowerCase() === want);
  const loose = exact ?? items.find((i) => { const t = String(i.values.title ?? '').toLowerCase(); return t && (t.includes(want) || want.includes(t)); });
  return loose && { item: loose.id };
}
