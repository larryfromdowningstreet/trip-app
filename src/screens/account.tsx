// Trip list, new trip, settings, change PIN.

import { useState } from 'preact/hooks';
import { app } from '../app/store';
import { PALETTES, nextSwitch } from '../app/theme';
import { daysBetween, placeFor, tripRange, when, dateOf } from '../app/trip';
import { checkPin } from '../core/pin';
import type { ThemeSetting } from '../core/sun';
import { Icon } from '../ui/icons';
import { BackBar, PinBoxes, Sheet, Tabs } from '../ui/kit';
import { OfflineChip } from './start';

export function Trips() {
  const trips = [...app.trips].sort((x, y) => (x.start < y.start ? 1 : -1));
  return (
    <div class="screen">
      <header class="bar">
        <h1 class="title">我的旅程</h1>
        <button class="icon-btn" aria-label="設定" onClick={() => app.go({ to: 'settings' })}><Icon name="gear" size={22} /></button>
      </header>
      <main class="body end">
        {trips.length > 0 && <h2 class="section-label">進行中</h2>}
        {trips.map((t) => (
          <button class={t.id === app.trip?.meta.id ? 'card accent pad trip-card' : 'card pad trip-card'} onClick={() => app.openTrip(t.id)}>
            <span class="trip-card-top"><b>{t.name}</b><Icon name="next" /></span>
            <span class="small muted">{tripRange(t)} · {t.people} 人</span>
            <span class="small muted">
              {t.code ? <>同步碼 <b class="inline-code">{t.code}</b> · </> : null}
              {t.lastSync ? `${when(t.lastSync)} 同步` : '還沒有同步過'}
            </span>
          </button>
        ))}
        {trips.length === 0 && (
          <div class="empty">
            <Icon name="pin" size={36} width={1.5} />
            <p>還沒有旅程。<br />自己建立一個，或請主揪面對面掃描加入。</p>
          </div>
        )}
        <div class="stack push-end">
          <button class="btn primary tall" onClick={() => app.go({ to: 'newTrip' })}>建立新旅程</button>
          <button class="btn soft tall" onClick={() => app.go({ to: 'enroll', join: true })}>加入旅程（面對面互掃）</button>
        </div>
      </main>
    </div>
  );
}

export function NewTrip() {
  const today = dateOf(new Date());
  const [name, setName] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const length = daysBetween(start, end) + 1;
  const problem = !start || !end ? '請選擇日期' : length < 1 ? '回程日要在出發日之後' : length > 60 ? '一趟旅程最多 60 天' : '';
  const ready = name.trim() && !problem && !busy;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    await app.createTrip(name, start, end);
  };

  return (
    <div class="screen">
      <BackBar title="建立新旅程" />
      <form class="body end" onSubmit={submit}>
        <label class="field">旅程名稱
          <input class="input lg" maxLength={40} placeholder="例如：京都五日遊" value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
        </label>
        <div class="pair">
          <label class="field">出發日
            <input class="input" type="date" value={start} onInput={(e) => {
              const v = e.currentTarget.value;
              setStart(v);
              if (v > end) setEnd(v);
            }} />
          </label>
          <label class="field">回程日
            <input class="input" type="date" value={end} min={start} onInput={(e) => setEnd(e.currentTarget.value)} />
          </label>
        </div>
        <p class={problem ? 'error' : 'hint'}>{problem || `共 ${length} 天。你會是這趟旅程的主揪，之後可以再加入其他主揪和成員。`}</p>
        <button class="btn primary tall push-end" disabled={!ready}>{busy ? '建立中…' : '建立'}</button>
      </form>
    </div>
  );
}

const MODES: { id: ThemeSetting; label: string }[] = [
  { id: 'auto', label: '自動：依目的地的日落時間' },
  { id: 'day', label: '固定白天' },
  { id: 'night', label: '固定夜晚' },
];

