// Four-character codes people compare by eye: same code, same data.

import { type PublicIdentity } from './crypto';
import { shortCode, sha256, utf8 } from './bytes';
import type { TripState } from './merge';

/** Same itinerary on two phones gives the same code. */
export async function syncCode(state: TripState): Promise<string> {
  const items = [...state.items.values()]
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .map((item) => [item.id, Object.keys(item.values).sort().map((f) => [f, item.values[f]])]);
  return shortCode(await sha256(utf8(JSON.stringify(items))));
}

/** Same list of trusted people on two phones gives the same code. */
export async function whitelistCode(members: PublicIdentity[]): Promise<string> {
  const list = [...members].sort((x, y) => (x.id < y.id ? -1 : 1)).map((m) => [m.id, m.name]);
  return shortCode(await sha256(utf8(JSON.stringify(list))));
}
