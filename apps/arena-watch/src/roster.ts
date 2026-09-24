import { log } from './log.js';
import type { Roster } from './types.js';

export interface FetchFn {
  (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface RosterSourceOptions {
  workerUrl: string;
  rosterToken: string;
  backupRosterUrl?: string | undefined;
  timeoutMs: number;
  fetchFn?: FetchFn;
}

function isRoster(x: unknown): x is Roster {
  if (typeof x !== 'object' || x === null) return false;
  const teams = (x as { teams?: unknown }).teams;
  return Array.isArray(teams);
}

async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`roster fetch ${url} -> HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the roster from the registry Worker, falling back to the Apps Script
 * backup URL on any failure (network error, non-2xx, malformed body).
 * Throws only if both sources fail (or the backup is not configured).
 */
export async function fetchRoster(opts: RosterSourceOptions): Promise<{ roster: Roster; source: 'worker' | 'backup' }> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const primaryUrl = `${opts.workerUrl.replace(/\/$/, '')}/api/roster`;

  try {
    const body = await fetchJson(fetchFn, primaryUrl, opts.rosterToken, opts.timeoutMs);
    if (!isRoster(body)) throw new Error('roster response missing teams[]');
    return { roster: body, source: 'worker' };
  } catch (err) {
    log.warn('roster fetch from worker failed, trying backup', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!opts.backupRosterUrl) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    const sep = opts.backupRosterUrl.includes('?') ? '&' : '?';
    const backupUrl = `${opts.backupRosterUrl}${sep}token=${encodeURIComponent(opts.rosterToken)}`;
    const body = await fetchJson(fetchFn, backupUrl, opts.rosterToken, opts.timeoutMs);
    if (!isRoster(body)) throw new Error('backup roster response missing teams[]');
    return { roster: body, source: 'backup' };
  }
}
