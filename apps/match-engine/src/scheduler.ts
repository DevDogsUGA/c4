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
 * Sizes match concurrency to the host, per EVENT_PLAN.md: 2 vCPUs per match,
 * with 2 cores reserved for the engine/Docker daemon (min 1 reserved), and
 * no cap on the number of parallel matches — the arena is a dedicated
 * 64-core box for the event, so the old DESIGN.md-era 4-match cap (sized
 * for a laptop) is removed; this now scales to ~31 parallel matches on a
 * 64-core host. `availableCpus` defaults to the process's core count.
 */
export function matchConcurrency(availableCpus: number, reservedCpus = 2): number {
  const CORES_PER_MATCH = 2;
  const usable = Math.max(0, availableCpus - Math.max(0, reservedCpus));
  return Math.max(1, Math.floor(usable / CORES_PER_MATCH));
}
