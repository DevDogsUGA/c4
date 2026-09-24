import { describe, expect, it, vi } from 'vitest';
import { emptyBoard } from '@acm-uga/c4-engine';
import { callBot, joinUrl, type MoveRequestBody } from './protocol.js';

function baseRequest(): MoveRequestBody {
  return {
    you: 1,
    board: emptyBoard(),
    moves: [],
    game: { match_id: 'test', game_number: 1, clock_remaining_ms: 10_000 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('joinUrl', () => {
  it('joins a base without a trailing slash', () => {
    expect(joinUrl('http://localhost:8000', '/move')).toBe('http://localhost:8000/move');
  });

  it('joins a base with a trailing slash without doubling it', () => {
    expect(joinUrl('http://localhost:8000/', '/move')).toBe('http://localhost:8000/move');
  });
});

describe('callBot', () => {
  it('returns the column on a valid 200 response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ column: 3 }));
    const result = await callBot('http://localhost:8000', baseRequest(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.outcome).toEqual({ ok: true, column: 3 });
    expect(result.think_ms).toBeGreaterThanOrEqual(0);
  });

  it('reports http_error on a non-200 response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 500));
    const result = await callBot('http://localhost:8000', baseRequest(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.outcome).toMatchObject({ ok: false, reason: 'http_error' });
  });

  it('reports malformed_json when the body does not parse', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    const result = await callBot('http://localhost:8000', baseRequest(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.outcome).toMatchObject({ ok: false, reason: 'malformed_json' });
  });

  it('reports invalid_response when "column" is missing or not an integer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ column: 'three' }));
    const result = await callBot('http://localhost:8000', baseRequest(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.outcome).toMatchObject({ ok: false, reason: 'invalid_response' });
  });

  it('reports unreachable when fetch throws a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await callBot('http://localhost:8000', baseRequest(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.outcome).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('reports timeout when the request is aborted', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const result = await callBot('http://localhost:8000', baseRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    expect(result.outcome).toMatchObject({ ok: false, reason: 'timeout' });
  });
});
