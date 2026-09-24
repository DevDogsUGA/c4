// Pure derivations for the seeding-reveal scene (SHOW_PLAN.md §4.2):
// teams first render in gray alphabetical order with 0-0 records, then the
// round robin replays one match at a time -- each result adds a W to the
// winner and an L to the loser, and the table re-sorts by running record --
// ending on the official final ranks, while a results marquee ticks through
// round-robin scores. All of this is precomputed here as plain data; the
// component only needs to tween between consecutive frames and render the
// marquee strings.

import type { MatchRecord, StandingsEntry } from '@acm-uga/c4-contract';
import { sortStandings } from './standings.js';

/** Every entry, sorted alphabetically by team name (the reveal's starting order). */
export function alphabeticalOrder(standings: readonly StandingsEntry[]): StandingsEntry[] {
  return [...standings].sort((a, b) => a.team.name.localeCompare(b.team.name));
}

/** Every entry, sorted by final rank (the reveal's settled order). */
export function finalOrder(standings: readonly StandingsEntry[]): StandingsEntry[] {
  return sortStandings(standings);
}

export interface SeedingRecord {
  name: string;
  wins: number;
  losses: number;
}

/** One step of the seeding replay: every team's running record, in display order. */
export interface SeedingFrame {
  rows: SeedingRecord[];
  /** The match winner credited on this frame (flashed on stage); null for the opening/closing frames and for a double forfeit. */
  winner: string | null;
}

/**
 * The seeding replay, frame by frame:
 *   - frame 0: every team alphabetical at 0-0;
 *   - one frame per round-robin match, in `matches` order: the winner gets
 *     +1 W and the loser +1 L (a double forfeit -- `winner_team: null` --
 *     is a loss for both, per the contract), then the rows re-sort by wins
 *     desc, losses asc -- stably, so teams with equal records keep their
 *     previous relative order instead of jittering;
 *   - a last frame: official rank order with the official W-L from
 *     `standings` (this is where upstream tie-breaks land).
 * Match teams missing from `standings` are ignored.
 */
export function seedingReplay(standings: readonly StandingsEntry[], matches: readonly MatchRecord[]): SeedingFrame[] {
  let rows: SeedingRecord[] = alphabeticalOrder(standings).map((entry) => ({ name: entry.team.name, wins: 0, losses: 0 }));
  const frames: SeedingFrame[] = [{ rows, winner: null }];

  for (const match of matches) {
    if (match.phase !== 'roundrobin') continue;
    const winnerSlot = match.result.winner_team;
    const winner = winnerSlot === null ? null : match.teams[winnerSlot]!.name;
    const names = new Set(rows.map((r) => r.name));
    rows = rows
      .map((row) => {
        if (!match.teams.some((t) => t.name === row.name)) return row;
        return row.name === winner ? { ...row, wins: row.wins + 1 } : { ...row, losses: row.losses + 1 };
      })
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    frames.push({ rows, winner: winner !== null && names.has(winner) ? winner : null });
  }

  frames.push({
    rows: finalOrder(standings).map((entry) => ({ name: entry.team.name, wins: entry.match_wins, losses: entry.match_losses })),
    winner: null,
  });
  return frames;
}

export const SEEDING_REPLAY_TARGET_MS = 30_000;
export const SEEDING_STEP_MIN_MS = 450;
export const SEEDING_STEP_MAX_MS = 1200;

/** Time between replay frames: spreads `frameCount` steps over ~SEEDING_REPLAY_TARGET_MS, clamped so a small round robin doesn't crawl and a big one stays readable. */
export function seedingStepMs(frameCount: number): number {
  if (frameCount <= 0) return SEEDING_STEP_MAX_MS;
  return Math.min(SEEDING_STEP_MAX_MS, Math.max(SEEDING_STEP_MIN_MS, SEEDING_REPLAY_TARGET_MS / frameCount));
}

/**
 * One marquee line per round-robin match, e.g. "TEAM A def. TEAM B 2-1". A
 * double forfeit (`winner_team: null` -- both teams forfeited, a loss for
 * both per the contract) has no winner to lead with, so it renders as
 * "TEAM A vs. TEAM B — double forfeit" instead. The winner is
 * `result.winner_team`; the score is `games_won` ordered winner-first.
 * Non-roundrobin (bracket) matches are excluded -- the marquee is
 * round-robin flavor only, per SHOW_PLAN.md §4.2.
 */
export function marqueeLines(matches: readonly MatchRecord[]): string[] {
  return matches
    .filter((match) => match.phase === 'roundrobin')
    .map((match) => {
      const winnerSlot = match.result.winner_team;
      if (winnerSlot === null) {
        const [teamA, teamB] = match.teams;
        return `${teamA!.name} vs. ${teamB!.name} — double forfeit`;
      }
      const loserSlot = winnerSlot === 0 ? 1 : 0;
      const winner = match.teams[winnerSlot]!.name;
      const loser = match.teams[loserSlot]!.name;
      const winnerGames = match.result.games_won[winnerSlot];
      const loserGames = match.result.games_won[loserSlot];
      return `${winner} def. ${loser} ${winnerGames}-${loserGames}`;
    });
}
