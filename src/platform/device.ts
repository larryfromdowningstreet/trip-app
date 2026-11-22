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

export const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Asks the browser to keep our data even when space runs low. Best effort. */
export const keepData = () => navigator.storage?.persist?.().catch(() => false);
