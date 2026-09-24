import { describe, expect, it } from 'vitest';
import { ChessClock } from './clock.js';

describe('ChessClock', () => {
  it('starts both players with the initial budget', () => {
    const clock = new ChessClock(10_000);
    expect(clock.remaining(1)).toBe(10_000);
    expect(clock.remaining(2)).toBe(10_000);
  });

  it('bills only the given player', () => {
    const clock = new ChessClock(10_000);
    clock.bill(1, 3_000);
    expect(clock.remaining(1)).toBe(7_000);
    expect(clock.remaining(2)).toBe(10_000);
  });

  it('floors remaining time at 0, never negative', () => {
    const clock = new ChessClock(1_000);
    clock.bill(1, 5_000);
    expect(clock.remaining(1)).toBe(0);
  });

  it('reports expired once remaining hits 0', () => {
    const clock = new ChessClock(1_000);
    expect(clock.expired(1)).toBe(false);
    clock.bill(1, 1_000);
    expect(clock.expired(1)).toBe(true);
  });
});
