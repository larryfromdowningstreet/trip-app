// Turning pages between the bottom tabs, as in a book whose spine is the left edge of the screen.
// The tabs are pages 1, 2, 3… from left to right; going from page 1 to page 4 turns three leaves.
//   forward: the current page lifts from the right and turns over to the left, revealing the next
//   backward: a leaf comes back from the left and lands on top, ending with the page asked for
// Everything above the tabs turns, the top bar included; the tabs stay put. Leaves in between, and the back
// of every leaf, are frosted glass. With "reduce motion" the pages just cross-fade.

import { snapshot } from './snapshot';

const ONE_MS = 640; // a single turn
const MANY_MS = 520; // each turn when several follow each other
const GAP_MS = 150; // how soon the next leaf follows
const EASE = 'cubic-bezier(0.45, 0.05, 0.3, 1)';

let finish: (() => void) | undefined;

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Runs `apply` (which shows the new tab) and turns `steps` pages: positive forward, negative back. */
export async function turnPages(steps: number, apply: () => void) {
  finish?.();
  const app = document.getElementById('app');
  const screen = app?.querySelector<HTMLElement>('.screen');
  if (!app || !screen || !steps || document.visibilityState !== 'visible') return apply();

  // The part of the screen that turns: from the very top down to the tabs.
  const tabs = screen.querySelector('nav.tabs')?.getBoundingClientRect();
  const top = 0;
  const bottom = tabs ? tabs.top : innerHeight;

  const stage = document.createElement('div');
  stage.className = 'turn';
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  stage.style.top = `${top}px`;
  stage.style.height = `${bottom - top}px`;
  document.body.append(stage);

  /** One page's worth of a screen copy, cut to the turning area. */
  const page = (face: HTMLElement) => {
    const window_ = document.createElement('div');
    window_.className = 'turn-view';
    window_.style.top = `${-top}px`;
    face.append(window_);
    snapshot(app, window_);
  };
  const leaf = (content: boolean) => {
    const el = document.createElement('div');
    el.className = 'leaf';
    el.innerHTML = '<div class="face front"></div><div class="face back glass"></div><div class="shade"></div>';
    if (!content) el.querySelector('.front')!.classList.add('glass');
    return el;
  };

  const cleanup = () => {
    stage.remove();
    finish = undefined;
  };
  finish = cleanup;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    page(stage);
    apply();
    stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = cleanup;
    return;
  }

  const n = Math.abs(steps);
  const each = n === 1 ? ONE_MS : MANY_MS;
  const leaves: HTMLElement[] = [];

  if (steps > 0) {
    // The current page on top, then plain glass leaves for the pages in between.
    for (let i = 0; i < n; i++) {
      const l = leaf(i === 0);
      l.style.zIndex = String(n - i);
      stage.append(l);
      if (i === 0) page(l.querySelector('.front')!);
      leaves.push(l);
    }
    apply();
    await nextFrame();
  } else {
    // The old page stays underneath while leaves land on it; the last one carries the new page.
    const base = document.createElement('div');
    base.className = 'face';
    stage.append(base);
    page(base);
    for (let i = 0; i < n; i++) {
      const l = leaf(i === n - 1);
      l.style.zIndex = String(i + 1);
      l.style.transform = 'rotateY(-180deg)';
      stage.append(l);
      leaves.push(l);
    }
    apply();
    await nextFrame(); // the new tab is drawn now: copy it onto the last leaf
    if (finish !== cleanup) return;
    page(leaves[n - 1].querySelector('.front')!);
  }

  const turns = leaves.map((l, i) => {
    const from = steps > 0 ? 0 : -180;
    const to = steps > 0 ? -180 : 0;
    const options = { duration: each, delay: i * GAP_MS, easing: EASE, fill: 'forwards' as const };
    // A real page lifts a little toward you halfway through.
    l.animate([
      { transform: `rotateY(${from}deg)` },
      { transform: `rotateY(${(from + to) / 2}deg) translateZ(30px)`, offset: 0.5 },
      { transform: `rotateY(${to}deg)` },
    ], options);
    // Light falls off as the page stands up, and comes back as it lies down.
    return l.querySelector<HTMLElement>('.shade')!.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], options).finished;
  });
  await Promise.all(turns).catch(() => undefined);
  if (finish === cleanup) cleanup();
}
