// PIN rules and the wrong-guess limit.

export type PinProblem = 'format' | 'weak';

const COMMON = new Set(['2580', '1122', '1004', '2000']);

/** 4 digits, and not one of the easy guesses (0000, 1234, 4321, 1212, 2580...). */
export function checkPin(pin: string): PinProblem | undefined {
  if (!/^\d{4}$/.test(pin)) return 'format';
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  const run = steps.every((s) => s === 1) || steps.every((s) => s === -1) || steps.every((s) => s === 0);
  const repeated = pin.slice(0, 2) === pin.slice(2);
  return run || repeated || COMMON.has(pin) ? 'weak' : undefined;
}

export interface Attempts {
  fails: number;
  until: number; // no guesses before this time
}

export const NO_FAILS: Attempts = { fails: 0, until: 0 };
export const WIPE_AT = 10;

/** After the 5th wrong guess wait a minute, after the 8th ten minutes; the 10th wipes the phone's data. */
export const waitAfter = (fails: number) => (fails >= 8 ? 10 * 60_000 : fails >= 5 ? 60_000 : 0);

export function afterFail(a: Attempts, now: number): Attempts & { wipe: boolean } {
  const fails = a.fails + 1;
  return { fails, until: now + waitAfter(fails), wipe: fails >= WIPE_AT };
}

export const waitLeft = (a: Attempts, now: number) => Math.max(0, a.until - now);
