// Small things the phone offers: keeping the screen on, asking storage not to be cleared, platform hints.

import { useEffect, useState } from 'preact/hooks';

/** Keeps the screen on while the calling screen is shown. Returns whether that worked. */
export function useWakeLock(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let gone = false;
    const take = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen');
        if (gone) lock?.release();
        else setOn(!!lock);
      } catch {
        setOn(false);
      }
    };
    const again = () => document.visibilityState === 'visible' && take(); // the lock ends when the app is hidden
    take();
    document.addEventListener('visibilitychange', again);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', again);
      lock?.release();
    };
  }, []);
  return on;
}

/** Running inside the Android app (Capacitor) rather than a browser. */
export const isNative = () => !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** True once the service worker has stored every file, so the app opens with no network. */
export function useOfflineReady(): boolean {
  const sw = navigator.serviceWorker;
  const [ready, setReady] = useState(!import.meta.env.PROD || !!sw?.controller);
  useEffect(() => {
    const done = () => setReady(true);
    sw?.addEventListener('controllerchange', done);
    return () => sw?.removeEventListener('controllerchange', done);
  }, []);
  return ready;
}

/** Asks the browser to keep our data even when space runs low. Best effort. */
export const keepData = () => navigator.storage?.persist?.().catch(() => false);

/** Hands a file to the person: the share sheet on iPhone (to save in Files), a download elsewhere. */
export async function saveFile(name: string, bytes: Uint8Array, type: string): Promise<void> {
  if (isNative()) return shareNative(name, bytes);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
  if (isApple() && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch((e: Error) => {
      if (e.name !== 'AbortError') throw e;
    });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The Android app's web view cannot download: write the file to the app's cache and open the share sheet. */
async function shareNative(name: string, bytes: Uint8Array) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { toBase64 } = await import('../core/bytes');
  const { uri } = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
  await Share.share({ title: name, files: [uri] }).catch((e: Error) => {
    if (!/cancel/i.test(e.message)) throw e;
  });
}

/** Opens a link in another app (maps). The Android app hands it to the system; browsers open a new tab. */
export function openOutside(e: MouseEvent, url: string) {
  if (!isNative()) return;
  e.preventDefault();
  location.href = url;
}
