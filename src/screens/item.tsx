// One itinerary item: editing it, showing it to a taxi driver, and its ticket.

import { useEffect, useRef, useState } from 'preact/hooks';
import { app } from '../app/store';
import { TYPES, driverAsk, formatCoords, longDay, mapLink, parseCoords, placeFor, shortDay, toMinutes, weekday } from '../app/trip';
import { findPlusCode } from '../core/pluscode';
import { MAX_SHOPS, SHOP, type Shop, newShopId, shopValue, shopsOf } from '../core/shops';
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
  const [shops, setShops] = useState<Shop[]>(() => shopsOf(v));
  const [asking, setAsking] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (field: keyof typeof form) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [field]: e.currentTarget.value });

  const near = placeFor(trip.state, form.date); // for short Plus Codes
  const place = parseCoords(form.coords, near);
  const shortCode = !place && findPlusCode(form.coords)?.full === false;
  const problems = {
    title: form.title.trim() ? '' : '請填標題',
    end: form.start && form.end && toMinutes(form.end)! < toMinutes(form.start)! ? '結束時間比開始早' : '',
    coords: !form.coords.trim() || place ? ''
      : shortCode ? '這是簡短的 Plus Code，要行程裡先有一個附近地點的座標才能換算；或改貼完整的（例如 8Q6QXQVP+W2）'
      : '看不懂這個座標，格式像 35.0116, 135.7681 或 Plus Code「XQVP+W2 京都市」',
  };
  const owner = form.owner && form.owner !== app.me.id ? app.member(form.owner) : undefined;
  const organizers = trip.data.members.filter((m) => m.trust.access === 'edit');
  const missing = id && !item; // deleted on another phone meanwhile

  const save = async () => {
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    const { coords: _, ...rest } = form;
    // Each shop is its own field; a shop taken off the list (or left without a name) is cleared.
    const shopFields: Record<string, unknown> = {};
    for (const old of shopsOf(v)) shopFields[SHOP + old.id] = null;
    for (const s of shops) {
      const value = shopValue(s);
      if (value) shopFields[SHOP + s.id] = value;
    }
    await app.saveItem(id, { ...rest, ...shopFields, title: form.title.trim(), lat: place?.lat ?? null, lng: place?.lng ?? null });
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
          <input class="input" value={form.coords} placeholder="例如 34.9949, 135.785" onInput={set('coords')} />
          {problems.coords && <span class="error">{problems.coords}</span>}
          <details class="hint">
            <summary>怎麼取得座標？</summary>
            <ol class="how">
              <li>
                <b>問 AI</b>：例如「清水寺的座標是多少？」，把它給的數字（像 34.99494, 135.78500）貼上。
                <span class="danger-text">AI 可能答錯，請務必查證</span>：把座標貼到 Google 地圖搜尋，確認圖釘落在正確的地方。
              </li>
              <li>
                <b>Google 地圖長按空地</b>：先把地圖放到最大，長按目標旁邊沒有店家的地方（例如路中間），
                再把下方「已放置的圖釘」資訊卡往上拉，點開頭是數字的那一行就會複製。
              </li>
            </ol>
          </details>
        </label>
        <label class="field">交通方式<input class="input" value={form.transport} onInput={set('transport')} /></label>
        <label class="field">預約資訊<input class="input" value={form.booking} placeholder="訂位代號、車廂座位" onInput={set('booking')} /></label>
        <label class="field">想做的事
          <textarea class="input" rows={2} value={form.note} placeholder="例如：看夜景、拍合照、記得帶護照" onInput={set('note')} />
        </label>
        <fieldset class="field shop-edit">
          <legend>店家（選填，想逛的店）</legend>
          {shops.map((s, i) => {
            const edit = (k: 'name' | 'where' | 'buy') => (e: { currentTarget: { value: string } }) =>
              setShops(shops.map((x, j) => (j === i ? { ...x, [k]: e.currentTarget.value } : x)));
            return (
              <div class="shop-row" key={s.id}>
                <input class="input" value={s.name} placeholder="店名" aria-label={`第 ${i + 1} 家店名`} onInput={edit('name')} />
                <input class="input" value={s.where} placeholder="樓層/位置" aria-label={`第 ${i + 1} 家位置`} onInput={edit('where')} />
                <button type="button" class="icon-btn" aria-label={`移除${s.name || `第 ${i + 1} 家`}`}
                  onClick={() => setShops(shops.filter((_, j) => j !== i))}><Icon name="close" size={20} /></button>
                <input class="input buy" value={s.buy} placeholder="想買什麼（選填）" aria-label={`第 ${i + 1} 家想買什麼`} onInput={edit('buy')} />
              </div>
            );
          })}
          {shops.length < MAX_SHOPS && (
            <button type="button" class="btn soft" onClick={() => setShops([...shops, { id: newShopId(), name: '', where: '', buy: '', t: Date.now() }])}>
              <Icon name="plus" />加一家店
            </button>
          )}
        </fieldset>
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
