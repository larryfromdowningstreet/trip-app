// The two everyday screens: the next stop, and the day-by-day plan.

import { Fragment } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { app } from '../app/store';
import {
  countdown, dateOf, daysBetween, itemsOn, longDay, mapLink, nextIndex, shortDay, timeRange, undated,
} from '../app/trip';
import type { ItemState } from '../core/merge';
import { isApple, openOutside } from '../platform/device';
import { Icon } from '../ui/icons';
import { Tabs, TripBar, useNow } from '../ui/kit';

/** The day to show: today during the trip, the first day before it, the last day after it. */
function currentDay(days: string[], now: Date): string {
  const today = dateOf(now);
  return today < days[0] ? days[0] : today > days[days.length - 1] ? days[days.length - 1] : today;
}

function dayLabel(days: string[], day: string, now: Date): string {
  const today = dateOf(now);
  if (today < days[0]) return `還有 ${daysBetween(today, days[0])} 天出發 · 第 1 天 ${longDay(day)}`;
  if (today > days[days.length - 1]) return '旅程已經結束';
  return `第 ${days.indexOf(day) + 1} 天 · ${longDay(day)}`;
}

const facts = (v: Record<string, unknown>) =>
  ([['地址', v.addressLocal], ['交通', v.transport], ['預約', v.booking], ['備註', v.note]] as const)
    .filter(([, x]) => typeof x === 'string' && x);

function Facts({ item }: { item: ItemState }) {
  return (
    <dl class="facts">
      {facts(item.values).map(([k, x]) => <Fragment key={k}><dt>{k}</dt><dd>{x as string}</dd></Fragment>)}
    </dl>
  );
}

// ---- next stop --------------------------------------------------------------

/** One card's width plus the gap: cards are the strip's width minus its 20px side padding, 20px apart. */
const step = (strip: HTMLElement) => strip.clientWidth - 40 + 20;

export function NextStop() {
  const now = useNow();
  const days = app.days;
  const day = currentDay(days, now);
  const items = itemsOn(app.trip!.state, day);
  const next = nextIndex(items, day, now);
  const over = dateOf(now) > days[days.length - 1];
  const [active, setActive] = useState(next);
  const [later, setLater] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = Math.min(next, items.length - 1) * step(el);
    setActive(Math.min(next, items.length - 1));
  }, [day, next, items.length]);

  const onScroll = () => {
    const el = strip.current;
    if (el) setActive(Math.round(el.scrollLeft / step(el)));
  };
  const upcoming = items.slice(next + 1);

  return (
    <div class="screen">
      <TripBar />
      <main class="body">
        <p class="day-label">{dayLabel(days, day, now)}</p>
        {over || items.length === 0 || next >= items.length ? (
          <div class="card empty">
            <Icon name="pin" size={32} width={1.5} />
            <p>{over ? '這趟旅程結束了，辛苦了！' : items.length === 0 ? '這天還沒有安排行程。' : '今天的行程都結束了。'}</p>
            <button class="btn soft" onClick={() => app.reset({ to: 'overview' })}>看完整行程</button>
          </div>
        ) : (
          <>
            <div class="carousel" ref={strip} onScroll={onScroll}>
              {items.map((item, i) => (
                <StopCard key={item.id} item={item} kind={i < next ? '已過' : i === next ? (countdown(items, i, day, now) === '進行中' ? '進行中' : '下一站') : '之後'}
                  when={i === next ? countdown(items, i, day, now) : ''} main={i === active} />
              ))}
            </div>
            <div class="dots" role="img" aria-label={`第 ${active + 1} 站，共 ${items.length} 站。左右滑動卡片可以看其他站`}>
              {items.map((_, i) => <span class={i === active ? 'on' : ''} />)}
            </div>
          </>
        )}
        {!over && upcoming.length > 0 && (
          <section class="card" aria-label="接下來">
            <button class="disclose" aria-expanded={later} onClick={() => setLater(!later)}>
              {later ? '收起接下來的行程' : `之後還有 ${upcoming.length} 站`}
              <Icon name="down" />
            </button>
            {later && (
              <ol class="timeline">
                {upcoming.map((i) => <li><time>{String(i.values.start ?? '')}</time><span>{String(i.values.title ?? '')}</span></li>)}
              </ol>
            )}
          </section>
        )}
      </main>
      <Tabs />
    </div>
  );
}

