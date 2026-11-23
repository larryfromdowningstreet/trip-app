/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archive, itineraryText, readArchive } from '../src/core/archive';
import { BackupFailure, makeBackup, openBackup } from '../src/core/backup';
import { addItem, merge, setField } from '../src/core/merge';

const A = 'aaaaaaaaaaaaaaaa';
const r1 = addItem({ a: A, s: 1, t: 1 }, { date: '2027-03-11', start: '13:30', title: '清水寺', addressLocal: '京都府京都市東山区清水1丁目294', lat: 34.99, lng: 135.78 }, 'I1');
const r2 = addItem({ a: A, s: 2, t: 2 }, { date: '2027-03-10', start: '09:00', title: '關西機場', note: '' }, 'I2');
const state = merge([r1, r2, setField(merge([r1, r2]), { a: A, s: 3, t: 3 }, 'I2', 'note', null)]);
const trip = archive({ id: 'T1', name: '京都五日遊', start: '2027-03-10', end: '2027-03-14', people: ['小明', '小華'] }, state, undefined, 1_700_000_000_000);

describe('archive', () => {
  it('keeps only the final itinerary, in order, without empty fields', () => {
    expect(trip.items.map((i) => i.title)).toEqual(['關西機場', '清水寺']);
    expect(trip.items[0]).toEqual({ date: '2027-03-10', start: '09:00', title: '關西機場' });
    expect(readArchive(JSON.stringify(trip))).toEqual(trip);
    expect(readArchive('{"v":1}')).toBeUndefined();
    expect(itineraryText(trip)).toContain('13:30  清水寺\n    地址：京都府京都市東山区清水1丁目294');
  });
});

describe('backup file', () => {
  const ticket = { name: '3-11 13:30 清水寺', type: 'image/png', bytes: new Uint8Array(5000).map((_, i) => i % 251) };

  it('round-trips with the password and refuses a wrong one', async () => {
    const file = await makeBackup(trip, 'correct horse', [ticket]);
    expect(await openBackup(file, 'correct horse')).toEqual(trip);
    await expect(openBackup(file, 'wrong password')).rejects.toEqual(new BackupFailure('password'));
    await expect(openBackup(file.slice(0, 100), 'correct horse')).rejects.toEqual(new BackupFailure('format'));
  });

  it('needs at least 8 characters', async () => {
    await expect(makeBackup(trip, '1234567')).rejects.toEqual(new BackupFailure('password'));
  });

  it('hides everything without the password, even file contents in plain sight', async () => {
    const file = await makeBackup(trip, 'correct horse', [ticket]);
    const text = new TextDecoder().decode(file);
    expect(text).not.toContain('清水寺"'); // contents encrypted (names of files are visible, as in any zip)
    expect(text).not.toContain('東山区');
  });

  const sevenZip = ['7z', '7za', '7zz'].find((b) => { try { execFileSync(b, ['i'], { stdio: 'ignore' }); return true; } catch { return false; } });
  it.runIf(sevenZip)('opens with 7-Zip, a standard tool', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-'));
    writeFileSync(join(dir, 'b.zip'), await makeBackup(trip, 'correct horse', [ticket]));
    execFileSync(sevenZip!, ['x', '-pcorrect horse', `-o${join(dir, 'out')}`, join(dir, 'b.zip')], { stdio: 'ignore' });
    expect(readFileSync(join(dir, 'out', '行程.txt'), 'utf8')).toBe(itineraryText(trip));
    expect(existsSync(join(dir, 'out', '票券', '3-11 13_30 清水寺.png'))).toBe(true);
  });
});
