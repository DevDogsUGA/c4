import { describe, expect, it, vi } from 'vitest';
import { emptyBoard } from '@acm-uga/c4-engine';
import { createBotPlayer } from './bot-player.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createBotPlayer', () => {
  it('returns the bot-chosen column on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ column: 4 }));
    const player = createBotPlayer({ baseUrl: 'http://localhost:8000', fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await player(emptyBoard(), 1, []);
    expect(outcome).toMatchObject({ ok: true, column: 4 });
  });

  it('decrements the clock across moves and forfeits once it runs out', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const fetchImpl = vi.fn(async () => {
      now += 6_000; // each call costs 6s of "think time"
      return jsonResponse({ column: 0 });
    });

    const player = createBotPlayer({
      baseUrl: 'http://localhost:8000',
      clockMs: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await player(emptyBoard(), 1, []);
    expect(first).toMatchObject({ ok: true });

    // Clock started at 10000, first call billed 6000ms -> 4000ms remaining,
    // well under the second call's 6000ms cost -> the second call itself
    // should still run (timeoutMs caps at remaining, not the call's actual
    // cost) but the resulting remaining balance goes to 0, forfeiting.
    const second = await player(emptyBoard(), 1, [0]);
    expect(second).toMatchObject({ ok: false, reason: 'timeout' });

    vi.restoreAllMocks();
  });

  it('reports onExchange for every call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ column: 2 }));
    const exchanges: unknown[] = [];
    const player = createBotPlayer({
      baseUrl: 'http://localhost:8000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onExchange: (exchange) => exchanges.push(exchange),
    });
    await player(emptyBoard(), 2, [1, 2]);
    expect(exchanges).toHaveLength(1);
  });

  it('forfeits immediately once the clock has already expired', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchImpl = vi.fn(async () => {
      now += 20_000;
      return jsonResponse({ column: 0 });
    });
    const player = createBotPlayer({ baseUrl: 'http://localhost:8000', clockMs: 10_000, fetchImpl: fetchImpl as unknown as typeof fetch });

    await player(emptyBoard(), 1, []); // burns the whole clock
    const outcome = await player(emptyBoard(), 1, [0]);
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout' });
    // Second call should not have hit the network -- clock was already spent.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });
});
