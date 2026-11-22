// Shared pieces every screen is built from.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Route, app } from '../app/store';
import { when } from '../app/trip';
import { Icon, type IconName } from './icons';

/** Runs an async calculation again whenever `deps` change, and gives back its latest result. */
export function useAsync<T>(make: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    make().then((v) => live && setValue(v));
    return () => void (live = false);
  }, deps);
  return value;
}

/** Re-renders the calling component every `ms`, for countdowns. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Top bar with a back arrow and a title, plus an optional action on the right. */
export function BackBar({ title, sub, action }: { title: string; sub?: string; action?: ComponentChildren }) {
  return (
    <header class="bar with-back">
      <div class="bar-side">
        <button class="icon-btn" aria-label="返回" onClick={() => app.back()}>
          <Icon name="back" size={22} />
        </button>
        <h1 class="bar-title">{title}{sub && <small>{sub}</small>}</h1>
      </div>
      {action}
    </header>
  );
}

/** Top bar inside a trip: trip name (opens the trip list) and sync status. */
export function TripBar({ menu }: { menu?: boolean }) {
  const trip = app.trip!;
  const synced = trip.meta.lastSync;
  return (
    <header class="bar">
      <button class="bar-trip" onClick={() => app.go({ to: 'trips' })}>
        <span>{trip.meta.name}</span>
        <Icon name="down" />
      </button>
      <div class="bar-side">
        <button class={synced ? 'bar-status' : 'bar-status never'} onClick={() => app.go({ to: 'sync' })}
          aria-label={synced ? `${when(synced)} 已同步，點一下進入同步` : '還沒有同步過，點一下進入同步'}>
          {synced ? '已同步' : '尚未同步'}
        </button>
        {menu && <MoreMenu />}
      </div>
    </header>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const pick = (route: Route) => {
    setOpen(false);
    app.go(route);
  };
  return (
    <>
      <button class="icon-btn" aria-label="更多" onClick={() => setOpen(true)}><Icon name="more" size={22} /></button>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <button class="menu-item" onClick={() => pick({ to: 'sync' })}><Icon name="sync" size={22} />同步</button>
          <button class="menu-item" onClick={() => pick({ to: 'trips' })}><Icon name="list" size={22} />我的旅程</button>
          <button class="menu-item" onClick={() => pick({ to: 'settings' })}><Icon name="gear" size={22} />設定</button>
        </Sheet>
      )}
    </>
  );
}

const TABS: { to: 'main' | 'overview' | 'sync' | 'members'; label: string; icon: IconName; organizer?: boolean }[] = [
  { to: 'main', label: '下一站', icon: 'pin' },
  { to: 'overview', label: '行程', icon: 'list' },
  { to: 'sync', label: '同步', icon: 'sync', organizer: true },
  { to: 'members', label: '成員', icon: 'people', organizer: true },
];

/** Bottom tabs. Members (view-only) get the first two; the rest is in the ⋯ menu. */
export function Tabs() {
  const here = app.route.to;
  return (
    <nav class="tabs" aria-label="主選單">
      {TABS.filter((t) => !t.organizer || app.isOrganizer).map((t) => (
        <button class="tab" aria-current={here === t.to ? 'page' : undefined} onClick={() => app.reset({ to: t.to })}>
          <Icon name={t.icon} size={24} width={1.8} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** A panel that slides up from the bottom. */
export function Sheet({ children, onClose }: { children: ComponentChildren; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

/** Ask before doing something that cannot be undone. */
export function Confirm(props: { title: string; text: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet onClose={props.onNo}>
      <h2>{props.title}</h2>
      <p>{props.text}</p>
      <div class="pair">
        <button class="btn line" onClick={props.onNo}>取消</button>
        <button class={props.danger ? 'btn line danger' : 'btn primary'} onClick={props.onYes}>{props.yes}</button>
      </div>
    </Sheet>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>(props: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T | undefined;
  onPick: (value: T) => void;
  danger?: T;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([value, text]) => (
        <button type="button" role="radio" aria-checked={props.value === value}
          class={value === props.danger ? 'danger' : undefined} onClick={() => props.onPick(value)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Four boxes over one hidden number field, so the phone shows its number pad. */
export function PinBoxes({ value, onInput, label, autoFocus }: { value: string; onInput: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <div class="pin-boxes">
      {[0, 1, 2, 3].map((i) => (
        <span aria-hidden="true" class={(i < value.length ? 'filled' : '') + (i === value.length ? ' at' : '')}>
          {i < value.length ? '•' : ''}
        </span>
      ))}
      <input type="password" inputmode="numeric" pattern="[0-9]*" maxLength={4} autocomplete="off" aria-label={label}
        value={value} autoFocus={autoFocus} onInput={(e) => onInput(e.currentTarget.value.replace(/\D/g, '').slice(0, 4))} />
    </div>
  );
}
