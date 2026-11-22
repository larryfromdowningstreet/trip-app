import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The page may not send data anywhere (connect-src 'none') and loads nothing from other sites.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Build only: add the CSP and write a service worker that caches every file for offline use. */
function offline(): Plugin {
  return {
    name: 'offline',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      ),
    generateBundle(_, bundle) {
      const files = new Map<string, string | Uint8Array>();
      for (const item of Object.values(bundle)) files.set(item.fileName, item.type === 'chunk' ? item.code : item.source);
      for (const name of readdirSync('public')) files.set(name, readFileSync(`public/${name}`));

      const names = [...files.keys()].sort();
      const hash = createHash('sha256');
      for (const name of names) hash.update(name).update(files.get(name)!);
      const version = hash.digest('hex').slice(0, 12); // changes whenever any file's content changes

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorker(version, ['./', ...names.map((f) => `./${f}`)]),
      });
    },
  };
}

// Every app on this github.io address shares one cache store, so only touch caches named after this app.
const serviceWorker = (version: string, files: string[]) => `\
const PREFIX = 'trip-app-';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()),
));

// From the cache first. Anything missing is fetched and kept, so a cleared cache fills itself again.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(CACHE).then((cache) =>
    cache.match(e.request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }, () => (e.request.mode === 'navigate' ? cache.match('./') : Response.error())))));
});
`;

export default defineConfig({
  base: './',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') }, // shown in settings
  // Never inline files as data: URLs: the CSP only allows the app's own files.
  // Safari 14 and up, so older iPhones still run it.
  build: { target: ['es2020', 'safari14'], modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [offline()],
});
