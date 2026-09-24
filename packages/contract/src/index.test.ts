import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BoardSchema,
  BracketMatchSchema,
  ClockEventSchema,
  GameOutcomeSchema,
  GameRecordSchema,
  MatchRecordSchema,
  MatchResultSchema,
  MoveRequestSchema,
  MoveResponseSchema,
  StandingsEntrySchema,
  TournamentSummarySchema,
  type MatchRecord,
  type TournamentSummary,
} from './index.js';

function makeEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_WIDTH }, () => Array.from({ length: BOARD_HEIGHT }, () => 0));
}

describe('BoardSchema', () => {
  it('accepts a well-formed empty board', () => {
    expect(BoardSchema.safeParse(makeEmptyBoard()).success).toBe(true);
  });

  it('rejects a board with the wrong number of columns', () => {
    const board = makeEmptyBoard().slice(0, 7);
    expect(BoardSchema.safeParse(board).success).toBe(false);
  });

  it('rejects a column with the wrong height', () => {
    const board = makeEmptyBoard();
    board[0] = board[0].slice(0, 7);
    expect(BoardSchema.safeParse(board).success).toBe(false);
  });

  it('rejects cell values outside {0,1,2}', () => {
    const board = makeEmptyBoard();
    board[0][0] = 3;
    expect(BoardSchema.safeParse(board).success).toBe(false);
  });
});

