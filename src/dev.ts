// Development only (never in the built app): fills a sample trip so every screen has something to show.
// In the browser console: await dev.seed()

import jsQR from 'jsqr';
import { app } from './app/store';
import { dateOf } from './app/trip';
import { sealBundle, signBatch } from './core/bundle';
import { type Identity, createIdentity } from './core/crypto';
import { addItem, deleteItem, setField } from './core/merge';
import type { ChangeRecord } from './core/model';

const at = (minutesFromNow: number) => {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const day = (offset: number) => dateOf(new Date(Date.now() + offset * 86_400_000));

async function seed() {
  await app.createTrip('京都五日遊', day(-1), day(3));
  const KYOTO = { lat: 34.9949, lng: 135.785 };
  const plan: Record<string, unknown>[] = [
    { date: day(-1), start: '10:00', title: '關西機場入境', type: 'transport' },
    { date: day(-1), start: '15:00', title: '飯店 Check-in', type: 'stay', addressLocal: '京都府京都市下京区東塩小路町' },
    { date: day(0), start: at(-200), end: at(-150), title: '飯店大廳集合', type: 'gather' },
    { date: day(0), start: at(-140), end: at(-90), title: '伏見稻荷大社', type: 'sight', lat: 34.9671, lng: 135.7727 },
    { date: day(0), start: at(-80), end: at(-10), title: '午餐：錦市場', type: 'meal' },
    { date: day(0), start: at(25), end: at(145), title: '清水寺', type: 'sight', ...KYOTO, addressLocal: '京都府京都市東山区清水1丁目294', transport: '步行約 20 分鐘', note: '本堂整修中，舞台可以上去' },
    { date: day(0), start: at(155), title: '二年坂・三年坂散步', type: 'sight' },
    { date: day(0), start: at(260), title: '八坂神社', type: 'sight', lat: 35.0037, lng: 135.7785 },
    { date: day(0), start: at(350), title: '晚餐：京都燒肉', type: 'meal', booking: '19:00 四位，訂位代號 KY-2231' },
    { date: day(0), start: at(470), title: '回飯店', type: 'transport' },
    { date: day(1), start: '09:00', title: '嵐山小火車', type: 'transport', transport: 'JR 嵯峨野線到嵯峨嵐山站，步行 2 分鐘' },
    { date: day(1), start: '11:00', title: '竹林小徑', type: 'sight' },
    { date: day(2), start: '10:00', title: '金閣寺', type: 'sight', lat: 35.0394, lng: 135.7292 },
    { date: day(3), start: '12:00', title: '關西機場', type: 'transport' },
  ];
  for (const values of plan) await app.saveItem(undefined, values);

  const trip = app.trip!;
  const [hua, mei, qiang] = await Promise.all(['小華', '小美', '小強'].map(createIdentity));
  await app.invite([hua, mei, qiang].map((person) => ({ person, role: 'organizer' as const })));

  const find = (title: string) => [...trip.state.items.values()].find((i) => i.values.title === title)!;
  const yasaka = find('八坂神社');
  const nishiki = find('午餐：錦市場');
  const beef = find('晚餐：京都燒肉');
  const before = trip.state; // what the others saw before going offline
  const stamp = (who: { id: string }, s: number, minutesAgo: number) => ({ a: who.id, s, t: Date.now() - minutesAgo * 60_000 });

  // I change 八坂神社's start while 小美 changes it too; 小美 deletes 錦市場 while I add a note.
  await app.saveItem(yasaka.id, { start: '17:00' });
  await app.saveItem(nishiki.id, { note: '早上人比較少' });
  const theirs: ChangeRecord[] = [
    setField(before, stamp(mei, 1, 30), yasaka.id, 'start', '18:00'),
    deleteItem(before, stamp(mei, 2, 50), nishiki.id),
    setField(before, stamp(hua, 1, 20), beef.id, 'note', '改成 19:30，已經跟店家說了'),
    addItem(stamp(hua, 2, 18), { date: day(1), start: '15:00', title: '抹茶甜點', type: 'meal' }),
  ];
  // As if scanned from their phones: each person's changes signed by them, sealed with the trip key.
  const from = (who: Identity) => signBatch(trip.meta.id, theirs.filter((r) => r.a === who.id), who);
  await app.takeBundle(await sealBundle([await from(mei), await from(hua)], trip.data.key, { from: hua.id, have: {} }));
}

/** Reads the QR Code this phone is showing, with the same decoder iPhones use for scanning. */
function readQr(): string {
  const canvas = document.querySelector<HTMLCanvasElement>('#app .qr-card canvas');
  const image = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
  return (image && jsQR(image.data, image.width, image.height)?.data) || '';
}

export function install() {
  Object.assign(window, { dev: { seed, app, readQr } });
}
