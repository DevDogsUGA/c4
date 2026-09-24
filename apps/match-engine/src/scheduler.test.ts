import { describe, expect, it } from 'vitest';
import { matchConcurrency, runWithConcurrency } from './scheduler.js';

describe('runWithConcurrency', () => {
  it('runs all jobs and preserves result order regardless of completion order', async () => {
    const jobs = [3, 1, 2].map((ms, i) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    const results = await runWithConcurrency(jobs, 3);
    expect(results).toEqual([0, 1, 2]);
  });

  it('never runs more than `concurrency` jobs at once', async () => {
    let active = 0;
    let maxActive = 0;
    const jobs = Array.from({ length: 10 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await runWithConcurrency(jobs, 3);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1); // sanity: concurrency actually kicked in
  });

  it('rejects if any job rejects, after all jobs settle', async () => {
    const jobs = [
      async () => 1,
      async () => {
        throw new Error('boom');
      },
      async () => 3,
    ];
    await expect(runWithConcurrency(jobs, 2)).rejects.toThrow('boom');
  });

  it('handles an empty job list', async () => {
    expect(await runWithConcurrency([], 4)).toEqual([]);
  });

  it('rejects a concurrency below 1', async () => {
    await expect(runWithConcurrency([], 0)).rejects.toThrow(RangeError);
  });
});

describe('matchConcurrency', () => {
  it('uses 2 cores per match with 2 reserved for the engine/Docker, and no cap on parallel matches', () => {
    expect(matchConcurrency(8)).toBe(3); // (8-2)/2 = 3
    expect(matchConcurrency(64)).toBe(31); // (64-2)/2 = 31, no 4-match cap
    expect(matchConcurrency(4)).toBe(1); // (4-2)/2 = 1
    expect(matchConcurrency(2)).toBe(1); // never 0 even with nothing left over
    expect(matchConcurrency(1)).toBe(1); // never 0
  });

  it('honors a custom reserved-cores count', () => {
    expect(matchConcurrency(10, 4)).toBe(3); // (10-4)/2 = 3
    expect(matchConcurrency(10, 0)).toBe(5);
  });
});
