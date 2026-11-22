// One itinerary item: editing it, showing it to a taxi driver, and its ticket.

import { useEffect, useRef, useState } from 'preact/hooks';
import { app } from '../app/store';
import { TYPES, driverAsk, formatCoords, longDay, mapLink, parseCoords, shortDay, toMinutes, weekday } from '../app/trip';
import { isApple, openOutside, useWakeLock } from '../platform/device';
import { Icon } from '../ui/icons';
import { BackBar, Confirm, Segmented } from '../ui/kit';

const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function Edit({ item: id, day }: { item?: string; day?: string }) {
  const trip = app.trip!;
  const item = id ? trip.state.items.get(id) : undefined;
  const v = item?.values ?? {};
  const [form, setForm] = useState(() => ({
    type: text(v.type) || 'sight',
    title: text(v.title),
    date: text(v.date) || day || app.days[0],
    start: text(v.start),
    end: text(v.end),
    addressLocal: text(v.addressLocal),
    coords: formatCoords(v),
    transport: text(v.transport),
    booking: text(v.booking),
    note: text(v.note),
    owner: text(v.owner),
  }));
  const [asking, setAsking] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (field: keyof typeof form) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [field]: e.currentTarget.value });

  const place = parseCoords(form.coords);
  const problems = {
    title: form.title.trim() ? '' : '請填標題',
    end: form.start && form.end && toMinutes(form.end)! < toMinutes(form.start)! ? '結束時間比開始早' : '',
    coords: form.coords.trim() && !place ? '看不懂這個座標，格式像 35.0116, 135.7681' : '',
  };
  const owner = form.owner && form.owner !== app.me.id ? app.member(form.owner) : undefined;
  const organizers = trip.data.members.filter((m) => m.trust.access === 'edit');
  const missing = id && !item; // deleted on another phone meanwhile

  const save = async () => {
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    const { coords: _, ...rest } = form;
    await app.saveItem(id, { ...rest, title: form.title.trim(), lat: place?.lat ?? null, lng: place?.lng ?? null });
    app.back();
  };

  const remove = async () => {
    await app.removeItem(id!);
    app.back();
  };

  return (
    <div class="screen">
      <BackBar title={id ? '編輯行程' : '新增行程'} action={!missing && <button class="bar-action" onClick={save}>儲存</button>} />
      <form class="body end form" onSubmit={(e) => (e.preventDefault(), save())}>
        {missing && <p class="note warn"><Icon name="warn" />這個項目已經被刪除了。</p>}
        {owner && <p class="note warn" role="note"><Icon name="warn" />這項由{owner.name}負責，修改前先跟他確認</p>}
        {item?.pending && (
          <button type="button" class="banner" onClick={() => app.go({ to: 'conflicts' })}>
            <span><Icon name="warn" />這個項目有衝突待確認</span><Icon name="next" />
          </button>
        )}
        <fieldset class="stack" style={{ gap: '6px' }}>
          <legend class="field" style={{ marginBottom: '6px' }}>類型</legend>
          <Segmented label="類型" options={TYPES} value={form.type as (typeof TYPES)[number][0]} onPick={(t) => setForm({ ...form, type: t })} />
        </fieldset>
        <label class="field">標題
          <input class="input" value={form.title} maxLength={80} onInput={set('title')} />
          {tried && problems.title && <span class="error">{problems.title}</span>}
        </label>
        <div class="grid3">
          <label class="field">日期
            <select class="input" value={form.date} onChange={set('date')}>
              {app.days.map((d) => <option value={d}>{shortDay(d)}（{weekday(d)}）</option>)}
            </select>
          </label>
          <label class="field">開始<input class="input" type="time" value={form.start} onInput={set('start')} /></label>
          <label class="field">結束<input class="input" type="time" value={form.end} onInput={set('end')} /></label>
        </div>
        {problems.end && <span class="error">{problems.end}</span>}
        <label class="field">當地語言地址（給司機看）
          <input class="input" value={form.addressLocal} placeholder="例如：京都府京都市右京区…" onInput={set('addressLocal')} />
        </label>
        <label class="field">座標（選填，用來導航和判斷日落）
          <input class="input" value={form.coords} inputmode="decimal" placeholder="在地圖 App 長按地點，複製座標貼上" onInput={set('coords')} />
          {problems.coords && <span class="error">{problems.coords}</span>}
        </label>
        <label class="field">交通方式<input class="input" value={form.transport} onInput={set('transport')} /></label>
        <label class="field">預約資訊<input class="input" value={form.booking} placeholder="訂位代號、車廂座位" onInput={set('booking')} /></label>
        <label class="field">備註
          <textarea class="input" rows={2} value={form.note} placeholder="其他要提醒大家的事" onInput={set('note')} />
        </label>
        {organizers.length > 1 && (
          <label class="field">負責人
            <select class="input" value={form.owner} onChange={set('owner')}>
              <option value="">不指定</option>
              {organizers.map((m) => <option value={m.id}>{m.id === app.me.id ? `${m.name}（你）` : m.name}</option>)}
            </select>
          </label>
        )}
        {id && !missing && <button type="button" class="btn text-danger push-end" onClick={() => setAsking(true)}>刪除這個項目</button>}
      </form>
      {asking && (
        <Confirm title="刪除這個項目？" danger yes="刪除" onNo={() => setAsking(false)} onYes={remove}
          text={`「${form.title || '這個項目'}」會從每個人的行程裡移除。如果有人同時在改它，會先保留下來讓主揪決定。`} />
      )}
    </div>
  );
}

