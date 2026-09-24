// Checks that each sample's declared `expect` actually happened in the
// tournament output, and that every fail-state the contract can express
// shows up at least once. Fails loudly with a readable table instead of
// producing a quietly boring tournament.

import type { GameRecord, MatchRecord, TeamSlot, TournamentBundle } from '@acm-uga/c4-contract';
import type { MaterializedSample } from './materialize.js';

/** `expect.reason` may list alternatives, e.g. "crash_loop|clock_expired" (a crash-looping bot can drain its clock before hitting the restart cap). */
function reasonMatches(expected: string | undefined, actual: string): boolean {
  return !expected || expected.split('|').includes(actual);
}

export interface ExpectationCheck {
  slug: string;
  teamName: string;
  kind: string;
  reason?: string;
  ok: boolean;
  detail: string;
}

function matchesTeam(m: MatchRecord, teamName: string): 0 | 1 | -1 {
  if (m.teams[0].name === teamName) return 0;
  if (m.teams[1].name === teamName) return 1;
  return -1;
}

/**
 * Which in-game player number (1 or 2) a team slot is THIS game. Player
 * numbers are not fixed per team across a match: match-runner.ts alternates
 * (or re-coin-flips, for sudden death) which team slot is `first_player_team`
 * every game, and game-runner.ts always labels that team's bot "player 1"
 * for the game (the transports map is built fresh per game around
 * `firstPlayerTeam`). So the correct mapping is per-game, from
 * `game.first_player_team` -- never a match-wide `slot === 0 ? 1 : 2`
 * constant, which is only right for roughly half of any given team's games.
 */
function playerForSlot(game: GameRecord, slot: 0 | 1 | -1): 1 | 2 {
  return (slot as TeamSlot) === game.first_player_team ? 1 : 2;
}

function checkOne(sample: MaterializedSample, matches: MatchRecord[]): ExpectationCheck {
  const teamName = sample.sample.name;
  const { kind, reason } = sample.sample.expect;
  const base = { slug: sample.slug, teamName, kind, reason };

  const teamMatches = matches.filter((m) => matchesTeam(m, teamName) !== -1);
  if (teamMatches.length === 0) {
    return { ...base, ok: false, detail: 'team never appears in any match record' };
  }

  switch (kind) {
    case 'normal': {
      const played = teamMatches.some((m) => m.result.reason === 'played');
      return { ...base, ok: played, detail: played ? 'played at least one full match' : 'never played a full (non-forfeit) match' };
    }
    case 'build_failed':
    case 'checkout_failed': {
      const hit = teamMatches.some((m) => {
        const slot = matchesTeam(m, teamName);
        return m.result.forfeits?.some((f) => f.team === slot && f.reason === kind);
      });
      return { ...base, ok: hit, detail: hit ? `match forfeit reason=${kind} occurred` : `no match forfeit with reason=${kind}` };
    }
    case 'match_forfeit': {
      const hit = teamMatches.some((m) => {
        const slot = matchesTeam(m, teamName);
        return m.result.forfeits?.some((f) => f.team === slot && reasonMatches(reason, f.reason));
      });
      return { ...base, ok: hit, detail: hit ? 'match forfeit occurred' : 'no match forfeit for this team' };
    }
    case 'game_forfeit': {
      // The real game-runner (apps/match-engine/src/game-runner.ts) records
      // a game-ending forfeit only in `game.outcome` (type: 'forfeit',
      // forfeited_player, reason) -- it never pushes a matching entry into
      // `clock_events`, even though the contract schema's ClockEventSchema
      // union would allow one. Check outcome (the field that's actually
      // populated), and also accept a clock_events forfeit entry for
      // forward-compat if a future engine version starts emitting both.
      const hit = teamMatches.some((m) => {
        const slot = matchesTeam(m, teamName);
        return m.games.some((g) => {
          const player = playerForSlot(g, slot);
          if (g.outcome.type === 'forfeit' && g.outcome.forfeited_player === player && reasonMatches(reason, g.outcome.reason)) {
            return true;
          }
          return g.clock_events.some((e) => e.type === 'forfeit' && e.player === player && reasonMatches(reason, e.reason));
        });
      });
      return { ...base, ok: hit, detail: hit ? 'game forfeit occurred' : 'no game forfeit for this team' };
    }
    case 'restarts': {
      const hit = teamMatches.some((m) => {
        const slot = matchesTeam(m, teamName);
        return m.games.some((g) => g.clock_events.some((e) => e.type === 'restart' && e.player === playerForSlot(g, slot)));
      });
      return { ...base, ok: hit, detail: hit ? 'a restart event occurred' : 'no restart event for this team' };
    }
    case 'draw': {
      const hit = teamMatches.some((m) => m.games.some((g) => g.outcome.type === 'draw'));
      return { ...base, ok: hit, detail: hit ? 'a draw occurred' : 'no draw involving this team' };
    }
    default:
      return { ...base, ok: false, detail: `unknown expect.kind "${kind}"` };
  }
}

