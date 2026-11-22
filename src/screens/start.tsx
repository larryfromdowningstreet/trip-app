// Before a trip is open: install guide, first-time setup, the lock screen.

import { useEffect, useState } from 'preact/hooks';
import { app } from '../app/store';
import { WIPE_AT, checkPin } from '../core/pin';
import { Vault } from '../core/vault';
import { Icon } from '../ui/icons';
import { useOfflineReady } from '../platform/device';
import { Confirm, PinBoxes } from '../ui/kit';

export function InstallGuide() {
  const later = () => {
    app.setPrefs({ installSkipped: true });
    app.reset({ to: 'onboarding' });
  };
  return (
    <div class="screen">
      <main class="body roomy" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 56px)' }}>
        <div class="stack">
          <h1 class="title-lg">把 App 加到主畫面</h1>
          <p class="muted">加到主畫面才能離線使用，資料也比較不會被系統清掉。</p>
        </div>
        <ol class="card rows steps">
          <li><span class="step-no" aria-hidden="true">1</span><span>點 Safari 下方的「分享」按鈕</span><Icon name="share" size={22} /></li>
          <li><span class="step-no" aria-hidden="true">2</span><span>往下找到「加入主畫面」</span><Icon name="addSquare" size={22} /></li>
          <li><span class="step-no" aria-hidden="true">3</span><span>之後都從主畫面的圖示打開</span><Icon name="appIcon" size={22} /></li>
        </ol>
        <div class="note soft" style={{ flexDirection: 'column' }}>
          <span>完成後從主畫面打開，這裡會顯示：</span>
          <span class="ok-chip"><Icon name="check" />已可離線使用</span>
        </div>
        <p class="small muted">Android 不需要這一步。</p>
        <button class="btn plain push-end" onClick={later}>
          稍後再說
        </button>
      </main>
    </div>
  );
}

/** The line the install guide promises: whether the app can now open with no network. */
export function OfflineChip() {
  return useOfflineReady()
    ? <span class="ok-chip"><Icon name="check" />已可離線使用</span>
    : <span class="small muted">正在下載離線用的檔案，請先保持連網…</span>;
}

export function Onboarding() {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = pin.length === 4 ? checkPin(pin) : undefined;
  const mismatch = again.length === 4 && again !== pin;
  const ready = name.trim() && pin.length === 4 && !problem && again === pin && !busy;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    await app.createProfile(name, pin);
  };

  return (
    <div class="screen">
      <form class="body roomy" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)' }} onSubmit={submit}>
        <div class="stack" style={{ gap: '10px' }}>
          <span class="circle-icon" aria-hidden="true"><Icon name="addUser" size={24} /></span>
          <h1 class="title-lg">開始之前</h1>
          <p class="muted">設定暱稱和 PIN 碼，只需要做一次。</p>
        </div>
        <label class="field" style={{ fontSize: '14px', gap: '6px' }}>
          暱稱
          <input class="input lg" maxLength={20} value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="nickname" />
          <span class="small">旅伴會看到這個名字，同一趟旅程裡不能重複。</span>
        </label>
        <fieldset class="stack">
          <legend class="field" style={{ fontSize: '14px', marginBottom: '8px' }}>4 位數 PIN 碼</legend>
          <PinBoxes label="PIN 碼" value={pin} onInput={(v) => (setPin(v), setAgain(''))} />
          {problem
            ? <span class="error">{problem === 'weak' ? '這組太容易猜到，換一組吧。' : '請輸入 4 個數字。'}</span>
            : <span class="hint">每次打開 App 都要輸入。0000、1234 這類太簡單的組合不能用。</span>}
        </fieldset>
        {pin.length === 4 && !problem && (
          <fieldset class="stack">
            <legend class="field" style={{ fontSize: '14px', marginBottom: '8px' }}>再輸入一次</legend>
            <PinBoxes label="再輸入一次 PIN 碼" value={again} onInput={setAgain} autoFocus />
            {mismatch && <span class="error">兩次輸入的不一樣。</span>}
          </fieldset>
        )}
        <p class="note soft"><Icon name="key" size={20} /><span>App 會在這支手機產生你專屬的金鑰。金鑰不會離開手機，也沒辦法被複製出來。</span></p>
        <div class="stack push-end" style={{ gap: '12px' }}>
          <OfflineChip />
          <button class="btn primary tall" disabled={!ready}>{busy ? '建立中…' : '建立身分'}</button>
        </div>
      </form>
    </div>
  );
}

