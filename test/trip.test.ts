import { describe, expect, it } from 'vitest';
import { nextSwitch } from '../src/app/theme';
import {
  countdown, driverAsk, itemsOn, longDay, mapLink, nextIndex, parseCoords, placeFor, tripDays, tripRange,
} from '../src/app/trip';
import { addItem, merge } from '../src/core/merge';

const A = 'aaaaaaaaaaaaaaaa';
let s = 0;
const item = (v: Record<string, unknown>) => addItem({ a: A, s: ++s, t: s }, v, `I${s}`);

describe('dates', () => {
  it('lists trip days across month ends and formats them', () => {
    expect(tripDays('2027-02-27', '2027-03-02')).toEqual(['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02']);
    expect(longDay('2027-03-11')).toBe('3 月 11 日（四）');
    expect(tripRange({ start: '2027-03-10', end: '2027-03-14' } as never)).toBe('2027/3/10 – 3/14');
    expect(tripRange({ start: '2026-12-30', end: '2027-01-02' } as never)).toBe('2026/12/30 – 2027/1/2');
  });
});

describe('next stop', () => {
  const state = merge([
    item({ date: '2027-03-11', start: '13:30', end: '15:30', title: '清水寺' }),
    item({ date: '2027-03-11', start: '08:30', title: '集合' }),
    item({ date: '2027-03-11', start: '15:40', title: '二年坂' }),
    item({ date: '2027-03-12', start: '09:00', title: '嵐山' }),
  ]);
  const day = itemsOn(state, '2027-03-11');
  const at = (hhmm: string) => new Date(`2027-03-11T${hhmm}:00`);

  it('sorts by time and finds what is next', () => {
    expect(day.map((i) => i.values.title)).toEqual(['集合', '清水寺', '二年坂']);
    expect(nextIndex(day, '2027-03-11', at('13:05'))).toBe(1);
    expect(nextIndex(day, '2027-03-11', at('14:00'))).toBe(1); // still at 清水寺 until it ends
    expect(nextIndex(day, '2027-03-11', at('15:35'))).toBe(2);
    expect(nextIndex(day, '2027-03-11', at('23:00'))).toBe(3); // all done
    expect(nextIndex(day, '2027-03-12', at('23:00'))).toBe(0); // tomorrow starts from the top
  });

  it('counts down in words', () => {
    expect(countdown(day, 1, '2027-03-11', at('13:05'))).toBe('還有 25 分鐘');
    expect(countdown(day, 1, '2027-03-11', at('11:00'))).toBe('還有 2 小時 30 分');
    expect(countdown(day, 1, '2027-03-11', at('14:00'))).toBe('進行中');
    expect(countdown(day, 1, '2027-03-12', at('14:00'))).toBe('');
  });
});

describe('places', () => {
  it('reads coordinates from text and map links', () => {
    expect(parseCoords('34.9949, 135.785')).toEqual({ lat: 34.9949, lng: 135.785 });
    expect(parseCoords('https://maps.google.com/?q=34.9949%2C135.785')).toEqual({ lat: 34.9949, lng: 135.785 });
    expect(parseCoords('https://www.google.com/maps/@35.0116,135.7681,15z')).toEqual({ lat: 35.0116, lng: 135.7681 });
    expect(parseCoords('-33.8568 151.2153')).toEqual({ lat: -33.8568, lng: 151.2153 });
    expect(parseCoords('34.99494° N, 135.78500° E')).toEqual({ lat: 34.99494, lng: 135.785 });
    expect(parseCoords('33.8568° S, 151.2153° E')).toEqual({ lat: -33.8568, lng: 151.2153 });
    expect(parseCoords('N 40.7128, W 74.0060')).toEqual({ lat: 40.7128, lng: -74.006 });
    expect(parseCoords('清水寺')).toBeUndefined();
    expect(parseCoords('95, 10')).toBeUndefined();
  });

  it('uses the nearest day with a place for the sunset', () => {
    const state = merge([
      item({ date: '2027-03-10', title: 'x', lat: 34.7, lng: 135.5 }),
      item({ date: '2027-03-13', title: 'y', lat: 35.0, lng: 135.7 }),
    ]);
    expect(placeFor(state, '2027-03-12')).toEqual({ lat: 35.0, lng: 135.7 });
    expect(placeFor(state, '2027-03-11')).toEqual({ lat: 34.7, lng: 135.5 });
    expect(placeFor(merge([]), '2027-03-11')).toBeUndefined();
  });

  it('builds map links and picks the driver phrase by script', () => {
    expect(mapLink({ lat: 35, lng: 135 }, true, false)).toBe('https://www.google.com/maps/dir/?api=1&destination=35%2C135');
    expect(mapLink({ addressLocal: '東京都' }, true, true)).toBe(`https://maps.apple.com/?daddr=${encodeURIComponent('東京都')}`);
    expect(mapLink({ title: 'x' }, true, true)).toBeUndefined();
    expect(driverAsk('京都府京都市東山区清水1丁目294').lang).toBe('ja');
    expect(driverAsk('서울특별시 중구').lang).toBe('ko');
    expect(driverAsk('台南市中西區').lang).toBe('zh-Hant');
    expect(driverAsk('10 Downing St').lang).toBe('en');
  });

  it('says when the theme will switch next (in the phone’s own clock)', () => {
    const kyoto = { lat: 34.9949, lng: 135.785 };
    expect(nextSwitch(kyoto, new Date('2027-03-11T13:05:00+09:00'))).toMatch(/^(今晚|明天) \d\d:\d\d 日落時切換成夜晚$/);
    expect(nextSwitch(kyoto, new Date('2027-03-11T22:00:00+09:00'))).toMatch(/^(今天|明天) \d\d:\d\d 日出時切換成白天$/);
    expect(nextSwitch(undefined)).toContain('還沒有座標');
  });
});

describe('plus codes', async () => {
  const { decodeFull, decodeShort, findPlusCode } = await import('../src/core/pluscode');
  it('decodes full codes and completes short ones from a nearby point', () => {
    // Expected values computed with Google's openlocationcode library
    expect(decodeFull('8FVC9G8F+6X')).toEqual({ lat: 47.365563, lng: 8.524938 });
    expect(decodeFull('8FVC9G8F+6XQ')).toEqual({ lat: 47.365588, lng: 8.524984 });
    expect(decodeShort('9G8F+6X', { lat: 47.4, lng: 8.6 })).toEqual({ lat: 47.365563, lng: 8.524938 });
    expect(decodeShort('9G8F+6X', { lat: 47.0, lng: 8.0 })).toEqual({ lat: 47.365563, lng: 7.524938 }); // nearest one
    expect(decodeShort('XWQP+4V', { lat: 35.0, lng: 135.77 })).toEqual({ lat: 34.987813, lng: 135.937188 });
    expect(findPlusCode('XWQP+4V 京都府京都市')).toEqual({ full: false, code: 'XWQP+4V' });
    expect(findPlusCode('8Q6QXWQP+4V')).toEqual({ full: true, code: '8Q6QXWQP+4V' });
    expect(findPlusCode('34.99, 135.78')).toBeUndefined();
  });

  it('works through parseCoords, with the trip as reference for short codes', () => {
    const kyoto = { lat: 35.0, lng: 135.77 };
    const full = parseCoords('8Q6QXWQP+4V')!;
    expect(parseCoords('XWQP+4V 京都市東山区', kyoto)).toEqual(full);
    expect(parseCoords('XWQP+4V 京都市東山区')).toBeUndefined();
  });
});
