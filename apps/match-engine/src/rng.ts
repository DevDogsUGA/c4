// Seedable RNG. DESIGN.md requires coin flips (game 1 / sudden-death first
// mover, standings tiebreak) to be deterministic given a seed, so tests can
// assert exact outcomes without flakiness. mulberry32 is a small, fast,
// well-distributed PRNG — good enough for coin flips and shuffles, not for
// cryptography (never used for anything security-sensitive here).

export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
}

export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A coin flip between bracket slot 0 and slot 1 (or player 1 vs 2). */
export function coinFlipSlot(rng: Rng): 0 | 1 {
  return rng.next() < 0.5 ? 0 : 1;
}

/** Fisher-Yates shuffle using the given RNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
