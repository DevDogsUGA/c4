// The bot-facing wire format, per DESIGN.md "The bot model". Mirrors
// @acm-uga/c4-contract's MoveRequest/MoveResponse shapes but is kept local
// (no dependency on `contract`) since this is the one package that actually
// sends these bytes over the wire to an arbitrary team's server and needs to
// tolerate a malformed reply rather than assume a well-typed one.

import type { Board, Player } from '@acm-uga/c4-engine';

export interface MoveRequestBody {
  you: Player;
  board: Board;
  moves: number[];
  game: {
    match_id: string;
    game_number: number;
    clock_remaining_ms: number;
  };
}

/** Why a bot call did not yield a usable column. */
export type BotFailureReason =
  | 'unreachable' // network error -- refused, DNS, or (most commonly at a hackathon) CORS
  | 'timeout' // no response within the allotted think time
  | 'http_error' // non-200 response
  | 'malformed_json' // body did not parse as JSON
  | 'invalid_response'; // parsed JSON but missing/invalid "column"

export type BotOutcome =
  | { ok: true; column: number }
  | { ok: false; reason: BotFailureReason; message: string };

export interface BotCallResult {
  outcome: BotOutcome;
  /** Wall-clock time from request-sent to response-fully-received (or failure). */
  think_ms: number;
  request: MoveRequestBody;
  /** The parsed response body, when the bot returned one (even if invalid). */
  responseBody?: unknown;
  status?: number;
}

export interface CallBotOptions {
  /** Milliseconds to wait before giving up. Defaults to 10000 (DESIGN.md's chess clock). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Joins a base URL and a path without producing a double slash. */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * POSTs a /move request to a bot per the DESIGN.md contract and normalizes
 * every way it can fail (network error, timeout, non-200, bad JSON, missing
 * column) into a typed BotOutcome. Never throws.
 */
export async function callBot(
  baseUrl: string,
  request: MoveRequestBody,
  options: CallBotOptions = {},
): Promise<BotCallResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const doFetch = options.fetchImpl ?? fetch;
  const url = joinUrl(baseUrl, '/move');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
  const startedAt = performance.now();

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const think_ms = elapsed(startedAt);

    if (!res.ok) {
      return {
        outcome: { ok: false, reason: 'http_error', message: `Bot responded ${res.status} ${res.statusText}`.trim() },
        think_ms,
        request,
        status: res.status,
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        outcome: { ok: false, reason: 'malformed_json', message: 'Response body was not valid JSON' },
        think_ms,
        request,
        status: res.status,
      };
    }

    const column = extractColumn(body);
    if (column === null) {
      return {
        outcome: { ok: false, reason: 'invalid_response', message: 'Response is missing an integer "column" field' },
        think_ms,
        request,
        responseBody: body,
        status: res.status,
      };
    }

    return { outcome: { ok: true, column }, think_ms, request, responseBody: body, status: res.status };
  } catch (err) {
    const think_ms = elapsed(startedAt);
    if (isAbortError(err)) {
      return {
        outcome: { ok: false, reason: 'timeout', message: `No response within ${timeoutMs}ms` },
        think_ms,
        request,
      };
    }
    return {
      outcome: { ok: false, reason: 'unreachable', message: describeUnreachable(err) },
      think_ms,
      request,
    };
  } finally {
    clearTimeout(timer);
  }
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function extractColumn(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('column' in body)) return null;
  const column = (body as { column: unknown }).column;
  return typeof column === 'number' && Number.isInteger(column) ? column : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * fetch() collapses network refusals, DNS failures, and CORS rejections into
 * the same opaque "TypeError: Failed to fetch" -- the browser deliberately
 * hides which one, so this can only ever be a best-effort hint (surfaced in
 * the UI alongside the raw message, never in place of it).
 */
function describeUnreachable(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return `${raw} (unreachable -- check the bot is running, or this may be a CORS/private-network block; see DESIGN.md's CORS/PNA requirements)`;
}
