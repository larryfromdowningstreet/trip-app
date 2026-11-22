// Deciding what to put in a bundle, so it stays small enough to scan quickly.
//
// Each phone remembers what it had at its last confirmed sync. A sender includes everything newer than that.
// A collector also learns what each sender already has (the bundle header), and shares everything that the
// one who has least is missing.

import { type Batch, signBatch } from './bundle';
import { fromUtf8 } from './bytes';
import type { Identity, KeyId } from './crypto';
import type { ChangeLog, Vector } from './log';
import type { ChangeRecord } from './model';

/** For each author, the lowest number anyone has: everything above it goes out. */
export function lowest(vectors: Vector[]): Vector {
  const authors = new Set(vectors.flatMap((v) => Object.keys(v)));
  const out: Vector = {};
  for (const a of authors) out[a] = Math.min(...vectors.map((v) => v[a] ?? 0));
  return out;
}

/** How many records `theirs` has that `mine` does not, counting by author and number. */
export function missing(mine: Vector, theirs: Vector): number {
  return Object.entries(theirs).reduce((n, [a, s]) => n + Math.max(0, s - (mine[a] ?? 0)), 0);
}

export const batchRecords = (batch: Batch): ChangeRecord[] => JSON.parse(fromUtf8(batch.json)).records;

/** Stored batches from others worth passing on: they hold something newer than `need` that this phone accepts. */
export function relayable(batches: Batch[], need: Vector, accepted: (r: ChangeRecord) => boolean): Batch[] {
  return batches.filter((b) => batchRecords(b).some((r) => r.s > (need[r.a] ?? 0) && accepted(r)));
}

/** This phone's own records above `need`, freshly signed, followed by others' batches to pass on. */
export async function outgoing(
  trip: string,
  me: Identity,
  log: ChangeLog,
  stored: Batch[],
  need: Vector,
  accepted: (r: ChangeRecord) => boolean,
): Promise<Batch[]> {
  const mine = log.all().filter((r) => r.a === me.id && r.s > (need[me.id] ?? 0)).sort((x, y) => x.s - y.s);
  const others = relayable(stored.filter((b) => b.author !== me.id), need, accepted);
  return mine.length ? [await signBatch(trip, mine, me), ...others] : others;
}

/** Keeps each received batch once (same signature, same batch), never this phone's own. */
export function keep(stored: Batch[], incoming: Batch[], me: KeyId): Batch[] {
  const seen = new Set(stored.map((b) => sigKey(b)));
  const added = incoming.filter((b) => b.author !== me && !seen.has(sigKey(b)) && seen.add(sigKey(b)));
  return [...stored, ...added];
}

const sigKey = (b: Batch) => `${b.author}:${[...b.signature.subarray(0, 16)].join(',')}`;