export function Lock() {
  const [pin, setPin] = useState('');
  const [fails, setFails] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [forgot, setForgot] = useState(false);
  const waiting = waitUntil > now;

  useEffect(() => {
    Vault.attempts(app.kv).then((a) => (setFails(a.fails), setWaitUntil(a.until)));
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const press = async (digit: string) => {
    if (busy || waiting || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length < 4) return;
    setBusy(true);
    const result = await app.unlock(next);
    if (!result.ok) {
      setFails(result.fails);
      setWaitUntil(Date.now() + result.wait);
      setNow(Date.now());
      setShake(true);
      setTimeout(() => (setShake(false), setPin('')), 400);
    }
    setBusy(false);
  };

  const left = Math.ceil((waitUntil - now) / 1000);
  const status = waiting
    ? `請等 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 再試`
    : fails > 0 ? `已猜錯 ${fails} 次，還可以試 ${WIPE_AT - fails} 次` : '';

  return (
    <div class="screen lock">
      <div class="lock-top">
        <span class="lock-icon" aria-hidden="true"><Icon name="lock" size={24} /></span>
        <h1 style={{ fontSize: '22px', fontWeight: 700 }}>輸入 PIN 碼</h1>
        <div class={shake ? 'lock-dots shake' : 'lock-dots'} role="img" aria-label={`已輸入 ${pin.length} 碼，共 4 碼`}>
          {[0, 1, 2, 3].map((i) => <span class={i < pin.length ? 'on' : ''} />)}
        </div>
        <p class="chip" role="status" style={{ visibility: status ? 'visible' : 'hidden' }}>{status || '　'}</p>
      </div>
      <div class="keypad" role="group" aria-label="數字鍵盤">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button disabled={waiting} onClick={() => press(d)}>{d}</button>)}
        <span aria-hidden="true" />
        <button disabled={waiting} onClick={() => press('0')}>0</button>
        <button class="bare" aria-label="刪除一碼" onClick={() => setPin(pin.slice(0, -1))}><Icon name="erase" size={28} width={1.8} /></button>
      </div>
      <div class="lock-foot">
        <button onClick={() => setForgot(true)}>忘記 PIN 碼？</button>
        <p>連續猜錯 10 次會清除本機所有資料。<br />行程可以和旅伴重新互掃恢復。</p>
      </div>
      {forgot && (
        <Confirm title="清除這支手機的資料？" danger yes="清除並重新開始" onNo={() => setForgot(false)} onYes={() => app.wipe()}
          text="PIN 碼沒辦法找回。清除後要重新建立身分，再和旅伴面對面互掃，把行程拿回來。票券截圖和已封存的旅程會一起消失。" />
      )}
    </div>
  );
}

export function Wiped() {
  return (
    <div class="screen">
      <main class="body roomy" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 88px)' }}>
        <span class="circle-icon" aria-hidden="true"><Icon name="lock" size={24} /></span>
        <h1 class="title-lg">已清除這支手機的資料</h1>
        <p class="muted">PIN 碼猜錯太多次，為了保護行程，資料已經清除。重新建立身分後，和旅伴面對面互掃就能拿回行程。</p>
        <button class="btn primary tall push-end" onClick={() => app.reset({ to: 'onboarding' })}>重新開始</button>
      </main>
    </div>
  );
}
