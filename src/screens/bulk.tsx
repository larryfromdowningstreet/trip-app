// Bulk import: paste (or pick a file of) many items at once. To get that text, an organizer can hand the
// app's format instructions plus their own notes to an AI, and paste back what it writes.

import { useMemo, useState } from 'preact/hooks';
import { app } from '../app/store';
import { itemsOn, shortDay, undated } from '../app/trip';
import { MAX_ITEMS, aiInstructions, parseBulk, withoutDuplicates } from '../core/bulk';
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

  const parsed = useMemo(() => (text.trim() ? parseBulk(text, days) : undefined), [text]);
  const { fresh, duplicates } = parsed ? withoutDuplicates(parsed.items, existing) : { fresh: [], duplicates: 0 };

  const instructions = () => {
    const current = withCurrent ? [...days.flatMap((d) => itemsOn(trip.state, d)), ...undated(trip.state, days)].map((i) => i.values) : [];
    return aiInstructions({ name: trip.meta.name, days }, current);
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
    await app.addItems(fresh);
    const first = fresh.map((i) => i.date).filter((d): d is string => typeof d === 'string' && days.includes(d)).sort()[0];
    app.reset({ to: 'overview', day: first });
  };

  return (
    <div class="screen">
      <BackBar title="批次匯入行程" />
      <main class="body end">
        <section class="card pad stack" style={{ gap: '10px' }}>
          <h2 class="legend" style={{ margin: 0 }}>1. 請 AI 幫忙整理（可略過）</h2>
          <p class="small muted">把「格式說明」貼給 ChatGPT、Claude 等 AI，再貼上你的筆記、訂位確認信或網頁內容。AI 會照格式整理好，複製它的回答貼到下面。</p>
          <label class="check-line small">
            <input type="checkbox" checked={withCurrent} onChange={() => setWithCurrent(!withCurrent)} />
            附上目前已排的 {existing.length} 筆，讓 AI 避免重複
          </label>
          <div class="pair">
            <button class="btn soft" onClick={copy}>複製格式說明</button>
            <button class="btn line" onClick={share}><Icon name="share" />分享給 AI</button>
          </div>
          {sent && <p class="small" role="status">{sent}</p>}
          <p class="small danger-text">AI 可能會給錯的時間、地址或座標，匯入前請務必查證，尤其是座標（貼到 Google 地圖搜尋確認位置）。</p>
          <p class="tiny muted">說明裡只有旅程名稱、日期和已排行程的時間與名稱，沒有成員或鑰匙。</p>
        </section>

        <section class="stack" style={{ gap: '8px' }}>
          <h2 class="legend" style={{ margin: 0 }}>2. 貼上要匯入的內容</h2>
          <textarea class="input" rows={7} value={text} onInput={(e) => setText(e.currentTarget.value)} aria-label="要匯入的內容"
            placeholder={'AI 給的 JSON，或從試算表複製的表格\n（第一列是欄位名稱：日期、開始、結束、類型、標題、地址、座標、交通、預約、備註）'} />
          <label class="btn line">
            <Icon name="list" />選擇檔案（.json、.csv、.txt）
            <input type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" hidden onChange={pick} />
          </label>
        </section>

        {parsed && (
          <section class="stack" style={{ gap: '8px' }} aria-live="polite">
            <h2 class="legend" style={{ margin: 0 }}>3. 確認</h2>
            <p class={fresh.length ? 'ok-chip' : 'small muted'}>
              {fresh.length ? <><Icon name="check" />可以匯入 {fresh.length} 筆</> : '沒有可以匯入的項目'}
              {duplicates > 0 && `（${duplicates} 筆已經有了，略過）`}
            </p>
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
          </section>
        )}

        <button class="btn primary tall push-end" disabled={!fresh.length || busy} onClick={run}>
          {busy ? '匯入中…' : fresh.length ? `匯入 ${fresh.length} 筆` : '匯入'}
        </button>
        <p class="tiny muted center">一次最多 {MAX_ITEMS} 筆。匯入的項目和手動新增的一樣，下次同步會傳給大家。</p>
      </main>
    </div>
  );
}