export function Driver({ item: id }: { item: string }) {
  const item = app.trip!.state.items.get(id);
  const awake = useWakeLock();
  if (!item) return <Gone />;
  const v = item.values;
  const address = text(v.addressLocal);
  const ask = driverAsk(address);
  const name = text(v.place) || text(v.title);
  const size = name.length <= 5 ? 56 : name.length <= 8 ? 44 : 34; // keep the name on one or two lines
  const map = mapLink(v, false, isApple());
  return (
    <div class="screen card-bg">
      <header class="bar plain">
        <span class="muted bar-title" style={{ fontSize: '15px', fontWeight: 400 }}>給司機看・{text(v.title)}</span>
        <button class="icon-btn close-btn" aria-label="關閉" onClick={() => app.back()}><Icon name="close" size={22} /></button>
      </header>
      <main class="driver-body" lang={ask.lang}>
        {address && <p class="driver-ask">{ask.text}</p>}
        <h1 class="driver-name" style={{ '--name-size': `${size}px` }}>{name}</h1>
        {address ? <p class="driver-address">{address}</p> : <p class="hint">還沒有填當地語言地址，請主揪在「編輯行程」補上。</p>}
      </main>
      <footer class="foot">
        {awake && <p class="awake"><Icon name="sun" />螢幕保持開啟中</p>}
        {map && <a class="btn soft tall" href={map} target="_blank" rel="noopener noreferrer" onClick={(e) => openOutside(e, map)}><Icon name="pin" />在地圖 App 開啟這個地點</a>}
      </footer>
    </div>
  );
}

const MAX_TICKET = 15 << 20;

export function Ticket({ item: id }: { item: string }) {
  const item = app.trip!.state.items.get(id);
  const awake = useWakeLock();
  const [url, setUrl] = useState<string>();
  const [big, setBig] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const show = (bytes: Uint8Array | undefined, type = 'image/jpeg') =>
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return bytes ? URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })) : undefined;
    });

  useEffect(() => {
    app.readTicket(id).then((t) => t && show(t.bytes, t.type));
    return () => show(undefined);
  }, [id]);

  const pick = async (e: { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('請選擇圖片檔');
    if (file.size > MAX_TICKET) return setError('圖片太大了（上限 15 MB）');
    setError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    await app.saveTicket(id, { type: file.type, bytes });
    show(bytes, file.type);
  };

  const remove = async () => {
    setAsking(false);
    await app.saveTicket(id, undefined);
    show(undefined);
  };

  if (!item) return <Gone />;
  const v = item.values;
  return (
    // Tickets stay in day colors so gate staff can scan them.
    <div class="screen card-bg" data-palette={app.prefs.palette} data-mode="day">
      <BackBar title={`${text(v.title)}・票券`} sub={[v.date ? longDay(String(v.date)) : '', text(v.start)].filter(Boolean).join(' ')} />
      <main class="body end" style={{ gap: '16px', paddingTop: '12px' }}>
        <button class={url ? 'ticket-figure has-image' : 'ticket-figure'} onClick={() => (url ? setBig(true) : picker.current?.click())}
          aria-label={url ? '全螢幕顯示票券' : '加入票券截圖'}>
          {url ? <img src={url} alt="票券截圖" /> : <><Icon name="image" size={48} width={1.5} /><span>點這裡加入票券截圖<br />以原始畫質全螢幕顯示</span></>}
        </button>
        {error && <p class="error">{error}</p>}
        <div class="note bg stack" style={{ gap: '6px' }}>
          <span class="awake"><Icon name="lock" />只存在這支手機，不會同步給別人</span>
          {awake && <span class="awake"><Icon name="sun" />螢幕保持開啟中</span>}
        </div>
        <div class="pair">
          <button class="btn line" onClick={() => picker.current?.click()}>{url ? '更換截圖' : '選擇截圖'}</button>
          <button class="btn line danger" disabled={!url} onClick={() => setAsking(true)}>移除票券</button>
        </div>
        <input ref={picker} type="file" accept="image/*" hidden onChange={pick} />
      </main>
      {big && url && (
        <button class="fullscreen" aria-label="關閉全螢幕" onClick={() => setBig(false)}><img src={url} alt="票券截圖" /></button>
      )}
      {asking && <Confirm title="移除這張票券？" danger yes="移除" text="截圖只存在這支手機，移除後沒辦法復原。" onNo={() => setAsking(false)} onYes={remove} />}
    </div>
  );
}

function Gone() {
  return (
    <div class="screen">
      <BackBar title="找不到這個項目" />
      <main class="body"><p class="muted">它可能已經被刪除了。</p></main>
    </div>
  );
}
