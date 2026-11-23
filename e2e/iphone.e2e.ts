// The website as an iPhone uses it: Safari (WebKit), an iPhone screen, touch.
// Every test starts on a new phone: empty storage, no service worker.

import { readFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

const PIN = '3826';

/** Opened from the home screen icon, so the "add to home screen" guide is skipped. */
const asInstalled = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));

/** Fails the test on any script error, and on any request that leaves this computer. */
function watch(page: Page) {
  const errors: string[] = [];
  const outside: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const { protocol, hostname } = new URL(r.url());
    if (!['data:', 'blob:'].includes(protocol) && hostname !== '127.0.0.1') outside.push(r.url());
  });
  return () => {
    expect(errors, 'script errors').toEqual([]);
    expect(outside, 'requests to other sites').toEqual([]);
  };
}

async function createProfile(page: Page) {
  await expect(page.getByRole('heading', { name: '開始之前' })).toBeVisible();
  await page.getByRole('textbox', { name: /暱稱/ }).fill('小明');
  await page.getByLabel('PIN 碼', { exact: true }).fill(PIN);
  await page.getByLabel('再輸入一次 PIN 碼').fill(PIN);
  await page.getByRole('button', { name: '建立身分' }).click();
  await expect(page.getByRole('heading', { name: '我的旅程' })).toBeVisible({ timeout: 20_000 });
}

async function createTrip(page: Page) {
  await page.getByRole('button', { name: '建立新旅程' }).click();
  await page.getByPlaceholder('例如：京都五日遊').fill('東京三日');
  await page.getByRole('button', { name: '建立', exact: true }).click();
  await expect(page.getByRole('button', { name: /離開「東京三日」/ })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: '主選單' }).getByRole('button', { name });

/** Taps a bottom tab and waits for the page turn to start and finish. */
async function turnTo(page: Page, name: string) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.turn')).toHaveCount(0, { timeout: 5_000 }); // the leaves are cleaned up
}

test('in Safari (not yet on the home screen) the install guide comes first', async ({ page }) => {
  const check = watch(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '把 App 加到主畫面' })).toBeVisible();
  await page.getByRole('button', { name: '稍後再說' }).click();
  await expect(page.getByRole('heading', { name: '開始之前' })).toBeVisible();
  check();
});

test('the page may not connect anywhere (CSP)', async ({ page }) => {
  const check = watch(page);
  await asInstalled(page);
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("default-src 'self'");
  const tries = await page.evaluate(async () => {
    const attempt = (run: () => Promise<unknown>) => run().then(() => 'connected', () => 'blocked');
    return {
      fetchOther: await attempt(() => fetch('https://example.com/')),
      fetchOwn: await attempt(() => fetch('./manifest.webmanifest')),
    };
  });
  expect(tries).toEqual({ fetchOther: 'blocked', fetchOwn: 'blocked' });
  // A beacon may be queued, but the browser must never send it.
  await page.evaluate(() => navigator.sendBeacon('https://example.com/', 'x'));
  await page.waitForTimeout(500);
  check();
});

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

/** A copy of the built site that the test can switch off, as if the phone lost its network. */
async function serveBuild(): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url!, 'http://x').pathname)).replace(/^([/\\]\.\.)+/, '');
    const file = join('dist', path.endsWith('/') ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))),
  };
}

// The server really goes away (rather than the browser pretending to be offline, which WebKit's test build
// does below the service worker), so every file must come from the service worker's cache.
test('opens with no network once the files are stored', async ({ page }) => {
  const check = watch(page);
  const site = await serveBuild();
  await asInstalled(page);
  await page.goto(site.url);
  await createProfile(page);
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByText('已可離線使用')).toBeVisible({ timeout: 30_000 }); // the service worker has every file

  await site.stop();
  await page.reload();
  await expect(page.getByRole('heading', { name: '輸入 PIN 碼' })).toBeVisible();
  for (const digit of PIN) await page.getByRole('group', { name: '數字鍵盤' }).getByRole('button', { name: digit, exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的旅程' })).toBeVisible({ timeout: 20_000 });
  // A cold start too: a new tab with nothing in memory.
  const fresh = await page.context().newPage();
  await fresh.goto(site.url);
  await expect(fresh.getByRole('heading', { name: '輸入 PIN 碼' })).toBeVisible();
  check();
});

test('main flow: identity, trip, an item, every tab, lock and unlock', async ({ page }) => {
  const check = watch(page);
  await asInstalled(page);
  await page.goto('./');
  await createProfile(page);
  await createTrip(page);

  // Add an item from the itinerary tab.
  await turnTo(page, '行程');
  await page.getByRole('button', { name: '新增行程' }).click();
  await page.getByRole('textbox', { name: /^標題/ }).fill('淺草寺');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.getByText('淺草寺').first()).toBeVisible();

  for (const name of ['同步', '清單', '設定', '下一站', '設定', '行程']) await turnTo(page, name);

  // Keys (CryptoKey objects) and the vault survive a restart.
  await page.reload();
  await expect(page.getByRole('heading', { name: '輸入 PIN 碼' })).toBeVisible();
  for (const digit of PIN) await page.getByRole('group', { name: '數字鍵盤' }).getByRole('button', { name: digit, exact: true }).click();
  await expect(page.getByRole('button', { name: /離開「東京三日」/ })).toBeVisible({ timeout: 20_000 });
  await turnTo(page, '行程');
  await expect(page.getByText('淺草寺').first()).toBeVisible();
  check();
});

