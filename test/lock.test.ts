import { describe, expect, it } from 'vitest';
import { checkPin, waitAfter } from '../src/core/pin';
import { MemoryKV, Vault } from '../src/core/vault';

describe('PIN rules', () => {
  it('needs 4 digits that are not an easy guess', () => {
    expect(checkPin('123')).toBe('format');
    expect(checkPin('12a4')).toBe('format');
    for (const weak of ['0000', '7777', '1234', '4321', '6789', '1212', '2580']) expect(checkPin(weak)).toBe('weak');
    for (const ok of ['3719', '5082', '9146']) expect(checkPin(ok)).toBeUndefined();
  });

  it('waits longer as wrong guesses add up', () => {
    expect([1, 4, 5, 7, 8, 9].map(waitAfter)).toEqual([0, 0, 60_000, 60_000, 600_000, 600_000]);
  });
});

describe('vault', () => {
  const PIN = '3719';

  it('stores data encrypted and opens it with the PIN', async () => {
    const kv = new MemoryKV();
    const v = await Vault.create(kv, PIN);
    await v.put('trip', { title: '東京 5 日', key: new Uint8Array([1, 2, 255]) });
    expect(JSON.stringify([...(kv as unknown as { map: Map<string, unknown> }).map.values()])).not.toContain('東京');

    const again = await Vault.unlock(kv, PIN);
    expect(again.ok && (await again.vault.read('trip'))).toEqual({ title: '東京 5 日', key: new Uint8Array([1, 2, 255]) });
    expect(again.ok && (await again.vault.read('missing'))).toBeUndefined();
  });

  it('can change the PIN', async () => {
    const kv = new MemoryKV();
    const v = await Vault.create(kv, PIN);
    await v.put('x', 1);
    await v.changePin('5082');
    expect((await Vault.unlock(kv, PIN)).ok).toBe(false);
    const u = await Vault.unlock(kv, '5082', Date.now() + 1);
    expect(u.ok && (await u.vault.read('x'))).toBe(1);
  });

  it('makes you wait after 5 wrong guesses and wipes after 10', async () => {
    const kv = new MemoryKV();
    await (await Vault.create(kv, PIN)).put('x', 1);
    let now = 0;
    const guess = async (pin: string) => {
      const r = await Vault.unlock(kv, pin, now);
      if (!r.ok) now += r.wait; // wait it out
      return r;
    };

    for (let i = 1; i <= 4; i++) expect(await guess('0001')).toEqual({ ok: false, fails: i, wait: 0, wiped: false });
    expect(await guess('0001')).toEqual({ ok: false, fails: 5, wait: 60_000, wiped: false });
    expect(await Vault.unlock(kv, PIN, now - 1)).toEqual({ ok: false, fails: 5, wait: 1, wiped: false }); // even the right PIN waits

    const right = await guess(PIN);
    expect(right.ok).toBe(true); // a right guess resets the count

    for (let i = 1; i <= 9; i++) await guess('0001');
    expect(await Vault.exists(kv)).toBe(true);
    expect(await guess('0001')).toEqual({ ok: false, fails: 10, wait: 0, wiped: true });
    expect(await Vault.exists(kv)).toBe(false);
    expect(await kv.get('v:x')).toBeUndefined();
  }, 30_000);

  it('refuses a weak PIN', async () => {
    await expect(Vault.create(new MemoryKV(), '1234')).rejects.toThrow();
  });
});
