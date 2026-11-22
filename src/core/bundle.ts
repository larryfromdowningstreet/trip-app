// The update package that travels in QR Codes and files.
//
// Outside: [kind 0x02][format 1][iv 12][AES-GCM ciphertext], encrypted with the trip key.
// Inside (deflated):
//   [header length 2][header JSON]: who made the bundle and what they already have (a version vector),
//     so a collector knows what everyone still lacks. Only the trip key protects it; it is a hint, not proof.
//   [batch count 2] then per batch [author id 8][signature 64][length 4][JSON], each signed by its author.
// A collector can pass on other people's batches without re-signing them.
// Order on arrival: size check, decrypt (which also proves the trip key), then each signature,
// and only then is any JSON parsed.

import { Inflate, deflateSync } from 'fflate';
import { type Bytes, concat, fromHex, fromUtf8, randomBytes, toHex, utf8 } from './bytes';
import { type Identity, type KeyId, importTripKey, sign, verify } from './crypto';
import type { Vector } from './log';
import { type ChangeRecord, isChangeRecord } from './model';

const KIND = 0x02;
const FORMAT = 1;
const IV = 12;
const SIG = 64;
const MAX_SEALED = 1 << 20; // refuse before doing any work
const MAX_OPEN = 4 << 20;

export type BundleError = 'format' | 'too-large' | 'decrypt';
export class BundleFailure extends Error {
  constructor(readonly code: BundleError) {
    super(code);
  }
}

export type BatchRejection = 'unknown-author' | 'bad-signature' | 'format' | 'wrong-trip';

export interface Batch {
  author: KeyId;
  json: Bytes;
  signature: Bytes;
}

export interface Header {
  from: KeyId;
  have: Vector;
}

export const isBundle = (bytes: Uint8Array) => bytes[0] === KIND;

/** Signs one person's records for one trip. */
export async function signBatch(trip: string, records: ChangeRecord[], me: Identity): Promise<Batch> {
  if (records.some((r) => r.a !== me.id)) throw new Error('a batch only holds its author’s records');
  const json = utf8(JSON.stringify({ v: FORMAT, trip, records }));
  return { author: me.id, json, signature: await sign(me, json) };
}

export async function sealBundle(batches: Batch[], tripKey: Bytes, header: Header): Promise<Bytes> {
  const head = utf8(JSON.stringify(header));
  const parts: ArrayLike<number>[] = [u16(head.length), head, u16(batches.length)];
  for (const b of batches) parts.push(fromHex(b.author), b.signature, u32(b.json.length), b.json);
  const iv = randomBytes(IV);
  const key = await importTripKey(tripKey);
  const plain = deflateSync(concat(...parts), { level: 9 });
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return concat([KIND, FORMAT], iv, sealed);
}

export interface Opened {
  header: Header;
  batches: Batch[]; // the ones that checked out, ready to pass on as they are
  records: ChangeRecord[];
  rejected: { author: KeyId; reason: BatchRejection }[];
}

export async function openBundle(
  bytes: Bytes,
  trip: string,
  tripKey: Bytes,
  signKeyOf: (author: KeyId) => Bytes | undefined,
): Promise<Opened> {
  if (bytes.length > MAX_SEALED) throw new BundleFailure('too-large');
  if (bytes.length < 2 + IV + 16 || bytes[0] !== KIND || bytes[1] !== FORMAT) throw new BundleFailure('format');

  let plain: Bytes;
  try {
    const key = await importTripKey(tripKey);
    const iv = bytes.subarray(2, 2 + IV);
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(2 + IV)));
  } catch {
    throw new BundleFailure('decrypt');
  }
  const { header, batches } = readInner(inflateCapped(plain, MAX_OPEN));

  const out: Opened = { header, batches: [], records: [], rejected: [] };
  for (const batch of batches) {
    const signKey = signKeyOf(batch.author);
    const reject = (reason: BatchRejection) => out.rejected.push({ author: batch.author, reason });
    if (!signKey) {
      reject('unknown-author');
      continue;
    }
    if (!(await verify(signKey, batch.signature, batch.json))) {
      reject('bad-signature');
      continue;
    }
    const body = parse(batch.json);
    if (!body || !body.records.every((r): r is ChangeRecord => isChangeRecord(r) && r.a === batch.author)) {
      reject('format');
      continue;
    }
    if (body.trip !== trip) {
      reject('wrong-trip');
      continue;
    }
    out.batches.push(batch);
    out.records.push(...body.records);
  }
  return out;
}

function readInner(inner: Bytes): { header: Header; batches: Batch[] } {
  const view = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  const fail = () => new BundleFailure('format');
  if (inner.length < 4) throw fail();
  const headLength = view.getUint16(0);
  if (2 + headLength + 2 > inner.length) throw fail();
  const header = parseHeader(inner.subarray(2, 2 + headLength));
  if (!header) throw fail();
  let at = 2 + headLength;
  const count = view.getUint16(at);
  const batches: Batch[] = [];
  at += 2;
  for (let i = 0; i < count; i++) {
    if (at + 8 + SIG + 4 > inner.length) throw fail();
    const author = toHex(inner.subarray(at, at + 8));
    const signature = inner.slice(at + 8, at + 8 + SIG);
    const length = view.getUint32(at + 8 + SIG);
    at += 8 + SIG + 4;
    if (at + length > inner.length) throw fail();
    batches.push({ author, signature, json: inner.slice(at, at + length) });
    at += length;
  }
  if (at !== inner.length) throw fail();
  return { header, batches };
}

function parseHeader(json: Bytes): Header | undefined {
  try {
    const h = JSON.parse(fromUtf8(json));
    const fine = typeof h?.from === 'string' && /^[0-9a-f]{16}$/.test(h.from) &&
      typeof h.have === 'object' && h.have !== null && Object.keys(h.have).length <= 256 &&
      Object.entries(h.have).every(([k, n]) => /^[0-9a-f]{16}$/.test(k) && Number.isSafeInteger(n) && (n as number) >= 0);
    return fine ? { from: h.from, have: h.have } : undefined;
  } catch {
    return undefined;
  }
}

function parse(json: Bytes): { trip: string; records: unknown[] } | undefined {
  try {
    const body = JSON.parse(fromUtf8(json));
    return body?.v === FORMAT && typeof body.trip === 'string' && Array.isArray(body.records) ? body : undefined;
  } catch {
    return undefined;
  }
}

function inflateCapped(data: Bytes, max: number): Bytes {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const inflate = new Inflate((chunk) => {
      size += chunk.length;
      if (size > max) throw new BundleFailure('too-large');
      chunks.push(chunk);
    });
    inflate.push(data, true);
  } catch (e) {
    throw e instanceof BundleFailure ? e : new BundleFailure('format');
  }
  return concat(...chunks);
}

const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
