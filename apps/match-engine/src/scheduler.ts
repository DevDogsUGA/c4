// A tiny bounded-concurrency job pool. DESIGN.md: "Up to 4 matches in
// parallel (needs 2 cores per match; arena auto-sizes to the host)." This
// module is generic (not match-shaped) so it's easy to unit-test the
// concurrency bound in isolation with fake, controllable jobs.

/**
 * Runs `jobs` with at most `concurrency` running at once, preserving the
 * result order to match input order. A single job rejecting does not cancel
 * the others; the returned promise rejects once all settle, with the first
 * error encountered (subsequent errors are ignored, matching Promise.all's
 * "first rejection wins" ergonomics closely enough for this use).
 */
export async function runWithConcurrency<T>(
  jobs: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (concurrency < 1) {
    throw new RangeError(`concurrency must be >= 1, got ${concurrency}`);
  }

  const results: T[] = new Array(jobs.length);
  let nextIndex = 0;
  let firstError: unknown;
  let hasError = false;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= jobs.length) return;
      try {
        results[index] = await jobs[index]();
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, jobs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (hasError) throw firstError;
  return results;
}

/**
 * Sizes match concurrency to the host, per DESIGN.md: 2 cores per match, up
 * to 4 matches in parallel. `availableCpus` defaults to the process's core
 * count.
 */
export function matchConcurrency(availableCpus: number, maxParallelMatches = 4): number {
  const CORES_PER_MATCH = 2;
  const byCpus = Math.max(1, Math.floor(availableCpus / CORES_PER_MATCH));
  return Math.max(1, Math.min(maxParallelMatches, byCpus));
}
