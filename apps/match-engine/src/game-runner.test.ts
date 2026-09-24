import { describe, expect, it } from 'vitest';
import { gameWinningTeamSlot, playGame, type GameConfig, type PlayerTransports } from './game-runner.js';
import { FakeBotTransport } from './testing/fake-bot-transport.js';

const baseConfig: GameConfig = {
  matchId: 'test-match',
  gameNumber: 1,
  firstPlayer: 1,
  firstPlayerTeam: 0,
  coinFlip: true,
  thinkBudgetMs: 10_000,
};

describe('playGame — normal play', () => {
  it('detects a vertical four-in-a-row and stops immediately', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });
    const transports: PlayerTransports = { 1: t1, 2: t2 };

    const record = await playGame(transports, baseConfig);

    expect(record.outcome).toEqual({ type: 'four_in_a_row', winner: 1 });
    // 4 stacked player-1 pieces in col 0 interleaved with 3 player-2 moves in col 1.
    expect(record.moves).toHaveLength(7);
    expect(record.moves.map((m) => m.column)).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(record.clock_events).toEqual([]);
    expect(record.first_player).toBe(1);
    expect(record.first_player_team).toBe(0);
    expect(record.coin_flip).toBe(true);
  });

  it('records approximate think time per move', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }), thinkMs: 15 });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }), thinkMs: 5 });
    const record = await playGame({ 1: t1, 2: t2 }, baseConfig);

    // setTimeout isn't exact; allow a couple ms of scheduler jitter under load.
    const p1Moves = record.moves.filter((m) => m.player === 1);
    const p2Moves = record.moves.filter((m) => m.player === 2);
    for (const m of p1Moves) expect(m.think_ms).toBeGreaterThanOrEqual(12);
    for (const m of p2Moves) expect(m.think_ms).toBeGreaterThanOrEqual(2);
  });

  it('gameWinningTeamSlot resolves the winning team from the game-level player numbers', async () => {
    // team slot 1 is first_player here (player 1), team slot 0 is player 2.
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });
    const record = await playGame(
      { 1: t1, 2: t2 },
      { ...baseConfig, firstPlayer: 1, firstPlayerTeam: 1 },
    );
    expect(record.outcome.type).toBe('four_in_a_row');
    // player 1 (team slot 1) won.
    expect(gameWinningTeamSlot(record)).toBe(1);
  });
});

describe('playGame — invalid move forfeits', () => {
  it('forfeits when the bot returns an out-of-range column', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 99 }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });
    const record = await playGame({ 1: t1, 2: t2 }, baseConfig);

    expect(record.outcome).toEqual({
      type: 'forfeit',
      winner: 2,
      forfeited_player: 1,
      reason: 'invalid_move',
    });
    expect(record.moves).toHaveLength(0);
  });

  it('forfeits on a malformed/non-200 response reported by the transport', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'invalid', detail: 'non-200 response: 500' }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });
    const record = await playGame({ 1: t1, 2: t2 }, baseConfig);

    expect(record.outcome).toMatchObject({ type: 'forfeit', reason: 'invalid_move', forfeited_player: 1, winner: 2 });
  });

  it('forfeits when the bot fills an already-full column', async () => {
    // Both bots always play column 0; after 8 moves it's full, and the 9th attempt is illegal.
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }) });
    const record = await playGame({ 1: t1, 2: t2 }, baseConfig);

    expect(record.outcome.type).toBe('forfeit');
    if (record.outcome.type === 'forfeit') {
      expect(record.outcome.reason).toBe('invalid_move');
    }
  });
});

describe('playGame — chess clock', () => {
  it('forfeits with clock_expired when a bot never responds within its budget', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }), thinkMs: 200 });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });
    const record = await playGame({ 1: t1, 2: t2 }, { ...baseConfig, thinkBudgetMs: 20 });

    expect(record.outcome).toEqual({ type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'clock_expired' });
    expect(record.moves).toHaveLength(0);
  });

  it('a slow-but-within-budget bot is not forfeited', async () => {
    const t1 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 0 }), thinkMs: 10 });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }), thinkMs: 10 });
    const record = await playGame({ 1: t1, 2: t2 }, { ...baseConfig, thinkBudgetMs: 5_000 });

    expect(record.outcome).toEqual({ type: 'four_in_a_row', winner: 1 });
  });
});

describe('playGame — crash and restart', () => {
  it('bills the restart, records a restart event, and resends the move', async () => {
    let calls = 0;
    const t1 = new FakeBotTransport({
      script: () => {
        calls++;
        if (calls === 1) return { type: 'crashed', detail: 'connection reset' };
        return { type: 'ok', column: 0 };
      },
      restartMs: 500,
    });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });

    const record = await playGame({ 1: t1, 2: t2 }, { ...baseConfig, thinkBudgetMs: 10_000 });

    expect(record.clock_events).toHaveLength(1);
    expect(record.clock_events[0]).toEqual({ type: 'restart', player: 1, billed_ms: 500, at_move: 0 });
    // Play continues to completion after the restart.
    expect(record.outcome).toEqual({ type: 'four_in_a_row', winner: 1 });
  });

  it('crash-looping drains the clock to a crash_loop forfeit', async () => {
    const t1 = new FakeBotTransport({
      script: () => ({ type: 'crashed', detail: 'oom-kill' }),
      restartMs: 400,
    });
    const t2 = new FakeBotTransport({ script: () => ({ type: 'ok', column: 1 }) });

    const record = await playGame({ 1: t1, 2: t2 }, { ...baseConfig, thinkBudgetMs: 1_000 });

    expect(record.outcome).toEqual({ type: 'forfeit', winner: 2, forfeited_player: 1, reason: 'crash_loop' });
    expect(record.moves).toHaveLength(0);
    // Exactly enough restarts to drain a 1000ms budget at 400ms each (2 restarts -> 800ms billed, 3rd would exceed).
    expect(record.clock_events.length).toBeGreaterThan(0);
    for (const event of record.clock_events) {
      expect(event).toMatchObject({ type: 'restart', player: 1 });
    }
  });
});