describe('MoveRequestSchema', () => {
  const valid = {
    you: 1,
    board: makeEmptyBoard(),
    moves: [3, 4, 3],
    game: {
      match_id: 'rr-007',
      game_number: 2,
      clock_remaining_ms: 8420,
    },
  };

  it('accepts a well-formed request matching the DESIGN.md example', () => {
    const result = MoveRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range `you`', () => {
    const result = MoveRequestSchema.safeParse({ ...valid, you: 3 });
    expect(result.success).toBe(false);
  });

  it('rejects a negative clock_remaining_ms', () => {
    const result = MoveRequestSchema.safeParse({
      ...valid,
      game: { ...valid.game, clock_remaining_ms: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing match_id', () => {
    const { match_id, ...rest } = valid.game;
    const result = MoveRequestSchema.safeParse({ ...valid, game: rest });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range move history entries', () => {
    const result = MoveRequestSchema.safeParse({ ...valid, moves: [8] });
    expect(result.success).toBe(false);
  });
});

describe('MoveResponseSchema', () => {
  it('accepts a well-formed response matching the DESIGN.md example', () => {
    expect(MoveResponseSchema.safeParse({ column: 4 }).success).toBe(true);
  });

  it('rejects a column of 8 (out of range)', () => {
    expect(MoveResponseSchema.safeParse({ column: 8 }).success).toBe(false);
  });

  it('rejects a negative column', () => {
    expect(MoveResponseSchema.safeParse({ column: -1 }).success).toBe(false);
  });

  it('rejects a non-integer column', () => {
    expect(MoveResponseSchema.safeParse({ column: 3.5 }).success).toBe(false);
  });

  it('rejects extra/missing fields of the wrong shape', () => {
    expect(MoveResponseSchema.safeParse({}).success).toBe(false);
    expect(MoveResponseSchema.safeParse({ column: '4' }).success).toBe(false);
  });
});

describe('GameOutcomeSchema', () => {
  it('accepts a four_in_a_row outcome', () => {
    expect(GameOutcomeSchema.safeParse({ type: 'four_in_a_row', winner: 1 }).success).toBe(true);
  });

  it('accepts a forfeit outcome', () => {
    const result = GameOutcomeSchema.safeParse({
      type: 'forfeit',
      winner: 2,
      forfeited_player: 1,
      reason: 'clock_expired',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a draw outcome with no winner field', () => {
    expect(GameOutcomeSchema.safeParse({ type: 'draw' }).success).toBe(true);
  });

  it('rejects a forfeit outcome missing the reason', () => {
    const result = GameOutcomeSchema.safeParse({
      type: 'forfeit',
      winner: 2,
      forfeited_player: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown outcome type', () => {
    expect(GameOutcomeSchema.safeParse({ type: 'timeout' }).success).toBe(false);
  });
});

describe('ClockEventSchema', () => {
  it('accepts a restart event', () => {
    const result = ClockEventSchema.safeParse({
      type: 'restart',
      player: 1,
      billed_ms: 1500,
      at_move: 4,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a forfeit event', () => {
    const result = ClockEventSchema.safeParse({
      type: 'forfeit',
      player: 2,
      reason: 'invalid_move',
      at_move: 6,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an event with an unrecognized discriminant', () => {
    expect(ClockEventSchema.safeParse({ type: 'timeout', player: 1 }).success).toBe(false);
  });
});

describe('game-record and match-record round trip', () => {
  // A hand-written sample MatchRecord exercising every branch of the
  // schema: a decisive four-in-a-row game, a game ending by forfeit
  // (with a preceding restart event billed to the same player), and a
  // best-of-3 result summary. This is the shape match-engine emits and
  // presenter consumes -- the load-bearing interface per DESIGN.md.
  const sampleMatch: MatchRecord = {
    match_id: 'rr-007',
    phase: 'roundrobin',
    round: 'Round 3',
    teams: [
      { name: 'Team Rocket', repo_url: 'https://github.com/example/team-rocket' },
      { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
    ],
    games: [
      {
        game_number: 1,
        first_player: 1,
        first_player_team: 0,
        coin_flip: true,
        moves: [
          { player: 1, column: 3, think_ms: 120 },
          { player: 2, column: 4, think_ms: 340 },
          { player: 1, column: 3, think_ms: 210 },
        ],
        clock_events: [],
        outcome: { type: 'four_in_a_row', winner: 1 },
      },
      {
        game_number: 2,
        first_player: 2,
        first_player_team: 1,
        coin_flip: false,
        moves: [{ player: 2, column: 0, think_ms: 50 }],
        clock_events: [
          { type: 'restart', player: 1, billed_ms: 900, at_move: 1 },
          { type: 'forfeit', player: 1, reason: 'crash_loop', at_move: 1 },
        ],
        outcome: {
          type: 'forfeit',
          winner: 2,
          forfeited_player: 1,
          reason: 'crash_loop',
        },
      },
    ],
    result: {
      winner_team: 1,
      games_won: [1, 1],
      reason: 'played',
    },
  };

  const sampleForfeitMatch: MatchRecord = {
    match_id: 'rr-008',
    phase: 'roundrobin',
    teams: [
      { name: 'Team Rocket', repo_url: 'https://github.com/example/team-rocket', members: ['Ash'], language: 'python' },
      { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
    ],
    games: [],
    result: {
      winner_team: 0,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeits: [{ team: 1, reason: 'build_failed' }],
    },
  };

  const sampleDoubleForfeitMatch: MatchRecord = {
    match_id: 'rr-009',
    phase: 'roundrobin',
    teams: [
      { name: 'Team Rocket', repo_url: 'https://github.com/example/team-rocket' },
      { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
    ],
    games: [],
    result: {
      winner_team: null,
      games_won: [0, 0],
      reason: 'forfeit',
      forfeits: [
        { team: 0, reason: 'checkout_failed' },
        { team: 1, reason: 'startup_timeout' },
      ],
    },
  };

  it('parses a hand-written sample match record with no data loss', () => {
    const result = MatchRecordSchema.safeParse(sampleMatch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(sampleMatch);
    }
  });

  it('round-trips through JSON.stringify/parse unchanged', () => {
    const roundTripped = JSON.parse(JSON.stringify(sampleMatch));
    const result = MatchRecordSchema.safeParse(roundTripped);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(sampleMatch);
    }
  });

  it('rejects a match record with only one team', () => {
    const broken = { ...sampleMatch, teams: [sampleMatch.teams[0]] };
    expect(MatchRecordSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a game record with a non-1-based game_number of 0', () => {
    const broken = { ...sampleMatch.games[0], game_number: 0 };
    expect(GameRecordSchema.safeParse(broken).success).toBe(false);
  });

  it('parses a single-forfeit match record (team + members/language) with no data loss', () => {
    const result = MatchRecordSchema.safeParse(sampleForfeitMatch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(sampleForfeitMatch);
  });

  it('parses a double-forfeit match record (null winner_team, two forfeits) with no data loss', () => {
    const result = MatchRecordSchema.safeParse(sampleDoubleForfeitMatch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(sampleDoubleForfeitMatch);
  });
});

describe('MatchResultSchema superRefine invariants', () => {
  const base = { games_won: [0, 0] as [number, number] };

  it('requires forfeits to be present iff reason is forfeit', () => {
    expect(
      MatchResultSchema.safeParse({ ...base, winner_team: 0, reason: 'forfeit' }).success,
    ).toBe(false);
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: 0,
        reason: 'played',
        forfeits: [{ team: 1, reason: 'build_failed' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a double forfeit naming the same team slot twice', () => {
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: null,
        reason: 'forfeit',
        forfeits: [
          { team: 0, reason: 'build_failed' },
          { team: 0, reason: 'startup_timeout' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires winner_team to be null iff both teams forfeited', () => {
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: 0,
        reason: 'forfeit',
        forfeits: [
          { team: 0, reason: 'build_failed' },
          { team: 1, reason: 'startup_timeout' },
        ],
      }).success,
    ).toBe(false);
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: null,
        reason: 'forfeit',
        forfeits: [{ team: 1, reason: 'build_failed' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a match result where the forfeiting team is recorded as the winner', () => {
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: 1,
        reason: 'forfeit',
        forfeits: [{ team: 1, reason: 'build_failed' }],
      }).success,
    ).toBe(false);
  });

  it('accepts a valid single forfeit and a valid double forfeit', () => {
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: 0,
        reason: 'forfeit',
        forfeits: [{ team: 1, reason: 'checkout_failed' }],
      }).success,
    ).toBe(true);
    expect(
      MatchResultSchema.safeParse({
        ...base,
        winner_team: null,
        reason: 'forfeit',
        forfeits: [
          { team: 0, reason: 'checkout_failed' },
          { team: 1, reason: 'startup_timeout' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('TournamentBundleSchema', () => {
  it('parses a minimal valid bundle', async () => {
    const { TournamentBundleSchema } = await import('./index.js');
    const result = TournamentBundleSchema.safeParse({
      format: 'c4-tournament-bundle',
      version: 1,
      summary: { standings: [], bracket: [], generated_at: '2026-09-18T12:00:00.000Z' },
      matches: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the wrong format literal', async () => {
    const { TournamentBundleSchema } = await import('./index.js');
    const result = TournamentBundleSchema.safeParse({
      format: 'something-else',
      version: 1,
      summary: { standings: [], bracket: [], generated_at: '2026-09-18T12:00:00.000Z' },
      matches: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('standings / bracket summary round trip', () => {
  const sampleSummary: TournamentSummary = {
    standings: [
      {
        team: { name: 'Team Rocket', repo_url: 'https://github.com/example/team-rocket' },
        rank: 1,
        match_wins: 5,
        match_losses: 0,
        game_wins: 11,
        game_losses: 2,
      },
      {
        team: { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
        rank: 2,
        match_wins: 4,
        match_losses: 1,
        game_wins: 9,
        game_losses: 4,
      },
    ],
    bracket: [
      {
        match_id: null,
        round: 'Quarterfinal',
        slot: 0,
        team_a: { name: 'Team Rocket', repo_url: 'https://github.com/example/team-rocket' },
        team_b: null,
        winner: null,
        bye: true,
      },
      {
        match_id: 'bracket-qf-2',
        round: 'Quarterfinal',
        slot: 1,
        team_a: { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
        team_b: { name: 'Rando Calrissian', repo_url: 'https://github.com/example/rando' },
        winner: { name: 'Bit Flippers', repo_url: 'https://github.com/example/bit-flippers' },
        bye: false,
      },
    ],
    generated_at: '2026-09-18T12:00:00.000Z',
  };

  it('parses a hand-written sample tournament summary with no data loss', () => {
    const result = TournamentSummarySchema.safeParse(sampleSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(sampleSummary);
    }
  });

  it('round-trips through JSON.stringify/parse unchanged', () => {
    const roundTripped = JSON.parse(JSON.stringify(sampleSummary));
    const result = TournamentSummarySchema.safeParse(roundTripped);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(sampleSummary);
    }
  });

  it('rejects a standings entry with a non-positive rank', () => {
    const broken = { ...sampleSummary.standings[0], rank: 0 };
    expect(StandingsEntrySchema.safeParse(broken).success).toBe(false);
  });

  it('accepts a bye bracket match with both winner and team_b null', () => {
    const result = BracketMatchSchema.safeParse(sampleSummary.bracket[0]);
    expect(result.success).toBe(true);
  });

  it('rejects a tournament summary with a malformed generated_at', () => {
    const broken = { ...sampleSummary, generated_at: 'not-a-date' };
    expect(TournamentSummarySchema.safeParse(broken).success).toBe(false);
  });
});
