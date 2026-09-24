// Bot API types/schemas and the game-record file format.
//
// DESIGN.md is normative. This package is the spec, as code: zod schemas are
// the source of truth, TS types are inferred from them. No I/O, no
// dependency on @acm-uga/c4-engine (kept deliberately independent so the
// wire format stays honest to what actually crosses the network / disk).

import { z } from 'zod';

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;

/** Per-player, per-game chess-clock budget in ms (the event default). */
export const THINK_BUDGET_MS = 5_000;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** 0 = empty, 1 = player 1, 2 = player 2. */
export const CellSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Cell = z.infer<typeof CellSchema>;

/** A player slot within a single game: 1 or 2. */
export const PlayerSchema = z.union([z.literal(1), z.literal(2)]);
export type Player = z.infer<typeof PlayerSchema>;

/** A legal column index, 0-7 (left to right). */
export const ColumnSchema = z.number().int().min(0).max(BOARD_WIDTH - 1);
export type Column = z.infer<typeof ColumnSchema>;

/**
 * board[col][row]. col 0 = left, row 0 = BOTTOM. Always exactly
 * BOARD_WIDTH columns of exactly BOARD_HEIGHT cells each, per DESIGN.md.
 */
export const BoardSchema = z
  .array(z.array(CellSchema).length(BOARD_HEIGHT))
  .length(BOARD_WIDTH);
export type BoardJSON = z.infer<typeof BoardSchema>;

// ---------------------------------------------------------------------------
// The /move contract (bot-facing HTTP API, see DESIGN.md "The bot model")
// ---------------------------------------------------------------------------

export const MoveRequestSchema = z.object({
  /** Are you player 1 or 2 this game. */
  you: PlayerSchema,
  /** Full board state. */
  board: BoardSchema,
  /** Full move history (columns), convenience for the bot. */
  moves: z.array(ColumnSchema),
  game: z.object({
    match_id: z.string().min(1),
    /** 1-based within the match. */
    game_number: z.number().int().positive(),
    /** The bot's remaining think budget this game, in milliseconds. */
    clock_remaining_ms: z.number().int().nonnegative(),
  }),
});
export type MoveRequest = z.infer<typeof MoveRequestSchema>;

export const MoveResponseSchema = z.object({
  column: ColumnSchema,
});
export type MoveResponse = z.infer<typeof MoveResponseSchema>;

// ---------------------------------------------------------------------------
// The game-record file format (match engine -> presenter, the ONLY interface
// between them per DESIGN.md "Architecture: compute and theater are
// decoupled").
// ---------------------------------------------------------------------------

/** Which slot in a MatchRecord.teams tuple a team occupies. */
export const TeamSlotSchema = z.union([z.literal(0), z.literal(1)]);
export type TeamSlot = z.infer<typeof TeamSlotSchema>;

export const TournamentPhaseSchema = z.enum(['roundrobin', 'bracket']);
export type TournamentPhase = z.infer<typeof TournamentPhaseSchema>;

export const TeamRefSchema = z.object({
  name: z.string().min(1),
  // Not z.string().url(): submissions normally arrive as GitHub URLs, but
  // the USB fallback (DESIGN.md submission section) and local template
  // testing hand the arena plain filesystem paths, which are equally valid
  // repo references for `git clone`.
  repo_url: z.string().min(1),
  /** Member display names from the submission form, for presenter intros. */
  members: z.array(z.string().min(1)).optional(),
  /** Template language detected from the frozen checkout (e.g. "python"). */
  language: z.string().min(1).optional(),
});
export type TeamRef = z.infer<typeof TeamRefSchema>;

/** One move as it happened, with the think time it cost the mover's clock. */
export const MoveRecordSchema = z.object({
  player: PlayerSchema,
  column: ColumnSchema,
  /** Wall-clock time this move cost the mover, arena-side measurement. */
  think_ms: z.number().int().nonnegative(),
});
export type MoveRecord = z.infer<typeof MoveRecordSchema>;

/** Why a game (or, for the match-level variant below, a match) was forfeited. */
export const ForfeitReasonSchema = z.enum([
  /** Chess clock hit zero. */
  'clock_expired',
  /** Full/out-of-range column, malformed JSON, or non-200 response. */
  'invalid_move',
  /** Container kept crash-looping until the clock drained. */
  'crash_loop',
]);
export type ForfeitReason = z.infer<typeof ForfeitReasonSchema>;

/**
 * A container crash-restart mid-game. Restart wall time is billed to the
 * crashing bot's clock and the triggering move request is re-sent.
 */
export const RestartEventSchema = z.object({
  type: z.literal('restart'),
  player: PlayerSchema,
  /** How many milliseconds of the restart were billed to `player`'s clock. */
  billed_ms: z.number().int().nonnegative(),
  /** Index into this game's `moves` array of the move being retried (0-based). */
  at_move: z.number().int().nonnegative(),
});
export type RestartEvent = z.infer<typeof RestartEventSchema>;

/** A game-ending forfeit triggered by a clock/protocol/crash failure. */
export const GameForfeitEventSchema = z.object({
  type: z.literal('forfeit'),
  /** The player who forfeited the game. */
  player: PlayerSchema,
  reason: ForfeitReasonSchema,
  /** Index into this game's `moves` array at the time of forfeit (0-based). */
  at_move: z.number().int().nonnegative(),
});
export type GameForfeitEvent = z.infer<typeof GameForfeitEventSchema>;

export const ClockEventSchema = z.discriminatedUnion('type', [
  RestartEventSchema,
  GameForfeitEventSchema,
]);
export type ClockEvent = z.infer<typeof ClockEventSchema>;

