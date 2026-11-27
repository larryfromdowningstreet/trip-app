// Bytes ↔ the text shown in (animated) QR Codes, and what kind of thing a scan turned out to be.
// Every payload starts with a kind byte, so a phone can tell an identity from an update from an invite.

import { decodeBase45, encodeBase45 } from './base45';
import type { Bytes } from './bytes';
import { FrameCollector, type Progress, toFrames } from './frames';

export const KINDS = { identity: 0x01, bundle: 0x02, invite: 0x03, join: 0x04 } as const;
export type Kind = keyof typeof KINDS;

export const kindOf = (bytes: Uint8Array): Kind | undefined =>
  (Object.keys(KINDS) as Kind[]).find((k) => KINDS[k] === bytes[0]);

/**
 * Characters per QR Code: 450 gives a version-13 code (69×69 cells), big enough cells for a phone camera
 * at arm's length. Longer data simply takes more frames. To be tuned in the field test.
 */
export const FRAME_CHARS = 450;

export const qrFrames = (bytes: Uint8Array): string[] => toFrames(encodeBase45(bytes), FRAME_CHARS);

/** Collects frames from the camera; gives back the bytes once a whole payload is in. */
export class Receiver {
  private frames = new FrameCollector();

  add(text: string): (Progress & { bytes?: Bytes }) | undefined {
    const progress = this.frames.add(text);
    if (!progress?.text) return progress;
    this.frames = new FrameCollector();
    try {
      return { ...progress, bytes: decodeBase45(progress.text) };
    } catch {
      return undefined; // looked like ours, but is not
    }
  }
}
