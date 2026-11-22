// Backup files: a standard AES-256 encrypted zip (the WinZip AES format), which 7-Zip, WinRAR, Keka and
// most phone file managers open with the password. Inside:
//   行程.txt    the itinerary as plain text
//   trip.json   the same in the archive format, for importing back into the app
//   票券/…      ticket screenshots, if chosen
// The password must be at least 8 characters: unlike the PIN, a file can be guessed at without limits.

import { type Archived, itineraryText, readArchive } from './archive';
import { utf8 } from './bytes';

export const MIN_PASSWORD = 8;
const MAX_BACKUP = 200 << 20;

export class BackupFailure extends Error {
  constructor(readonly code: 'password' | 'format' | 'too-large') {
    super(code);
  }
}

export interface TicketFile {
  name: string; // shown in the file list, e.g. "3-11 13:30 清水寺"
  type: string;
  bytes: Uint8Array;
}

const zipjs = async () => {
  const zip = await import('@zip.js/zip.js'); // only needed when backing up, so loaded then
  zip.configure({ useWebWorkers: false }); // workers would need blob: scripts, which the CSP forbids
  return zip;
};

const extension = (type: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic' })[type] ?? 'img';
const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

export async function makeBackup(trip: Archived, password: string, tickets: TicketFile[] = []): Promise<Uint8Array> {
  if (password.length < MIN_PASSWORD) throw new BackupFailure('password');
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await zipjs();
  const writer = new ZipWriter(new Uint8ArrayWriter(), { password, encryptionStrength: 3, zipCrypto: false });
  await writer.add('行程.txt', new Uint8ArrayReader(utf8(itineraryText(trip))));
  await writer.add('trip.json', new Uint8ArrayReader(utf8(JSON.stringify(trip, null, 1))));
  for (const t of tickets) await writer.add(`票券/${safe(t.name)}.${extension(t.type)}`, new Uint8ArrayReader(t.bytes), { level: 0 });
  return writer.close();
}

/** Opens a backup made by this app and gives back its trip. */
export async function openBackup(bytes: Uint8Array, password: string): Promise<Archived> {
  if (bytes.length > MAX_BACKUP) throw new BackupFailure('too-large');
  const { ZipReader, Uint8ArrayReader, TextWriter } = await zipjs();
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { password });
  try {
    const entries = await reader.getEntries().catch(() => Promise.reject(new BackupFailure('format')));
    const json = entries.find((e) => e.filename === 'trip.json');
    if (!json || json.directory || json.uncompressedSize > 20 << 20) throw new BackupFailure('format');
    const text = await json.getData(new TextWriter()).catch((e: Error) =>
      Promise.reject(new BackupFailure(/password/i.test(e.message) ? 'password' : 'format')));
    const trip = readArchive(text);
    if (!trip) throw new BackupFailure('format');
    return trip;
  } finally {
    await reader.close();
  }
}
