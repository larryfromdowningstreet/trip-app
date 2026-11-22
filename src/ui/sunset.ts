// Switching day and night like a sunset: night spreads down from the top with an orange glow,
// day rises from the bottom with a golden one. A copy of the old screen sits on top and is wiped away
// through a soft-edged mask, so it works the same in every browser.

import { snapshot } from './snapshot';

const SWEEP_MS = 1400;
const FADE_MS = 200; // with "reduce motion", and for palette changes
const FEATHER = 0.4; // soft edge, as a share of the screen height

let finish: (() => void) | undefined;

export type Change = 'to-night' | 'to-day' | 'fade';

/** Covers the screen with a copy of how it looks now, runs `apply`, then reveals the new look. */
export function transition(change: Change, apply: () => void) {
  finish?.();
  const app = document.getElementById('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!app || document.visibilityState !== 'visible') return apply();

  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.setAttribute('aria-hidden', 'true');
  veil.inert = true;
  const root = document.documentElement;
  veil.dataset.palette = root.dataset.palette;
  veil.dataset.mode = root.dataset.mode;
  document.body.append(veil);
  snapshot(app, veil);
  apply();

  const glow = document.createElement('div');
  const cleanup = () => {
    veil.remove();
    glow.remove();
    finish = undefined;
  };
  finish = cleanup;

  if (change === 'fade' || reduce) {
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: change === 'fade' && !reduce ? 300 : FADE_MS }).onfinish = cleanup;
    return;
  }

  const toNight = change === 'to-night';
  glow.className = `glow ${toNight ? 'dusk' : 'dawn'}`;
  document.body.append(glow);
  const height = innerHeight;
  const feather = height * FEATHER;
  const start = performance.now();

  const frame = (now: number) => {
    if (finish !== cleanup) return;
    const p = Math.min(1, (now - start) / SWEEP_MS);
    const eased = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
    const edge = -feather + eased * (height + feather); // how far the new look has come, from its side
    const mask = `linear-gradient(${toNight ? 'to bottom' : 'to top'}, transparent ${edge}px, #000 ${edge + feather}px)`;
    veil.style.setProperty('-webkit-mask-image', mask);
    veil.style.setProperty('mask-image', mask);
    glow.style.top = `${toNight ? edge : height - edge - feather}px`;
    glow.style.opacity = String(Math.sin(Math.PI * p));
    if (p < 1) requestAnimationFrame(frame);
    else cleanup();
  };
  requestAnimationFrame(frame);
}