export function Settings() {
  const { palette, theme } = app.prefs;
  const [renaming, setRenaming] = useState(false);
  const place = app.trip && placeFor(app.trip.state, dateOf(new Date()));
  const asTab = !!app.trip && app.stack.length === 1; // opened from the bottom tabs inside a trip
  return (
    <div class="screen">
      {asTab ? <header class="bar"><h1 class="bar-title">設定</h1></header> : <BackBar title="設定" />}
      <main class="body end">
        <h2 class="section-label">外觀</h2>
        <fieldset class="card pad stack" style={{ gap: '10px' }}>
          <legend class="legend">色系</legend>
          <div class="pair">
            {PALETTES.map((p) => (
              <label class="palette-pick">
                <span aria-hidden="true">{p.swatch.map((c) => <i class="swatch" style={{ background: c }} />)}</span>
                <span><input type="radio" name="palette" checked={palette === p.id} onChange={() => app.setPrefs({ palette: p.id })} />{p.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="card rows">
          <legend class="legend pad-legend">日夜模式</legend>
          {MODES.map((m) => (
            <label class="radio-row">
              <input type="radio" name="mode" checked={theme === m.id} onChange={() => app.setPrefs({ theme: m.id })} />
              <span>{m.label}{m.id === 'auto' && theme === 'auto' && <small>{nextSwitch(place)}</small>}</span>
            </label>
          ))}
        </fieldset>
        <p class="small muted">手機開啟「減少動態效果」時，切換動畫會自動簡化。</p>
        <OfflineChip />
        <h2 class="section-label">安全</h2>
        <div class="card rows">
          <button class="row" onClick={() => app.go({ to: 'changePin' })}>更改 PIN 碼<span class="end"><Icon name="next" /></span></button>
          <div class="row">自動上鎖<span class="end">離開 App 2 分鐘後</span></div>
          <button class="row" onClick={() => app.lock()}>立即上鎖<span class="end"><Icon name="lock" /></span></button>
        </div>
        <h2 class="section-label">我</h2>
        <div class="card rows">
          <button class="row" onClick={() => setRenaming(true)}>暱稱<span class="end">{app.me.name}<Icon name="next" /></span></button>
        </div>
      </main>
      {asTab && <Tabs />}
      {renaming && <Rename onDone={() => setRenaming(false)} />}
    </div>
  );
}

function Rename({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(app.me.name);
  const save = async () => {
    if (name.trim() && name.trim() !== app.me.name) await app.rename(name);
    onDone();
  };
  return (
    <Sheet onClose={onDone}>
      <h2>改暱稱</h2>
      <input class="input lg" maxLength={20} value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="新暱稱" />
      <p>改了之後，旅伴要再和你互掃一次，他們的手機才會顯示新名字。</p>
      <div class="pair">
        <button class="btn line" onClick={onDone}>取消</button>
        <button class="btn primary" disabled={!name.trim()} onClick={save}>儲存</button>
      </div>
    </Sheet>
  );
}

export function ChangePin() {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const problem = pin.length === 4 ? checkPin(pin) : undefined;
  const ready = pin.length === 4 && !problem && again === pin;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    await app.changePin(pin);
    setDone(true);
  };

  if (done) {
    return (
      <div class="screen">
        <BackBar title="更改 PIN 碼" />
        <main class="body end">
          <p class="ok-chip"><Icon name="check" />已更改，下次打開 App 用新的 PIN 碼。</p>
          <button class="btn primary tall push-end" onClick={() => app.back()}>完成</button>
        </main>
      </div>
    );
  }
  return (
    <div class="screen">
      <BackBar title="更改 PIN 碼" />
      <form class="body end" onSubmit={submit}>
        <fieldset class="stack">
          <legend class="field" style={{ marginBottom: '8px' }}>新的 PIN 碼</legend>
          <PinBoxes label="新的 PIN 碼" value={pin} onInput={(v) => (setPin(v), setAgain(''))} autoFocus />
          {problem && <span class="error">{problem === 'weak' ? '這組太容易猜到，換一組吧。' : '請輸入 4 個數字。'}</span>}
        </fieldset>
        {pin.length === 4 && !problem && (
          <fieldset class="stack">
            <legend class="field" style={{ marginBottom: '8px' }}>再輸入一次</legend>
            <PinBoxes label="再輸入一次新的 PIN 碼" value={again} onInput={setAgain} autoFocus />
            {again.length === 4 && again !== pin && <span class="error">兩次輸入的不一樣。</span>}
          </fieldset>
        )}
        <button class="btn primary tall push-end" disabled={!ready}>更改</button>
      </form>
    </div>
  );
}
