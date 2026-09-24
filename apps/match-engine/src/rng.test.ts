import { describe, expect, it } from 'vitest';
import { coinFlipSlot, createSeededRng, shuffle } from './rng.js';

describe('createSeededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('always returns values in [0, 1)', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('coinFlipSlot', () => {
  it('is deterministic and only returns 0 or 1', () => {
    const rng = createSeededRng(123);
    const results = Array.from({ length: 20 }, () => coinFlipSlot(rng));
    for (const r of results) expect([0, 1]).toContain(r);

    const rngAgain = createSeededRng(123);
    const resultsAgain = Array.from({ length: 20 }, () => coinFlipSlot(rngAgain));
    expect(results).toEqual(resultsAgain);
  });

  it('produces both outcomes over many flips (not degenerate)', () => {
    const rng = createSeededRng(9);
    const results = Array.from({ length: 200 }, () => coinFlipSlot(rng));
    expect(results).toContain(0);
    expect(results).toContain(1);
  });
});

describe('shuffle', () => {
  it('is deterministic for a given seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(items, createSeededRng(5));
    const b = shuffle(items, createSeededRng(5));
    expect(a).toEqual(b);
  });

  it('is a permutation of the input (same elements)', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const shuffled = shuffle(items, createSeededRng(11));
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3];
    const copy = [...items];
    shuffle(items, createSeededRng(1));
    expect(items).toEqual(copy);
  });
});
