import { describe, expect, it } from 'vitest';
import type { Player } from '@acm-uga/c4-engine';
import { playGame, type GameEvent, type MoveOutcome, type MoveProvider } from './referee.js';

/** Always plays the next column from a fixed script, ignoring board state. */
function scripted(columns: number[]): MoveProvider {
  let i = 0;
  return async (): Promise<MoveOutcome> => {
    const column = columns[i];
    i++;
    if (column === undefined) throw new Error('scripted provider ran out of moves');
    return { ok: true, column, think_ms: 10 };
  };
}

async function collect(providers: Record<Player, MoveProvider>, firstPlayer: Player = 1): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for await (const event of playGame(providers, firstPlayer)) {
    events.push(event);
  }
  return events;
}

/**
 * A verified 64-move sequence (alternating p1/p2 from move 0) that fills an
 * 8x8 board with no four-in-a-row at any point, generated offline by
 * simulating engine-equivalent win checks and rejecting any move that would
 * complete a line. See git history / task notes for the generator.
 */
const DRAW_SEQUENCE = [
  6, 5, 6, 0, 3, 6, 7, 7, 6, 2, 5, 1, 2, 4, 3, 5, 3, 0, 2, 5, 1, 5, 2, 0, 7, 6, 0, 2, 5, 0, 6, 4, 7, 6, 6, 0, 4, 3, 3,
  1, 4, 5, 3, 0, 0, 3, 4, 5, 3, 7, 2, 1, 2, 4, 1, 7, 4, 7, 1, 1, 7, 4, 2, 1,
];

describe('playGame', () => {
  it('detects a vertical win', async () => {
    // Player 1 stacks column 0 four times; player 2 plays elsewhere.
    const p1 = scripted([0, 0, 0, 0]);
    const p2 = scripted([1, 1, 1]);
    const events = await collect({ 1: p1, 2: p2 });

    const win = events.find((e) => e.type === 'win');
    expect(win).toMatchObject({ type: 'win', player: 1 });
    expect((win as Extract<GameEvent, { type: 'win' }>).line).toHaveLength(4);
  });

  it('detects a horizontal win', async () => {
    const p1 = scripted([0, 1, 2, 3]);
    const p2 = scripted([7, 7, 7]); // stacks col 7, doesn't block
    const events = await collect({ 1: p1, 2: p2 });
    const win = events.find((e) => e.type === 'win');
    expect(win).toMatchObject({ type: 'win', player: 1 });
  });

  it('detects a diagonal win', async () => {
    // Builds a rising diagonal for player 1 at (0,0),(1,1),(2,2),(3,3);
    // player 2 fills column 1/2/3 setup moves plus a dummy column (7) so it
    // never lands on the diagonal itself. Verified by simulation.
    const p1 = scripted([0, 1, 2, 2, 3, 3, 3]);
    const p2 = scripted([1, 2, 7, 3, 7, 7]);
    const events = await collect({ 1: p1, 2: p2 });
    const win = events.find((e) => e.type === 'win');
    expect(win).toMatchObject({ type: 'win', player: 1 });
  });

  it('forfeits the game when a provider fails (e.g. timeout)', async () => {
    const p1 = scripted([0]);
    const p2: MoveProvider = async () => ({ ok: false, reason: 'timeout', message: 'no response', think_ms: 10_000 });
    const events = await collect({ 1: p1, 2: p2 });
    const forfeit = events.find((e) => e.type === 'forfeit');
    expect(forfeit).toMatchObject({ type: 'forfeit', player: 2, reason: 'timeout' });
  });

  it('forfeits the game when a provider returns an out-of-range column', async () => {
    const p1 = scripted([99]);
    const p2 = scripted([]);
    const events = await collect({ 1: p1, 2: p2 });
    const forfeit = events.find((e) => e.type === 'forfeit');
    expect(forfeit).toMatchObject({ type: 'forfeit', player: 1, reason: 'invalid_move' });
  });

  it('forfeits when a column is already full', async () => {
    // Fill column 0 to the top (8 rows) alternating players, then have
    // player 1 try it again.
    const p1 = scripted([0, 0, 0, 0, 0]);
    const p2 = scripted([0, 0, 0, 0]);
    const events = await collect({ 1: p1, 2: p2 });
    const forfeit = events.find((e) => e.type === 'forfeit');
    expect(forfeit).toMatchObject({ reason: 'invalid_move' });
  });

  it('reports a draw when the board fills with no winner', async () => {
    const p1Moves = DRAW_SEQUENCE.filter((_, i) => i % 2 === 0);
    const p2Moves = DRAW_SEQUENCE.filter((_, i) => i % 2 === 1);
    const events = await collect({ 1: scripted(p1Moves), 2: scripted(p2Moves) });

    expect(events.some((e) => e.type === 'win')).toBe(false);
    expect(events.filter((e) => e.type === 'move_applied')).toHaveLength(64);
    expect(events[events.length - 1]).toMatchObject({ type: 'draw' });
  });

  it('starts with the configured first player', async () => {
    // Only the first yielded event matters here, so providers never need to
    // be called -- a provider that throws if invoked proves it wasn't.
    const neverCalled: MoveProvider = async () => {
      throw new Error('should not be called before the first event is read');
    };
    const iterator = playGame({ 1: neverCalled, 2: neverCalled }, 2);
    const { value } = await iterator.next();
    expect(value).toMatchObject({ type: 'move_attempt', player: 2 });
  });
});
