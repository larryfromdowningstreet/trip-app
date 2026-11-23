// Who is in the trip, conflicts to settle, and the sync screen.

import { useState } from 'preact/hooks';
import { app } from '../app/store';
import { TYPES, fieldName, initial, when } from '../app/trip';
import { isShopField, isShopValue, shopLine } from '../core/shops';
import { whitelistCode } from '../core/codes';
import { type Conflict, valueOf } from '../core/merge';
import type { Access, ChangeRecord } from '../core/model';
import { Icon } from '../ui/icons';
import { BackBar, Confirm, Segmented, Tabs, TripBar, useAsync } from '../ui/kit';

const ACCESS = [['edit', '可修改'], ['view', '只能看'], ['blocked', '封鎖']] as const;

export function Members() {
  const trip = app.trip!;
  const members = trip.data.members;
  const code = useAsync(() => whitelistCode(members), [members.length]);
  const [blocking, setBlocking] = useState<string>();
  const me = app.me.id;
  const sorted = [...members].sort((x, y) => (x.id === me ? -1 : y.id === me ? 1 : 0));

  const pick = (id: string, access: Access) => (access === 'blocked' ? setBlocking(id) : app.setAccess(id, access));
  const target = blocking ? app.member(blocking) : undefined;

  return (
    <div class="screen">
      <TripBar />
      <main class="body">
        <h1 class="title">成員</h1>
        <div class="card pad spread">
          <span class="stack" style={{ gap: '2px' }}>
            <span class="small muted">白名單碼</span>
            <span class="tiny muted">大家一樣，代表名單一致</span>
          </span>
          <b class="code">{code ?? '····'}</b>
        </div>
        <ul class="card rows">
          {sorted.map((m) => {
            const blocked = m.trust.access === 'blocked';
            return (
              <li class="member" key={m.id}>
                <div class="member-head">
                  <span class={blocked ? 'avatar blocked' : 'avatar'} aria-hidden="true">{initial(m.name)}</span>
                  <span class="stack" style={{ gap: 0 }}>
                    <span class="member-name">{m.name}{m.id === me && '（你）'}</span>
                    {m.id === me && <span class="tiny muted">{trip.meta.role === 'organizer' ? '主揪' : '成員'}</span>}
                    {blocked && (
                      <span class="tiny danger-text">
                        {m.trust.blockedAfter ? `已封鎖：第 ${m.trust.blockedAfter} 筆之後的變更不採用` : '已封鎖：不採用他的任何變更'}
                      </span>
                    )}
                  </span>
                </div>
                {m.id !== me && (
                  <Segmented label={`${m.name}的權限`} options={ACCESS} value={m.trust.access} danger="blocked" onPick={(a) => pick(m.id, a)} />
                )}
              </li>
            );
          })}
        </ul>
        <p class="tiny muted">「只能看」和「封鎖」只影響這支手機採用誰的變更。要大家一致，請每位主揪都設定一次。</p>
        <button class="btn soft tall push-end" onClick={() => app.go({ to: 'enroll' })}><Icon name="plus" />新增成員（面對面互掃）</button>
      </main>
      <Tabs />
      {target && (
        <Confirm title={`封鎖${target.name}？`} danger yes="封鎖" onNo={() => setBlocking(undefined)}
          onYes={() => (setBlocking(undefined), app.setAccess(target.id, 'blocked'))}
          text={`例如手機遺失時使用。${target.name}到目前為止的變更會保留，之後從他手機來的任何變更都不會採用。之後可以再改回來。`} />
      )}
    </div>
  );
}

export function Conflicts() {
  const trip = app.trip!;
  const list = trip.state.conflicts;
  return (
    <div class="screen">
      <BackBar title="衝突處理" />
      <main class="body end">
        {list.length === 0 ? (
          <div class="empty"><Icon name="check" size={32} /><p>沒有待確認的衝突。</p></div>
        ) : (
          <div class="stack" style={{ gap: '4px' }}>
            <h1 class="title">{list.length} 處衝突待確認</h1>
            <p class="muted" style={{ fontSize: '14px' }}>兩個人改了同一個地方。選定之後，大家下次同步就會拿到你的決定。</p>
          </div>
        )}
        {list.map((c) => <ConflictCard key={`${c.item}:${c.field ?? 'delete'}`} conflict={c} />)}
        <p class="small muted center push-end">成員只會看到目前顯示的版本和「待確認」標籤</p>
      </main>
    </div>
  );
}

function ConflictCard({ conflict: c }: { conflict: Conflict }) {
  const trip = app.trip!;
  const item = trip.state.items.get(c.item);
  const date = String(item?.values.date ?? '');
  const day = app.days.indexOf(date) + 1;
  const where = [day > 0 ? `第 ${day} 天` : '', c.kind === 'delete' ? '一人刪除、一人修改' : fieldName(c.field!)].filter(Boolean).join(' · ');
  const name = (r: ChangeRecord) => app.member(r.a)?.name ?? '不明';

  const label = (r: ChangeRecord) => {
    if (c.kind === 'field') return show(c.field!, valueOf(r, c.field!));
    if (r.op === 'delete') return '刪除這個項目';
    if (r.op === 'set' && r.f) return `保留，${fieldName(r.f)}改為「${show(r.f, r.v)}」`;
    return '保留這個項目';
  };

  return (
    <section class="card pad stack" style={{ gap: '10px' }} aria-label={`${String(item?.values.title ?? '')}的衝突`}>
      <div class="stack" style={{ gap: '2px' }}>
        <span class="tiny muted">{where}</span>
        <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{String(item?.values.title ?? '')}</h2>
        {c.kind === 'delete' && <span class="small muted">為了避免誤刪，目前先保留這個項目。</span>}
      </div>
      {c.options.map((r) => {
        const shown = r === c.shown;
        return (
          <div class={shown ? 'choice shown' : 'choice'}>
            <span class="stack" style={{ gap: 0 }}>
              <b class={c.kind === 'field' ? '' : 'text'}>{label(r)}</b>
              <span class="who">{name(r)} · {when(r.t)}{shown && ' · 目前先顯示這個'}</span>
            </span>
            <button onClick={() => app.resolveConflict(c, r)}>採用</button>
          </div>
        );
      })}
    </section>
  );
}

function show(field: string, value: unknown): string {
  if (isShopField(field)) return isShopValue(value) ? shopLine({ name: value.n, where: value.w ?? '', buy: value.b ?? '' }) : '（移除這家店）';
  if (value === null || value === undefined || value === '') return '（清空）';
  if (field === 'type') return TYPES.find(([id]) => id === value)?.[1] ?? String(value);
  if (field === 'owner') return app.member(String(value))?.name ?? '不明';
  return String(value);
}
