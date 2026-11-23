// Finished trips: the read-only archive view, backups out and back in, and deleting with the PIN.

import { shopLine, shopsOf } from '../core/shops';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { app } from '../app/store';
import { type TripMeta, longDay, tripDays, tripRange } from '../app/trip';
import { BackupFailure, MIN_PASSWORD } from '../core/backup';
import { WIPE_AT } from '../core/pin';
import { saveFile } from '../platform/device';
import { Icon } from '../ui/icons';
import { BackBar, PinBoxes, Sheet, useAsync } from '../ui/kit';

export const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function ArchivedTrip({ id }: { id: string }) {
  const meta = app.trips.find((t) => t.id === id);
  const trip = useAsync(() => app.readArchive(id), [id]);
  if (!meta) return null;
  const days = tripDays(meta.start, meta.end);
  const on = (d: string) => trip?.items.filter((i) => i.date === d) ?? [];
  const loose = trip?.items.filter((i) => !days.includes(String(i.date ?? ''))) ?? [];
  const row = (i: Record<string, unknown>, k: number) => (
    <li key={k} class="plan-row" style={{ alignItems: 'flex-start' }}>
      <time>{String(i.start ?? '')}</time>
      <span class="name">
        {String(i.title ?? '')}
        {typeof i.addressLocal === 'string' && <span class="tiny muted" style={{ display: 'block' }}>{i.addressLocal}</span>}
        {typeof i.note === 'string' && <span class="tiny muted" style={{ display: 'block' }}>{i.note}</span>}
        {shopsOf(i).length > 0 && <span class="tiny muted" style={{ display: 'block' }}>店家：{shopsOf(i).map(shopLine).join('、')}</span>}
      </span>
    </li>
  );
  return (
    <div class="screen">
      <BackBar title={meta.name} sub={`${tripRange(meta)} · 已封存（唯讀）`} />
      <main class="body end">
        {trip && <p class="small muted">同行：{trip.people.join('、')}</p>}
        {days.map((d, n) => (
          <Fragment key={d}>
            <h2 class="section-label">第 {n + 1} 天 · {longDay(d)}</h2>
            <ol class="card plan">{on(d).length ? on(d).map(row) : <li class="empty" style={{ padding: '16px' }}>沒有安排</li>}</ol>
          </Fragment>
        ))}
        {loose.length > 0 && (<><h2 class="section-label">沒排日期</h2><ol class="card plan">{loose.map(row)}</ol></>)}
        <button class="btn soft tall push-end" onClick={() => app.go({ to: 'export', id })}>匯出備份</button>
      </main>
    </div>
  );
}

