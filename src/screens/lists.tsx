// The 清單 tab: this person's own shopping list and packing list for the trip. Never synced.

import { useState } from 'preact/hooks';
import { app } from '../app/store';
import { itemsOn, undated } from '../app/trip';
import { whereToBuy } from '../core/archive';
import { KINDS, type ListEntry, type ListKind, MAX_ENTRIES, entry, entryDetail, ordered, splitLines } from '../core/lists';
import { shopsOf } from '../core/shops';
import { Icon } from '../ui/icons';
import { Sheet, Tabs } from '../ui/kit';

export function ListsTab() {
  const trip = app.trip!;
  const kind: ListKind = app.prefs.listTab ?? 'shopping';
  const [, name, doneName] = KINDS.find(([k]) => k === kind)!;
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<ListEntry>();
  const { todo, done } = ordered(trip.lists[kind]);
  const full = trip.lists[kind].length >= MAX_ENTRIES;

  const add = (lines: string[]) => {
    const now = Date.now();
    const entries = lines.map((l, i) => entry(l, {}, now + i)).filter((e): e is ListEntry => !!e);
    if (entries.length) app.addEntries(kind, entries);
  };
  const submit = (e: Event) => {
    e.preventDefault();
    add([text]);
    setText('');
  };
  // Pasting several lines (a list copied from notes) adds one entry per line.
  const paste = (e: ClipboardEvent) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (!/\n/.test(pasted.trim())) return;
    e.preventDefault();
    add(splitLines(pasted));
  };

  const row = (e: ListEntry) => {
    const where = kind === 'shopping' ? whereToBuy(e, trip.state) : '';
    const detail = [entryDetail(e), where && `在哪買：${where}`].filter(Boolean).join('　');
    return (
      <li class={e.done ? 'check-row done' : 'check-row'} key={e.id}>
        <input type="checkbox" class="big-check" checked={!!e.done} aria-label={`${e.text}${e.done ? '，已完成' : ''}`}
          onChange={() => app.updateEntry(kind, e.id, { done: !e.done })} />
        <button class="check-text" onClick={() => setEditing(e)}>
          <span>{e.text}</span>
          {detail && <small>{detail}</small>}
        </button>
      </li>
    );
  };

  return (
    <div class="screen">
      <header class="bar"><h1 class="bar-title">清單</h1></header>
      <div class="list-kinds" role="tablist" aria-label="選擇清單">
        {KINDS.map(([k, label]) => {
          const list = trip.lists[k];
          return (
            <button role="tab" aria-selected={k === kind} onClick={() => app.setPrefs({ listTab: k })}>
              {label}<small>{list.filter((e) => e.done).length}/{list.length}</small>
            </button>
          );
        })}
      </div>
      <main class="body">
        <p class="tiny muted private-note"><Icon name="lock" size={14} />只存在這支手機，不會同步給旅伴</p>
        <form class="add-row" onSubmit={submit}>
          <input class="input" value={text} maxLength={80} enterKeyHint="done" disabled={full}
            placeholder={full ? `最多 ${MAX_ENTRIES} 項` : kind === 'shopping' ? '要買什麼？' : '要帶什麼？'}
            aria-label={`新增到${name}清單`} onInput={(e) => setText(e.currentTarget.value)} onPaste={paste} />
          <button class="btn primary" disabled={!text.trim()}>加入</button>
        </form>
        {todo.length > 0 ? (
          <ul class="card rows">{todo.map(row)}</ul>
        ) : (
          <p class="empty small">{done.length ? '全部完成了！' : kind === 'shopping' ? '還沒有要買的東西。' : '還沒有要帶的東西。'}</p>
        )}
        {done.length > 0 && (
          <>
            <h2 class="section-label">{doneName} {done.length}</h2>
            <ul class="card rows">{done.map(row)}</ul>
          </>
        )}
        <p class="tiny muted">
          {kind === 'shopping' ? '點一項可以改名稱、給誰、數量，或連到某一站的店家。' : '點一項可以改名稱或刪除。'}
          一次貼上好幾行，會一行加一項。
        </p>
        <button class="btn plain" onClick={() => app.go({ to: 'bulk' })}>批次匯入（可請 AI 整理）</button>
      </main>
      <Tabs />
      {editing && <EditEntry kind={kind} entry={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

/** Every stop, and every shop of each stop, as places to buy something. Value: "item|shop". */
function placesToBuy() {
  const trip = app.trip!;
  const items = [...app.days.flatMap((d) => itemsOn(trip.state, d)), ...undated(trip.state, app.days)];
  return items.flatMap((i) => {
    const title = String(i.values.title ?? '（未命名）');
    const day = app.days.indexOf(String(i.values.date ?? '')) + 1;
    const prefix = day ? `第 ${day} 天 ` : '口袋名單 ';
    return [
      { value: `${i.id}|`, label: `${prefix}${title}` },
      ...shopsOf(i.values).map((s) => ({ value: `${i.id}|${s.id}`, label: `${prefix}${title}・${s.name}` })),
    ];
  });
}

function EditEntry({ kind, entry: e, onClose }: { kind: ListKind; entry: ListEntry; onClose: () => void }) {
  const [text, setText] = useState(e.text);
  const [forWho, setFor] = useState(e.for ?? '');
  const [qty, setQty] = useState(e.qty ?? '');
  const [at, setAt] = useState(e.at ? `${e.at.item}|${e.at.shop ?? ''}` : '');
  const places = kind === 'shopping' ? placesToBuy() : [];
  const known = !at || places.some((p) => p.value === at);

  const save = (ev: Event) => {
    ev.preventDefault();
    const clean = entry(text, { for: forWho, qty });
    if (!clean) return;
    const [item, shop] = at.split('|');
    app.updateEntry(kind, e.id, {
      text: clean.text, for: clean.for, qty: clean.qty,
      at: kind === 'shopping' && item && known ? (shop ? { item, shop } : { item }) : undefined,
    });
    onClose();
  };
  const remove = () => (app.removeEntry(kind, e.id), onClose());

  return (
    <Sheet onClose={onClose}>
      <form class="stack" style={{ gap: '12px' }} onSubmit={save}>
        <h2>{kind === 'shopping' ? '要買的東西' : '要帶的東西'}</h2>
        <label class="field">名稱
          <input class="input" value={text} maxLength={80} onInput={(x) => setText(x.currentTarget.value)} />
        </label>
        {kind === 'shopping' && (
          <>
            <div class="pair">
              <label class="field">給誰（選填）
                <input class="input" value={forWho} maxLength={30} placeholder="例如：媽媽" onInput={(x) => setFor(x.currentTarget.value)} />
              </label>
              <label class="field">數量（選填）
                <input class="input" value={qty} maxLength={20} placeholder="例如：2 盒" onInput={(x) => setQty(x.currentTarget.value)} />
              </label>
            </div>
            <label class="field">在哪買（選填）
              <select class="input" value={known ? at : ''} onChange={(x) => setAt(x.currentTarget.value)}>
                <option value="">不指定</option>
                {places.map((p) => <option value={p.value}>{p.label}</option>)}
              </select>
              <span class="hint">選了之後，到那一站時詳細資料裡會顯示「我要買」。</span>
            </label>
          </>
        )}
        <div class="pair">
          <button type="button" class="btn line danger" onClick={remove}>刪除</button>
          <button class="btn primary" disabled={!text.trim()}>儲存</button>
        </div>
      </form>
    </Sheet>
  );
}