function StopCard({ item, kind, when, main }: { item: ItemState; kind: string; when: string; main: boolean }) {
  const [open, setOpen] = useState(false);
  const v = item.values;
  const nav = mapLink(v, true, isApple());
  const Title = main ? 'h1' : 'h2';
  return (
    <section class="stop" aria-label={kind}>
      <div class="stop-head">
        <span class="stop-kind">{kind}</span>
        {when && <span class="stop-when">{when}</span>}
      </div>
      <div class="stack" style={{ gap: '4px' }}>
        <span class="stop-time">{timeRange(v) || '　'}</span>
        <Title class="stop-title">{String(v.title ?? '')}</Title>
        {item.pending && <span class="tag pending" style={{ alignSelf: 'flex-start' }}>待確認</span>}
      </div>
      {nav && (
        <a class="btn primary big" href={nav} target="_blank" rel="noopener noreferrer" onClick={(e) => openOutside(e, nav)}>
          <Icon name="navigate" size={22} />開始導航
        </a>
      )}
      <div class="pair">
        <button class="btn soft" onClick={() => app.go({ to: 'driver', item: item.id })}><Icon name="car" />給司機看</button>
        <button class="btn soft" onClick={() => app.go({ to: 'ticket', item: item.id })}><Icon name="ticket" />我的票券</button>
      </div>
      {facts(v).length > 0 ? (
        <>
          <button class="more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收起詳細' : `詳細：${facts(v).map(([k]) => k).join('、')}`}
            <Icon name="down" size={16} />
          </button>
          {open && <Facts item={item} />}
        </>
      ) : <span style={{ height: '8px' }} />}
    </section>
  );
}

// ---- the whole plan -----------------------------------------------------------

export function Overview({ day: asked }: { day?: string }) {
  const now = useNow();
  const days = app.days;
  const trip = app.trip!;
  const [day, setDay] = useState(asked && days.includes(asked) ? asked : currentDay(days, now));
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState<string>();
  const items = itemsOn(trip.state, day);
  const next = nextIndex(items, day, now);
  const isToday = day === dateOf(now);
  const done = isToday ? items.slice(0, next) : [];
  const rest = isToday ? items.slice(next) : items;
  const loose = undated(trip.state, days);
  const conflicts = trip.state.conflicts.length;

  const row = (item: ItemState) => {
    const isNext = isToday && item === rest[0];
    const tag = isNext ? <span class="tag next">下一站</span>
      : item.pending ? <span class="tag pending">待確認</span>
      : trip.data.fresh.includes(item.id) ? <span class="tag fresh">剛更新</span> : null;
    return (
      <Fragment key={item.id}>
        <button class={isNext ? 'plan-row is-next' : 'plan-row'} aria-expanded={open === item.id}
          onClick={() => setOpen(open === item.id ? undefined : item.id)}>
          <time>{String(item.values.start ?? '')}</time>
          <span class="name">{String(item.values.title ?? '（未命名）')}</span>
          {tag}
        </button>
        {open === item.id && <OpenItem item={item} />}
      </Fragment>
    );
  };

  return (
    <div class="screen">
      <TripBar />
      <div class="days" role="tablist" aria-label="選擇日期">
        {days.map((d, i) => (
          <button role="tab" aria-selected={d === day} onClick={() => (setDay(d), app.remember({ day: d }), setOpen(undefined), setPast(false))}>
            第 {i + 1} 天<b>{shortDay(d)}</b>
          </button>
        ))}
      </div>
      <main class="body" style={{ paddingTop: 0, gap: '12px' }}>
        {app.isOrganizer && conflicts > 0 && (
          <button class="banner" onClick={() => app.go({ to: 'conflicts' })}>
            <span><Icon name="warn" />{conflicts} 處衝突待確認</span>
            <Icon name="next" />
          </button>
        )}
        <div class="card plan">
          {done.length > 0 && (
            <>
              <button class="disclose quiet" aria-expanded={past} onClick={() => setPast(!past)}>
                {past ? '收起已過的行程' : `已過 ${done.length} 站`}
                <Icon name="down" />
              </button>
              {past && <div class="past">{done.map(row)}</div>}
            </>
          )}
          {rest.map(row)}
          {items.length === 0 && <p class="empty">這天還沒有安排。</p>}
        </div>
        {loose.length > 0 && (
          <>
            <h2 class="section-label">還沒排日期</h2>
            <div class="card plan">{loose.map(row)}</div>
          </>
        )}
        {app.isOrganizer && (
          <div class="fab-row">
            <button class="btn plain" onClick={() => app.go({ to: 'bulk' })}>批次匯入</button>
            <button class="fab" onClick={() => app.go({ to: 'edit', day })}><Icon name="plus" />新增行程</button>
          </div>
        )}
      </main>
      <Tabs />
    </div>
  );
}

function OpenItem({ item }: { item: ItemState }) {
  const nav = mapLink(item.values, true, isApple());
  return (
    <div class="open-item">
      {facts(item.values).length > 0 && <Facts item={item} />}
      <div class="btns">
        {nav && <a class="btn" href={nav} target="_blank" rel="noopener noreferrer" onClick={(e) => openOutside(e, nav)}><Icon name="navigate" />導航</a>}
        <button class="btn" onClick={() => app.go({ to: 'driver', item: item.id })}><Icon name="car" />給司機看</button>
        <button class="btn" onClick={() => app.go({ to: 'ticket', item: item.id })}><Icon name="ticket" />票券</button>
        {app.isOrganizer && <button class="btn" onClick={() => app.go({ to: 'edit', item: item.id })}>編輯</button>}
      </div>
    </div>
  );
}
