// Syncing face to face through one collector:
//   collector: scan everyone → (settle conflicts) → everyone scans the collector → compare codes
//   others:    show my QR to the collector → scan the collector → compare codes

import { app } from '../app/store';
import { when } from '../app/trip';
import { BundleFailure } from '../core/bundle';
import type { Bytes } from '../core/bytes';
import { syncCode } from '../core/codes';
import { kindOf } from '../core/transfer';
import { Icon } from '../ui/icons';
import { Tabs, TripBar, useAsync } from '../ui/kit';
import { QrShow, Scanner, Steps } from '../ui/qr';

export function Sync() {
  const s = app.sync;
  return (
    <div class="screen">
      <TripBar />
      <main class="body">
        {!s ? <Home /> : s.role === 'collect' ? <Collect /> : <Send />}
      </main>
      <Tabs />
    </div>
  );
}

function CodeCard({ label, sub }: { label: string; sub: string }) {
  const state = app.trip!.state;
  const code = useAsync(() => syncCode(state), [state]);
  return (
    <div class="card pad spread">
      <span class="stack" style={{ gap: '2px' }}>
        <span class="small muted">{label}</span>
        <span class="tiny muted">{sub}</span>
      </span>
      <b class="code">{code ?? '····'}</b>
    </div>
  );
}

function Home() {
  const trip = app.trip!;
  const gaps = trip.log.gaps().reduce((n, g) => n + g.missing.length, 0);
  return (
    <>
      <h1 class="title">同步</h1>
      <CodeCard label="同步碼" sub="兩支手機一樣，代表行程一致" />
      <p class="small muted">{trip.meta.lastSync ? `上次同步：${when(trip.meta.lastSync)}` : '這趟旅程還沒有同步過。'}</p>
      {gaps > 0 && <p class="note warn"><Icon name="warn" />還缺 {gaps} 筆別人的變更，下次同步時請收集者傳送全部。</p>}
      <ol class="card rows steps">
        <li><span class="step-no" aria-hidden="true">1</span><span>收集者依序掃每個人的 QR Code</span></li>
        <li><span class="step-no" aria-hidden="true">2</span><span>收齊後，大家換掃收集者</span></li>
        <li><span class="step-no" aria-hidden="true">3</span><span>比對同步碼，一樣就完成</span></li>
      </ol>
      <div class="stack push-end">
        <button class="btn primary tall" onClick={() => app.beginSync('collect')}>我來收集（掃大家）</button>
        <button class="btn soft tall" onClick={() => app.beginSync('send')}>給收集者掃（顯示我的）</button>
      </div>
    </>
  );
}

/** Turns a failed scan into a sentence for people. */
function explain(e: unknown): Error {
  if (e instanceof BundleFailure) {
    return new Error(e.code === 'decrypt' ? '這不是這趟旅程的 QR Code，或畫面沒有拍完整。' : e.code === 'too-large' ? '資料太大，已拒絕。' : '看不懂這個 QR Code。');
  }
  return e instanceof Error ? e : new Error(String(e));
}

const notBundle = (bytes: Bytes) =>
  kindOf(bytes) === 'identity' ? '這是身分 QR Code，不是同步用的。請對方進入「同步」，按「給收集者掃（顯示我的）」。' : kindOf(bytes) === 'invite' || kindOf(bytes) === 'join' ? '這是邀請 QR Code，不是同步用的。' : '';

// ---- collector ------------------------------------------------------------------

function Collect() {
  const s = app.sync!;
  const trip = app.trip!;
  const others = trip.data.members.filter((m) => m.id !== app.me.id && m.trust.access !== 'blocked');
  const conflicts = trip.state.conflicts.length;

  const onBytes = async (bytes: Bytes) => {
    const wrong = notBundle(bytes);
    if (wrong) throw new Error(wrong);
    const r = await app.takeBundle(bytes).catch((e) => Promise.reject(explain(e)));
    const who = app.member(r.from)?.name ?? '不在名單上的人';
    const extra = r.rejected ? `，${r.rejected} 份不在白名單上的變更已拒絕` : '';
    return r.added ? `收到${who}的 ${r.added} 筆變更${extra}` : `${who}沒有新變更${extra}`;
  };

  if (s.step === 0) {
    return (
      <>
        <h1 class="title">同步模式</h1>
        <Steps labels={['收集', '分享', '確認']} at={0} />
        <p class="small muted">你是收集者：依序掃其他人的 QR Code。</p>
        <Scanner prompt="對準別人的同步 QR Code" onBytes={onBytes} />
        <ul class="card rows">
          {others.map((m) => {
            const heard = s.heard[m.id];
            return (
              <li class="status-row">
                <span class={heard ? 'tick' : 'tick waiting'} aria-hidden="true">{heard && <Icon name="check" size={16} width={2.5} />}</span>
                <span class="name">{m.name}</span>
                <span class={!heard ? 'state wait' : heard.lacking ? 'state bad' : 'state'}>
                  {!heard ? '等待掃描' : heard.lacking ? `他有 ${heard.lacking} 筆舊變更沒傳，請他按「傳送全部」` : heard.added ? `已收到 ${heard.added} 筆變更` : '沒有新變更'}
                </span>
              </li>
            );
          })}
        </ul>
        <div class="stack push-end">
          {app.isOrganizer && conflicts > 0 ? (
            <>
              <button class="btn primary tall" onClick={() => app.go({ to: 'conflicts' })}>先處理 {conflicts} 處衝突</button>
              <button class="btn plain" onClick={() => app.syncStep(1)}>略過，直接換大家掃我</button>
            </>
          ) : (
            <button class="btn primary tall" onClick={() => app.syncStep(1)}>收齊了，換大家掃我</button>
          )}
          <button class="btn plain" onClick={() => app.endSync()}>改由別人收集</button>
        </div>
      </>
    );
  }

  if (s.step === 1) return <CollectShare />;
  return <Done />;
}