export function checkExpectations(samples: MaterializedSample[], bundle: TournamentBundle): ExpectationCheck[] {
  return samples.map((s) => checkOne(s, bundle.matches));
}

export interface CoverageCheck {
  label: string;
  ok: boolean;
}

/**
 * Every fail state the contract can express should appear at least once
 * across the run: each game ForfeitReason, restart events, each match
 * forfeit reason, a double forfeit, a draw if achievable.
 */
export function checkFailStateCoverage(bundle: TournamentBundle): CoverageCheck[] {
  const matches = bundle.matches;
  // See the comment on playerForSlot/game_forfeit in checkOne: the real
  // engine records a game forfeit's reason in `game.outcome`, not
  // `clock_events`. Pull from both so this stays correct if a future
  // engine version starts populating clock_events too.
  const gameForfeitReasons = new Set(
    matches.flatMap((m) =>
      m.games.flatMap((g) => [
        ...(g.outcome.type === 'forfeit' ? [g.outcome.reason] : []),
        ...g.clock_events.filter((e) => e.type === 'forfeit').map((e) => e.reason),
      ]),
    ),
  );
  const matchForfeitReasons = new Set(matches.flatMap((m) => (m.result.forfeits ?? []).map((f) => f.reason)));
  const hasRestart = matches.some((m) => m.games.some((g) => g.clock_events.some((e) => e.type === 'restart')));
  const hasDoubleForfeit = matches.some((m) => (m.result.forfeits?.length ?? 0) === 2);
  const hasDraw = matches.some((m) => m.games.some((g) => g.outcome.type === 'draw'));

  const checks: CoverageCheck[] = [
    { label: 'game forfeit: clock_expired', ok: gameForfeitReasons.has('clock_expired') },
    { label: 'game forfeit: invalid_move', ok: gameForfeitReasons.has('invalid_move') },
    { label: 'game forfeit: crash_loop', ok: gameForfeitReasons.has('crash_loop') },
    { label: 'match forfeit: startup_timeout', ok: matchForfeitReasons.has('startup_timeout') },
    { label: 'match forfeit: build_failed', ok: matchForfeitReasons.has('build_failed') },
    { label: 'match forfeit: checkout_failed', ok: matchForfeitReasons.has('checkout_failed') },
    { label: 'restart event', ok: hasRestart },
    { label: 'double forfeit (round-robin)', ok: hasDoubleForfeit },
    { label: 'draw', ok: hasDraw },
  ];
  return checks;
}

export function formatTable(checks: ExpectationCheck[]): string {
  const rows = checks.map((c) => [c.slug, c.kind, c.reason ?? '', c.ok ? 'PASS' : 'FAIL', c.detail]);
  const header = ['sample', 'expect.kind', 'reason', 'result', 'detail'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
