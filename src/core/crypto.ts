// Identities and keys, using only the browser's built-in Web Crypto.
//
// Each person has two key pairs, both created on their own phone and never exported:
//   - signing (ECDSA P-256): proves who wrote a change
//   - encryption (ECDH P-256): lets others hand them the trip key
// The trip key (AES-GCM 256) encrypts everything that leaves a phone.

import { type Bytes, concat, randomBytes, sha256, toHex } from './bytes';

const SIGN_CURVE = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DH_CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const PUBLIC_KEY_BYTES = 65;
const WRAP_INFO = new TextEncoder().encode('trip-key-wrap v1');

export type KeyId = string; // 16 hex characters

export interface PublicIdentity {
  id: KeyId;
  name: string;
  signKey: Bytes; // raw P-256 public key, 65 bytes
  encKey: Bytes;
}

export interface Identity extends PublicIdentity {
  signPrivate: CryptoKey; // non-extractable
  encPrivate: CryptoKey; // non-extractable
}

export async function createIdentity(name: string): Promise<Identity> {
  const sign = await crypto.subtle.generateKey(SIGN_CURVE, false, ['sign', 'verify']);
  const enc = await crypto.subtle.generateKey(DH_CURVE, false, ['deriveBits']);
  const signKey = new Uint8Array(await crypto.subtle.exportKey('raw', sign.publicKey));
  const encKey = new Uint8Array(await crypto.subtle.exportKey('raw', enc.publicKey));
  return { id: await keyIdOf(signKey), name, signKey, encKey, signPrivate: sign.privateKey, encPrivate: enc.privateKey };
}

/** A person's id: the first 8 bytes of the SHA-256 of their signing key. */
export const keyIdOf = async (signKey: Bytes): Promise<KeyId> => toHex((await sha256(signKey)).slice(0, 8));

export const publicPart = ({ id, name, signKey, encKey }: PublicIdentity): PublicIdentity => ({ id, name, signKey, encKey });

export const sign = async (identity: Identity, data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.sign(SIGN_ALGO, identity.signPrivate, data));

export async function verify(signKey: Bytes, signature: Bytes, data: Bytes): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', signKey, SIGN_CURVE, false, ['verify']);
  return crypto.subtle.verify(SIGN_ALGO, key, signature, data);
}

// ---- trip key ------------------------------------------------------------

export const newTripKey = (): Bytes => randomBytes(32);

export const importTripKey = (raw: Bytes) =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/**
 * Encrypts the trip key for one person, so no QR Code ever carries it in the clear.
 * Layout: [ephemeral public key 65][iv 12][AES-GCM ciphertext 48]
 */
export async function wrapTripKey(tripKey: Bytes, recipientEncKey: Bytes): Promise<Bytes> {
  const ephemeral = await crypto.subtle.generateKey(DH_CURVE, true, ['deriveBits']);
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const recipient = await crypto.subtle.importKey('raw', recipientEncKey, DH_CURVE, false, []);
  const kek = await wrappingKey(ephemeral.privateKey, recipient, ephemeralPublic);
  const iv = randomBytes(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, tripKey));
  return concat(ephemeralPublic, iv, sealed);
}

export async function unwrapTripKey(wrapped: Bytes, me: Identity): Promise<Bytes> {
  const ephemeralPublic = wrapped.slice(0, PUBLIC_KEY_BYTES);
  const iv = wrapped.slice(PUBLIC_KEY_BYTES, PUBLIC_KEY_BYTES + 12);
  const sender = await crypto.subtle.importKey('raw', ephemeralPublic, DH_CURVE, false, []);
  const kek = await wrappingKey(me.encPrivate, sender, ephemeralPublic);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, wrapped.slice(PUBLIC_KEY_BYTES + 12)));
}

async function wrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, salt: Bytes): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: WRAP_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