export function Export({ id }: { id: string }) {
  const meta = app.trips.find((t) => t.id === id)!;
  const [tickets, setTickets] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const short = password.length > 0 && password.length < MIN_PASSWORD;
  const ready = password.length >= MIN_PASSWORD && again === password && !busy;

  const run = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const file = await app.backup(id, password, tickets);
      await saveFile(file.name, file.bytes, 'application/zip');
      setDone(`${file.name}（${kb(file.bytes.length)}）`);
    } catch (err) {
      setError(`匯出失敗：${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };

  return (
    <div class="screen">
      <BackBar title="匯出備份" />
      <form class="body end" onSubmit={run}>
        <div class="card pad stack" style={{ gap: '4px' }}>
          <b class="title" style={{ fontSize: '18px' }}>{meta.name}</b>
          <span class="small muted">{tripRange(meta)}{meta.archived ? ` · ${kb(meta.archived.size)}` : ''}</span>
        </div>
        {meta.archived ? (
          <p class="small muted">封存時票券截圖已經刪除，備份只含行程。</p>
        ) : (
          <label class="card pad spread">
            <span class="stack" style={{ gap: '2px' }}><span>包含票券截圖</span><span class="small muted">檔案會變大</span></span>
            <input type="checkbox" class="big-check" checked={tickets} onChange={() => setTickets(!tickets)} />
          </label>
        )}
        <label class="field">備份密碼
          <input class="input lg" type="password" autocomplete="new-password" value={password} onInput={(e) => (setPassword(e.currentTarget.value), setDone(''))} />
        </label>
        <label class="field">再輸入一次
          <input class="input lg" type="password" autocomplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
        </label>
        <p class={short ? 'error' : 'hint'}>
          至少 {MIN_PASSWORD} 個字元。檔案離開手機後沒有猜錯次數的限制，所以不能用 4 位數 PIN 碼。
        </p>
        {again.length >= password.length && again && again !== password && <p class="error">兩次輸入的不一樣。</p>}
        <p class="note warn"><Icon name="warn" />忘記這組密碼就打不開備份檔，沒有人能幫你找回。</p>
        {done && <p class="ok-chip"><Icon name="check" />已匯出：{done}</p>}
        {error && <p class="error">{error}</p>}
        <div class="stack push-end">
          <button class="btn primary tall" disabled={!ready}>{busy ? '匯出中…' : '匯出檔案'}</button>
          <p class="tiny muted center">格式公開：AES-256 加密的 zip 檔，沒有這個 App 也能用 7-Zip 等標準工具解開。</p>
        </div>
      </form>
    </div>
  );
}

export function Import() {
  const [file, setFile] = useState<File>();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (e: Event) => {
    e.preventDefault();
    if (!file || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const meta = await app.importBackup(new Uint8Array(await file.arrayBuffer()), password);
      app.reset({ to: 'trips' });
      app.go({ to: 'archived', id: meta.id });
    } catch (err) {
      const code = err instanceof BackupFailure ? err.code : err instanceof Error ? err.message : '';
      setError(code === 'password' ? '密碼不對。' : code === 'exists' ? '這趟旅程已經在這支手機上了。'
        : code === 'too-large' ? '檔案太大。' : '這不是本 App 的備份檔，或檔案已損壞。');
    }
    setBusy(false);
  };

  return (
    <div class="screen">
      <BackBar title="從備份匯入" />
      <form class="body end" onSubmit={run}>
        <p class="small muted">選擇之前匯出的備份檔（.zip），輸入當時設定的密碼。匯入的旅程會放在「已封存」，只能看不能改。</p>
        <label class="btn line tall">
          <Icon name="share" />{file ? file.name : '選擇備份檔'}
          <input type="file" accept=".zip,application/zip" hidden onChange={(e) => (setFile(e.currentTarget.files?.[0]), setError(''))} />
        </label>
        <label class="field">備份密碼
          <input class="input lg" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {error && <p class="error">{error}</p>}
        <button class="btn primary tall push-end" disabled={!file || !password || busy}>{busy ? '匯入中…' : '匯入'}</button>
      </form>
    </div>
  );
}

/** Deleting a trip asks for the PIN, so someone holding an unlocked phone cannot wipe it in passing. */
export function DeleteTrip({ trip, onClose }: { trip: TripMeta; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const enter = async (v: string) => {
    setPin(v);
    if (v.length < 4) return;
    const r = await app.checkPin(v);
    if (r.ok) {
      onClose();
      await app.deleteTrip(trip.id);
    } else if (!r.wiped) {
      setPin('');
      setError(r.wait ? `請等 ${Math.ceil(r.wait / 1000)} 秒再試` : `PIN 碼不對，還可以試 ${WIPE_AT - r.fails} 次`);
    }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>刪除「{trip.name}」？</h2>
      <p>{trip.archived ? '封存的行程會從這支手機刪除，沒辦法復原。需要的話先匯出備份。' : '這趟旅程會從這支手機刪除。其他人的手機不受影響，之後可以再請主揪互掃加入。'}</p>
      <PinBoxes label="輸入 PIN 碼確認刪除" value={pin} onInput={enter} autoFocus />
      {error ? <p class="error">{error}</p> : <p class="hint">輸入 PIN 碼確認刪除</p>}
      <button class="btn line" onClick={onClose}>取消</button>
    </Sheet>
  );
}
