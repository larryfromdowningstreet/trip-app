// Everything about a trip is stored encrypted. The PIN unlocks it.
//
// A random data key encrypts the data; the PIN (stretched with PBKDF2) encrypts the data key.
// A wrong PIN simply fails to decrypt the data key, so the PIN itself is never stored.
// The guess counter sits outside the encryption, and the 10th wrong guess clears everything.

import { type Bytes, fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './bytes';
import { type Attempts, NO_FAILS, afterFail, checkPin, waitLeft } from './pin';

/** Where bytes are kept: IndexedDB in the app, a Map in tests. Values must be structured-cloneable. */
export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryKV implements KV {
  private map = new Map<string, unknown>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, value: unknown) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
  async clear() {
    this.map.clear();
  }
}

const META = 'vault';
const ATTEMPTS = 'attempts';
const ITERATIONS = 310_000;

interface Meta {
  v: 1;
  salt: Bytes;
  iterations: number;
  iv: Bytes;
  wrapped: Bytes;
}

export type Unlock = { ok: true; vault: Vault } | { ok: false; fails: number; wait: number; wiped: boolean };

export class Vault {
  private constructor(
    private readonly kv: KV,
    private readonly key: CryptoKey,
    private readonly raw: Bytes,
  ) {}

  static async exists(kv: KV): Promise<boolean> {
    return (await kv.get(META)) !== undefined;
  }

  /** Wrong guesses so far, for the lock screen. */
  static async attempts(kv: KV): Promise<Attempts> {
    return ((await kv.get(ATTEMPTS)) as Attempts | undefined) ?? NO_FAILS;
  }

  static async create(kv: KV, pin: string): Promise<Vault> {
    if (checkPin(pin)) throw new Error('PIN not allowed');
    const raw = randomBytes(32);
    await writeMeta(kv, pin, raw);
    await kv.set(ATTEMPTS, NO_FAILS);
    return new Vault(kv, await dataKey(raw), raw);
  }

  static async unlock(kv: KV, pin: string, now = Date.now()): Promise<Unlock> {
    const attempts = await Vault.attempts(kv);
    const wait = waitLeft(attempts, now);
    if (wait > 0) return { ok: false, fails: attempts.fails, wait, wiped: false };

    const meta = (await kv.get(META)) as Meta | undefined;
    if (!meta) throw new Error('no vault on this device');
    let raw: Bytes;
    try {
      const kek = await pinKey(pin, meta.salt, meta.iterations);
      raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: meta.iv }, kek, meta.wrapped));
    } catch {
      const next = afterFail(attempts, now);
      if (next.wipe) {
        await kv.clear();
        return { ok: false, fails: next.fails, wait: 0, wiped: true };
      }
      await kv.set(ATTEMPTS, { fails: next.fails, until: next.until });
      return { ok: false, fails: next.fails, wait: waitLeft(next, now), wiped: false };
    }
    await kv.set(ATTEMPTS, NO_FAILS);
    return { ok: true, vault: new Vault(kv, await dataKey(raw), raw) };
  }

  /** Stores any JSON value; Uint8Array values inside it are kept as bytes. */
  async put(name: string, value: unknown): Promise<void> {
    const iv = randomBytes(12);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, utf8(JSON.stringify(value, packBytes))));
    await this.kv.set(`v:${name}`, { iv, sealed });
  }

  async read<T>(name: string): Promise<T | undefined> {
    const box = (await this.kv.get(`v:${name}`)) as { iv: Bytes; sealed: Bytes } | undefined;
    if (!box) return undefined;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, this.key, box.sealed);
    return JSON.parse(fromUtf8(new Uint8Array(plain)), unpackBytes) as T;
  }

  async remove(name: string): Promise<void> {
    await this.kv.delete(`v:${name}`);
  }

  async changePin(newPin: string): Promise<void> {
    if (checkPin(newPin)) throw new Error('PIN not allowed');
    await writeMeta(this.kv, newPin, this.raw);
  }
}

async function writeMeta(kv: KV, pin: string, raw: Bytes) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await pinKey(pin, salt, ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw));
  await kv.set(META, { v: 1, salt, iterations: ITERATIONS, iv, wrapped } satisfies Meta);
}

async function pinKey(pin: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const packBytes = (_: string, v: unknown) => (v instanceof Uint8Array ? { $bytes: toBase64(v) } : v);
const unpackBytes = (_: string, v: unknown) =>
  v && typeof v === 'object' && typeof (v as { $bytes?: unknown }).$bytes === 'string' ? fromBase64((v as { $bytes: string }).$bytes) : v;

const dataKey = (raw: Bytes) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
