// Every change record this phone has accepted, by author and number.

import type { KeyId } from './crypto';
import type { ChangeRecord, RecordRef } from './model';

export type Vector = Record<KeyId, number>;

export class ChangeLog {
  private byAuthor = new Map<KeyId, Map<number, ChangeRecord>>();

  constructor(records: Iterable<ChangeRecord> = []) {
    this.add(records);
  }

  /** Adds records it has not seen; returns how many were new. */
  add(records: Iterable<ChangeRecord>): number {
    let added = 0;
    for (const r of records) {
      const mine = this.byAuthor.get(r.a) ?? new Map<number, ChangeRecord>();
      if (mine.has(r.s)) continue;
      mine.set(r.s, r);
      this.byAuthor.set(r.a, mine);
      added++;
    }
    return added;
  }

  has(ref: RecordRef): boolean {
    return this.byAuthor.get(ref.a)?.has(ref.s) ?? false;
  }

  all(): ChangeRecord[] {
    return [...this.byAuthor.values()].flatMap((m) => [...m.values()]);
  }

  get size(): number {
    return [...this.byAuthor.values()].reduce((n, m) => n + m.size, 0);
  }

  nextSeq(author: KeyId): number {
    return Math.max(0, ...(this.byAuthor.get(author)?.keys() ?? [])) + 1;
  }

  /** For each author, the highest number with nothing missing before it. */
  vector(): Vector {
    const out: Vector = {};
    for (const [author, mine] of this.byAuthor) {
      let s = 0;
      while (mine.has(s + 1)) s++;
      out[author] = s;
    }
    return out;
  }

  /** Records the other side may lack, given the vector from the last time everyone matched. */
  since(vector: Vector): ChangeRecord[] {
    return this.all().filter((r) => r.s > (vector[r.a] ?? 0));
  }

  /** Numbers that are missing: we have a later record from that person but not this one. */
  gaps(): { author: KeyId; missing: number[] }[] {
    const out: { author: KeyId; missing: number[] }[] = [];
    for (const [author, mine] of this.byAuthor) {
      const top = Math.max(...mine.keys());
      const missing = [];
      for (let s = 1; s < top; s++) if (!mine.has(s)) missing.push(s);
      if (missing.length > 0) out.push({ author, missing });
    }
    return out;
  }
}