function CollectShare() {
  const s = app.sync!;
  const bytes = useAsync(() => app.shareBundle(), [s.heard, app.trip!.state]);
  return (
    <>
      <h1 class="title">換大家掃我</h1>
      <Steps labels={['收集', '分享', '確認']} at={1} />
      <p class="small muted">大家的變更都在這裡了{app.trip!.state.conflicts.length ? '' : '，衝突也處理好了'}。請其他人在「給收集者掃」的第 2 步掃這個畫面。</p>
      <QrShow bytes={bytes} />
      <CodeCard label="我的同步碼" sub="大家掃完後，各自的同步碼要和這個一樣" />
      <div class="stack push-end">
        <button class="btn primary tall" onClick={() => app.finishSync().then(() => app.syncStep(2))}>大家都一樣，完成同步</button>
        <button class="btn plain" onClick={() => app.syncStep(0)}>回到收集</button>
      </div>
    </>
  );
}

function Done() {
  return (
    <>
      <h1 class="title">同步完成</h1>
      <Steps labels={['收集', '分享', '確認']} at={3} />
      <CodeCard label="同步碼" sub="大家的行程一致" />
      <button class="btn primary tall push-end" onClick={() => (app.endSync(), app.reset({ to: 'main' }))}>回到下一站</button>
    </>
  );
}

// ---- everyone else ------------------------------------------------------------

function Send() {
  const s = app.sync!;
  const labels = ['給收集者掃', '掃收集者', '確認'];
  const bytes = useAsync(() => (s.step === 0 ? app.shareBundle() : Promise.resolve(undefined)), [s.step, s.full]);

  if (s.step === 0) {
    return (
      <>
        <h1 class="title">給收集者掃</h1>
        <Steps labels={labels} at={0} />
        <p class="small muted">請收集者掃這個畫面。{s.full ? '目前傳送你手機上全部的變更。' : '只傳送上次同步後的新變更。'}</p>
        <QrShow bytes={bytes} />
        <label class="check-line">
          <input type="checkbox" checked={s.full} onChange={() => app.syncStep(0, { full: !s.full })} />
          傳送全部（收集者說缺舊變更時再勾）
        </label>
        <div class="stack push-end">
          <button class="btn primary tall" onClick={() => app.syncStep(1)}>收集者收齊了，換我掃他</button>
          <button class="btn plain" onClick={() => app.endSync()}>取消</button>
        </div>
      </>
    );
  }

  if (s.step === 1) {
    const onBytes = async (got: Bytes) => {
      const wrong = notBundle(got);
      if (wrong) throw new Error(wrong);
      const r = await app.takeBundle(got).catch((e) => Promise.reject(explain(e)));
      app.syncStep(2, { result: { added: r.added, rejected: r.rejected, gaps: r.gaps } });
      return undefined;
    };
    return (
      <>
        <h1 class="title">掃收集者</h1>
        <Steps labels={labels} at={1} />
        <p class="small muted">
          {s.retry ? '再掃一次收集者的畫面。還是不一樣的話，請收集者回到收集，大家勾「傳送全部」重新同步。' : '對準收集者「換大家掃我」的畫面。'}
        </p>
        <Scanner prompt="對準收集者的 QR Code" onBytes={onBytes} />
        <button class="btn plain push-end" onClick={() => app.syncStep(0)}>回上一步</button>
      </>
    );
  }

  return <SendConfirm />;
}

function SendConfirm() {
  const s = app.sync!;
  const r = s.result!;
  const conflicts = app.trip!.state.conflicts.length;
  return (
    <>
      <h1 class="title">比對同步碼</h1>
      <Steps labels={['給收集者掃', '掃收集者', '確認']} at={2} />
      <CodeCard label="我的同步碼" sub="和收集者畫面上的一樣嗎？" />
      <p class="small muted">收到 {r.added} 筆新變更。</p>
      {r.rejected > 0 && <p class="note warn"><Icon name="warn" />有 {r.rejected} 份不在白名單上的變更，已拒絕。</p>}
      {r.gaps > 0 && <p class="note warn"><Icon name="warn" />還缺 {r.gaps} 筆變更，請收集者回到收集，請大家勾「傳送全部」再同步一次。</p>}
      {app.isOrganizer && conflicts > 0 && (
        <button class="banner" onClick={() => app.go({ to: 'conflicts' })}><span><Icon name="warn" />{conflicts} 處衝突待確認</span><Icon name="next" /></button>
      )}
      <div class="stack push-end">
        <button class="btn primary tall" onClick={() => app.finishSync().then(() => (app.endSync(), app.reset({ to: 'main' })))}>一樣，完成同步</button>
        <button class="btn plain" onClick={() => app.syncStep(1, { retry: true })}>不一樣，再掃一次</button>
      </div>
    </>
  );
}
