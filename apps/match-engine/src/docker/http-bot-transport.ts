// BotTransport implementation that POSTs /move to a running container, per
// DESIGN.md's bot contract. Maps the wire outcomes onto the failure table:
// connection failure (crash/OOM-kill) -> 'crashed'; non-200/malformed JSON/
// schema-invalid body/oversized body -> 'invalid'; otherwise -> 'ok'.
//
// Hostile-bot hardening (hackathon stress bots): a bot that never responds,
// or that trickles headers/body forever, must not leave a dangling fetch
// running past the mover's clock budget. `game.clock_remaining_ms` on the
// outgoing request is exactly that budget (game-runner.ts computes it from
// the same ChessClock the JS-side race in resolveTurn() uses), so this
// transport arms its own AbortController off that same number. This is
// belt-and-suspenders with game-runner's Promise.race: that race already
// makes the *decision* (clock_expired forfeit) on time; this abort makes
// sure the underlying socket/request is actually torn down instead of
// leaking for the lifetime of the process. Whichever settles first "wins"
// from the caller's perspective — if our abort loses the race, its outcome
// is simply discarded by game-runner.
//
// Response bodies are capped at MAX_BODY_BYTES: a bot that streams
// megabytes of JSON (or trickles bytes to run out the clock while holding
// the connection open) is treated as an invalid move, not as something
// worth buffering in full.

import { MoveResponseSchema, type MoveRequest } from '@acm-uga/c4-contract';
import type { BotTransport, MoveOutcome } from '../types.js';
import type { ContainerHandle } from './container-runtime.js';

/** Hard cap on a /move response body; bots that exceed this are treated as an invalid move. */
const MAX_BODY_BYTES = 64 * 1024;

/** Fallback budget if a caller hands us a MoveRequest built outside game-runner's clock (defensive; the contract makes the field required). */
const DEFAULT_BUDGET_MS = 30_000;

class BodyTooLargeError extends Error {}

/** Reads a Response body up to `maxBytes`, aborting (via `signal`) rather than buffering further if it's exceeded. Also naturally bounds trickling bodies by the same abort deadline used for the whole request. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No body stream available (some runtimes) — fall back to a single read, still capped after the fact.
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new BodyTooLargeError();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export class HttpBotTransport implements BotTransport {
  constructor(private readonly container: ContainerHandle) {}

  async move(request: MoveRequest): Promise<MoveOutcome> {
    const budgetMs = Math.max(0, request.game?.clock_remaining_ms ?? DEFAULT_BUDGET_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    (timer as unknown as { unref?: () => void }).unref?.();

    let res: Response;
    try {
      res = await fetch(`${this.container.baseUrl}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Connection refused/reset, DNS failure, abort (never-responding/slow-headers bot
      // whose clock budget ran out), etc — treated uniformly as the container being
      // unavailable mid-request. game-runner's own clock race is what actually decides
      // clock_expired vs. crash-restart; this outcome is discarded when it loses that race.
      return { type: 'crashed', detail: err instanceof Error ? err.message : String(err) };
    }

    if (!res.ok) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => undefined);
      return { type: 'invalid', detail: `non-200 response: ${res.status}` };
    }

    let bodyText: string;
    try {
      bodyText = await readCapped(res, MAX_BODY_BYTES);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof BodyTooLargeError) {
        return { type: 'invalid', detail: `response body exceeded ${MAX_BODY_BYTES} bytes` };
      }
      // Aborted mid-body (trickling/never-finishing response) or a stream error.
      return { type: 'crashed', detail: err instanceof Error ? err.message : String(err) };
    }
    clearTimeout(timer);

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return { type: 'invalid', detail: 'response was not valid JSON' };
    }

    const parsed = MoveResponseSchema.safeParse(body);
    if (!parsed.success) {
      return { type: 'invalid', detail: `response did not match the /move schema: ${parsed.error.message}` };
    }

    return { type: 'ok', column: parsed.data.column };
  }

  restart(): Promise<number> {
    return this.container.restart();
  }
}
