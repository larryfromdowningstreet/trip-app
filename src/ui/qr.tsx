// Showing data as (animated) QR Codes, and reading them with the camera.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Bytes } from '../core/bytes';
import { Receiver, qrFrames } from '../core/transfer';
import { useWakeLock } from '../platform/device';
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
    import('../platform/camera') // the QR reader is large; load it only when a scanner opens
      .then(({ startScanner }) => (gone ? undefined : startScanner(video.current!, take)))
      .then((s) => (gone ? s?.() : (stop = s)))
      .catch((e: Error) => setProblem(e.name === 'NotAllowedError' ? '沒有相機權限。請到手機的設定允許這個 App 使用相機。'
        : e.name === 'NotFoundError' ? '找不到相機。' : `相機打不開：${e.message}`));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  return (
    <div class="stack" style={{ gap: '8px' }}>
      <div class="camera">
        <video ref={video} playsInline muted />
        <span class="camera-frame" aria-hidden="true" />
        <span class="camera-prompt">{problem || progress || prompt}</span>
      </div>
      {note && <p class={note.bad ? 'note warn' : 'note ok'} role="status">{note.text}</p>}
    </div>
  );
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
