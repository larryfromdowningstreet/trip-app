// Small byte helpers shared by the core.

export type Bytes = Uint8Array<ArrayBuffer>;

export const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes;
export const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export function concat(...parts: ArrayLike<number>[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): Bytes {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('hex: invalid');
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
export const fromBase64 = (text: string): Bytes => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const randomBytes = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

export const sha256 = async (data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data));

/** Short human code (Crockford base32, no I/L/O/U) from a hash, for comparing by eye. */
export function shortCode(hash: Uint8Array, length = 4): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of hash) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += alphabet[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === length) break;
  }
  return out;
}
