// Showing data as (animated) QR Codes, and reading them with the camera.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Bytes } from '../core/bytes';
import { Receiver, qrFrames } from '../core/transfer';
import { isApple, isNative, useWakeLock } from '../platform/device';
import { drawQr } from '../platform/qr';
import { Icon } from './icons';

const FRAME_MS = 300;

/** Black on white whatever the mode, cycling through the frames when the data needs more than one. */
export function QrShow({ bytes }: { bytes: Bytes | undefined }) {
  useWakeLock();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setFrames(bytes ? qrFrames(bytes) : []);
    setIndex(0);
  }, [bytes]);
  useEffect(() => {
    if (frames.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(id);
  }, [frames]);
  useEffect(() => {
    if (canvas.current && frames[index]) drawQr(canvas.current, frames[index], Math.min(300, innerWidth - 90));
  }, [frames, index]);

  return (
    <figure class="qr-card">
      {frames.length ? <canvas ref={canvas} aria-label="QR Code" /> : <span class="qr-wait">準備中…</span>}
      <figcaption class="qr-count">{frames.length > 1 ? `第 ${index + 1} / ${frames.length} 張，自動輪播` : ' '}</figcaption>
    </figure>
  );
}

/**
 * The back camera, reading QR Codes until this is closed. `onBytes` handles one complete payload and
 * returns a line to show (or throws one); the same payload is not handled twice.
 */
export function Scanner({ prompt, onBytes }: { prompt: string; onBytes: (bytes: Bytes) => Promise<string | undefined> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0); // "再試一次" starts the camera again
  const handler = useRef(onBytes);
  handler.current = onBytes;

  useEffect(() => {
    const receiver = new Receiver();
    const done = new Set<string>();
    let busy = false;
    let stop: (() => void) | undefined;
    let gone = false;

    const take = async (text: string) => {
      if (busy || done.has(text.slice(0, 4))) return;
      const step = receiver.add(text);
      if (!step) return;
      if (!step.bytes) return setProgress(`收到 ${step.received} / ${step.total} 張`);
      done.add(text.slice(0, 4));
      busy = true;
      setProgress('');
      try {
        const line = await handler.current(step.bytes);
        if (!gone && line) setNote({ text: line });
      } catch (e) {
        if (!gone) setNote({ text: e instanceof Error ? e.message : String(e), bad: true });
        done.delete(text.slice(0, 4)); // let them try the same one again
      }
      busy = false;
    };

    if (import.meta.env.DEV) Object.assign(window, { devScan: take }); // tests feed decoded frames here
    setProblem('');
    const ended = () => !gone && setProblem('相機已經停止（App 曾切到背景，或被其他 App 使用）。');
    import('../platform/camera') // the QR reader is large; load it only when a scanner opens
      .then(({ startScanner }) => (gone ? undefined : startScanner(video.current!, take, ended)))
      .then((s) => (gone ? s?.() : (stop = s)))
      .catch((e: Error) => !gone && setProblem(cameraProblem(e)));
    return () => {
      gone = true;
      stop?.();
    };
  }, [attempt]);

  return (
    <div class="stack" style={{ gap: '8px' }}>
      <div class="camera">
        <video ref={video} playsInline muted autoPlay />
        <span class="camera-frame" aria-hidden="true" />
        <span class="camera-prompt">{problem ? '相機沒有開啟' : progress || prompt}</span>
      </div>
      {problem && (
        <div class="note warn" role="alert" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>{problem}</span>
          <button type="button" class="btn line" onClick={() => setAttempt((n) => n + 1)}>再試一次</button>
        </div>
      )}
      {note && <p class={note.bad ? 'note warn' : 'note ok'} role="status">{note.text}</p>}
    </div>
  );
}

/** What to tell the person when the camera does not start, in the words of their own phone's settings. */
function cameraProblem(e: Error): string {
  switch (e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      if (isNative()) return '沒有相機權限。請到手機的「設定 → 應用程式 → 漫旅手帳 → 權限」允許使用相機，再按「再試一次」。';
      if (isApple()) {
        return '沒有相機權限。請打開 iPhone 的「設定」，找到 Safari 的「相機」，改成「詢問」或「允許」，'
          + '再按「再試一次」；跳出詢問時選「允許」。還是不行的話，把 App 完全關掉再打開。';
      }
      return '沒有相機權限。請在瀏覽器的網站設定允許使用相機，再按「再試一次」。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '找不到相機。';
    case 'NotReadableError':
    case 'AbortError':
      return '相機正被其他 App 使用。關掉其他用到相機的 App，再按「再試一次」。';
    case 'NoCameraApi':
      return isApple()
        ? '這個瀏覽器不能使用相機。請用 Safari 打開，或從主畫面的圖示打開。'
        : '這個瀏覽器不能使用相機。請改用手機內建的瀏覽器打開。';
    default:
      return `相機打不開：${e.message || e.name}`;
  }
}

/** Steps across the top of a flow: done ones get a tick. */
export function Steps({ labels, at }: { labels: string[]; at: number }) {
  return (
    <ol class="steps-bar" aria-label={`第 ${at + 1} 步，共 ${labels.length} 步：${labels[at]}`}>
      {labels.map((label, i) => (
        <li class={i < at ? 'done' : i === at ? 'now' : ''}>
          <span class="dot">{i < at ? <Icon name="check" size={16} width={2.5} /> : i + 1}</span>
          <span class="label">{label}</span>
        </li>
      ))}
    </ol>
  );
}
