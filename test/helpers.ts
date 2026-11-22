// A small simulated phone for tests: one person, their log, and the trust list they keep.

import { type Identity, type KeyId, createIdentity } from '../src/core/crypto';
import { ChangeLog } from '../src/core/log';
import { type TripState, merge } from '../src/core/merge';
import { type ChangeRecord, type Stamp, type Trust, accepts } from '../src/core/model';

export class Phone {
  log = new ChangeLog();
  trust = new Map<KeyId, Trust>();
  clock = 1_700_000_000_000;

  private constructor(readonly me: Identity) {}

  static async make(name: string) {
    return new Phone(await createIdentity(name));
  }

  stamp(): Stamp {
    return { a: this.me.id, s: this.log.nextSeq(this.me.id), t: (this.clock += 1000) };
  }

  /** Builds one record from the current state and keeps it. */
  write(build: (state: TripState, stamp: Stamp) => ChangeRecord): ChangeRecord {
    const r = build(this.state(), this.stamp());
    this.log.add([r]);
    return r;
  }

  state(): TripState {
    return merge(this.log.all().filter((r) => accepts(this.trust.get(r.a), r)));
  }
}

export async function group(...names: string[]): Promise<Phone[]> {
  const phones = await Promise.all(names.map(Phone.make));
  for (const p of phones) for (const q of phones) p.trust.set(q.me.id, { access: 'edit' });
  return phones;
}

/** Deterministic shuffle so a failing order can be reproduced. */
export function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const plain = (state: TripState) =>
  Object.fromEntries([...state.items].sort(([x], [y]) => (x < y ? -1 : 1)).map(([id, item]) => [id, item.values]));
