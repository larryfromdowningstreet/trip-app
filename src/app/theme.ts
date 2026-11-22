// Which palette and which of day or night to show, and switching between them.

import { type ThemeSetting, sunTimes, themeFor } from '../core/sun';
import { transition } from '../ui/sunset';
import { type Place, clock, dateOf } from './trip';

export type Palette = 'warm' | 'forest';
export type Mode = 'day' | 'night';

export const PALETTES: { id: Palette; name: string; swatch: string[] }[] = [
  { id: 'warm', name: '暖棕奶茶', swatch: ['#F5EDE2', '#ECD9C3', '#74513A'] },
  { id: 'forest', name: '森林綠霧金', swatch: ['#F3EEE2', '#B29A66', '#23402F'] },
];

const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/** Auto follows the sun at the destination; with no place yet it follows the phone's own setting. */
export const decideMode = (setting: ThemeSetting, place: Place | undefined, now = Date.now()): Mode =>
  themeFor(setting, now, place) ?? (systemDark() ? 'night' : 'day');

export function showTheme(palette: Palette, mode: Mode, animate: boolean) {
  const root = document.documentElement;
  const was = { palette: root.dataset.palette, mode: root.dataset.mode };
  if (was.palette === palette && was.mode === mode) return;
  const apply = () => {
    root.dataset.palette = palette;
    root.dataset.mode = mode;
    const bar = getComputedStyle(root).getPropertyValue('--bar-bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
  };
  if (!animate || !was.palette) return apply();
  transition(was.palette !== palette ? 'fade' : mode === 'night' ? 'to-night' : 'to-day', apply);
}

/** The line under "自動" in settings: when the next switch happens. */
export function nextSwitch(place: Place | undefined, now = new Date()): string {
  if (!place) return '行程裡還沒有座標，先跟著手機的深淺色設定';
  for (let d = 0; d < 2; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const sun = sunTimes(dateOf(day), place.lat, place.lng);
    if ('polar' in sun) return sun.polar === 'day' ? '目的地現在是永晝，維持白天' : '目的地現在是永夜，維持夜晚';
    const word = d === 0 ? '今天' : '明天';
    if (sun.sunrise > now.getTime()) return `${word} ${clock(sun.sunrise)} 日出時切換成白天`;
    if (sun.sunset > now.getTime()) return `${word === '今天' ? '今晚' : word} ${clock(sun.sunset)} 日落時切換成夜晚`;
  }
  return '';
}