/** How a single game concluded. */
export const GameOutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('four_in_a_row'), winner: PlayerSchema }),
  z.object({
    type: z.literal('forfeit'),
    winner: PlayerSchema,
    forfeited_player: PlayerSchema,
    reason: ForfeitReasonSchema,
  }),
  z.object({ type: z.literal('draw') }),
]);
export type GameOutcome = z.infer<typeof GameOutcomeSchema>;

export const GameRecordSchema = z.object({
  /** 1-based within the match (best-of-3, plus sudden-death games if tied). */
  game_number: z.number().int().positive(),
  /** Which board-number (1 or 2) moved first this game. */
  first_player: PlayerSchema,
  /** Which team slot (index into MatchRecord.teams) was `first_player`. */
  first_player_team: TeamSlotSchema,
  /** True if `first_player` was decided by an arena coin flip (game 1 and any sudden-death game); false when it alternated deterministically from the prior game. */
  coin_flip: z.boolean(),
  moves: z.array(MoveRecordSchema),
  clock_events: z.array(ClockEventSchema),
  outcome: GameOutcomeSchema,
});
export type GameRecord = z.infer<typeof GameRecordSchema>;

/** Why a whole match was forfeited before (or instead of) any game. */
export const MatchForfeitReasonSchema = z.enum([
  /** Missed the off-clock health-check grace at match start. */
  'startup_timeout',
  /** The frozen commit's Docker image failed to build. */
  'build_failed',
  /** The repo or frozen commit couldn't be checked out. */
  'checkout_failed',
]);
export type MatchForfeitReason = z.infer<typeof MatchForfeitReasonSchema>;

export const MatchForfeitSchema = z.object({
  team: TeamSlotSchema,
  reason: MatchForfeitReasonSchema,
});
export type MatchForfeit = z.infer<typeof MatchForfeitSchema>;

/** Overall result of a best-of-3 (or sudden-death-extended) match. */
export const MatchResultSchema = z
  .object({
    /**
     * Which team slot won the match. null only for a double forfeit (both
     * teams forfeited): a loss for both in round-robin; in the bracket
     * neither advances and the next-round opponent gets a bye.
     */
    winner_team: TeamSlotSchema.nullable(),
    /** Games won, indexed by team slot: [team0Wins, team1Wins]. */
    games_won: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    reason: z.enum(['played', 'forfeit']),
    /** Present iff `reason` is 'forfeit': one entry, or two for a double forfeit. */
    forfeits: z.array(MatchForfeitSchema).min(1).max(2).optional(),
  })
  .superRefine((r, ctx) => {
    const n = r.forfeits?.length ?? 0;
    if ((r.reason === 'forfeit') !== n > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'forfeits must be present iff reason is "forfeit"' });
    }
    if (n === 2 && r.forfeits![0].team === r.forfeits![1].team) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a double forfeit must name both team slots' });
    }
    if ((r.winner_team === null) !== (n === 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'winner_team is null iff both teams forfeited' });
    }
    if (n === 1 && r.winner_team === r.forfeits![0].team) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the forfeiting team cannot win the match' });
    }
  });
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const MatchRecordSchema = z.object({
  match_id: z.string().min(1),
  phase: TournamentPhaseSchema,
  /** Human-readable round label, e.g. "Round 3" or "Quarterfinal". */
  round: z.string().optional(),
  teams: z.tuple([TeamRefSchema, TeamRefSchema]),
  games: z.array(GameRecordSchema),
  result: MatchResultSchema,
});
export type MatchRecord = z.infer<typeof MatchRecordSchema>;

// ---------------------------------------------------------------------------
// Standings / bracket summary (presenter input alongside match records)
// ---------------------------------------------------------------------------

export const StandingsEntrySchema = z.object({
  team: TeamRefSchema,
  rank: z.number().int().positive(),
  match_wins: z.number().int().nonnegative(),
  match_losses: z.number().int().nonnegative(),
  game_wins: z.number().int().nonnegative(),
  game_losses: z.number().int().nonnegative(),
});
export type StandingsEntry = z.infer<typeof StandingsEntrySchema>;

export const BracketMatchSchema = z.object({
  /** References a MatchRecord.match_id once played; null if not yet played. */
  match_id: z.string().nullable(),
  round: z.string(),
  /** Position within the round, 0-based. */
  slot: z.number().int().nonnegative(),
  /** null = not yet determined (winner of an earlier round TBD). */
  team_a: TeamRefSchema.nullable(),
  /** null = not yet determined, or a bye. */
  team_b: TeamRefSchema.nullable(),
  winner: TeamRefSchema.nullable(),
  bye: z.boolean(),
});
export type BracketMatch = z.infer<typeof BracketMatchSchema>;

export const TournamentSummarySchema = z.object({
  standings: z.array(StandingsEntrySchema),
  bracket: z.array(BracketMatchSchema),
  generated_at: z.string().datetime(),
});
export type TournamentSummary = z.infer<typeof TournamentSummarySchema>;

// ---------------------------------------------------------------------------
// Single-file export (engine -> R2 -> presenter)
// ---------------------------------------------------------------------------

/**
 * The whole tournament in one JSON file: what the engine uploads to R2 and
 * what the presenter loads by URL or file picker. `provenance` is free-form
 * run metadata (template commit, engine settings, sample list) and is never
 * read by the presenter.
 */
export const TournamentBundleSchema = z.object({
  format: z.literal('c4-tournament-bundle'),
  version: z.literal(1),
  summary: TournamentSummarySchema,
  matches: z.array(MatchRecordSchema),
  provenance: z.record(z.unknown()).optional(),
});
export type TournamentBundle = z.infer<typeof TournamentBundleSchema>;