test('page turn: leaves appear, turn, and are removed; the new tab is shown', async ({ page }) => {
  const check = watch(page);
  await asInstalled(page);
  await page.goto('./');
  await createProfile(page);
  await createTrip(page);

  // Forward over three pages, then back over three.
  await tab(page, '清單').click();
  await expect(page.locator('.turn .leaf')).toHaveCount(3);
  const turning = await page.locator('.turn .leaf').first().evaluate((el) => getComputedStyle(el).transformStyle);
  expect(turning).toBe('preserve-3d');
  await expect(page.locator('.turn')).toHaveCount(0, { timeout: 5_000 });
  await expect(tab(page, '清單')).toHaveAttribute('aria-current', 'page');

  await tab(page, '下一站').click();
  await expect(page.locator('.turn .leaf')).toHaveCount(3);
  await expect(page.locator('.turn')).toHaveCount(0, { timeout: 5_000 });
  await expect(tab(page, '下一站')).toHaveAttribute('aria-current', 'page');

  // Tapping again mid-turn finishes the first turn at once and starts the next one.
  await tab(page, '行程').click();
  await tab(page, '同步').click();
  await expect(page.locator('.turn')).toHaveCount(0, { timeout: 5_000 });
  await expect(tab(page, '同步')).toHaveAttribute('aria-current', 'page');

  // The frosted glass uses the prefixed property older Safari needs.
  const glass = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'glass';
    const wrap = document.createElement('div');
    wrap.className = 'turn';
    wrap.append(probe);
    document.body.append(wrap);
    const s = getComputedStyle(probe) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    const value = s.backdropFilter || s.webkitBackdropFilter || '';
    wrap.remove();
    return value;
  });
  expect(glass).toContain('blur');
  check();
});

test.describe('reduce motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('pages cross-fade instead of turning', async ({ page }) => {
    await asInstalled(page);
    await page.goto('./');
    await createProfile(page);
    await createTrip(page);
    await tab(page, '清單').click();
    await expect(page.locator('.turn .leaf')).toHaveCount(0);
    await expect(page.locator('.turn')).toHaveCount(0, { timeout: 2_000 });
    await expect(tab(page, '清單')).toHaveAttribute('aria-current', 'page');
  });
});

/** Replaces the camera: refuses with `name`, or has no camera API at all (`missing`). */
const camera = (page: Page, outcome: 'NotAllowedError' | 'NotFoundError' | 'missing') =>
  page.addInitScript((outcome) => {
    if (outcome === 'missing') {
      Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined });
      return;
    }
    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    devices.getUserMedia = () => Promise.reject(new DOMException('refused', outcome));
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { get: () => devices });
  }, outcome);

async function openScanner(page: Page) {
  await page.getByRole('button', { name: '加入旅程（面對面互掃）' }).click();
  await expect(page.getByRole('heading', { name: '輪流舉手機互掃' })).toBeVisible();
}

test('camera permission refused: explains how to allow it, can retry, and can still show own code', async ({ page }) => {
  const check = watch(page);
  await asInstalled(page);
  await camera(page, 'NotAllowedError');
  await page.goto('./');
  await createProfile(page);
  await openScanner(page);

  const problem = page.getByRole('alert');
  await expect(problem).toContainText('沒有相機權限');
  await expect(problem).toContainText('Safari');
  await page.getByRole('button', { name: '再試一次' }).click();
  await expect(problem).toContainText('沒有相機權限');

  // The other way round still works: show my code so the others scan me.
  await page.getByRole('radio', { name: '顯示我的' }).click();
  await expect(page.locator('.qr-card canvas')).toBeVisible();
  check();
});

test('no camera API (old iPhone, or not a secure page): a clear message instead of a crash', async ({ page }) => {
  const check = watch(page);
  await asInstalled(page);
  await camera(page, 'missing');
  await page.goto('./');
  await createProfile(page);
  await openScanner(page);
  await expect(page.getByRole('alert')).toContainText('這個瀏覽器不能使用相機');
  check();
});
