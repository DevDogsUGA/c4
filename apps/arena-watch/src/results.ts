import { log } from './log.js';
import type { FetchFn } from './roster.js';
import type { ResultPayload } from './types.js';

export interface PostResultOptions {
  workerUrl: string;
  resultsToken: string;
  fetchFn?: FetchFn;
}

export async function postResult(payload: ResultPayload, opts: PostResultOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const url = `${opts.workerUrl.replace(/\/$/, '')}/api/results`;
  try {
    const res = await (fetchFn as unknown as (
      input: string,
      init: { method: string; headers: Record<string, string>; body: string },
    ) => Promise<{ ok: boolean; status: number }>)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.resultsToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.error('postResult non-2xx', { status: res.status, repo_url: payload.repo_url });
    }
  } catch (err) {
    log.error('postResult failed', {
      error: err instanceof Error ? err.message : String(err),
      repo_url: payload.repo_url,
    });
  }
}
