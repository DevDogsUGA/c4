// Round-robin scheduling and standings, per DESIGN.md "Tournament structure":
// "Full round-robin (everyone plays everyone, best-of-3) ... Standings by
// match wins; tiebreaks: head-to-head -> total game wins -> coin flip."

import type { MatchRecord, StandingsEntry, TeamSlot } from '@connect-4/contract';
import type { Rng } from './rng.js';
import { toTeamRef, type Team } from './types.js';

/** Every unordered pair of distinct teams, i.e. the full round-robin schedule. */
export function roundRobinPairings(teams: readonly Team[]): Array<[Team, Team]> {
  const pairs: Array<[Team, Team]> = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      pairs.push([teams[i], teams[j]]);
    }
  }
  return pairs;
}

interface Stats {
  matchWins: number;
  matchLosses: number;
  gameWins: number;
  gameLosses: number;
}

function emptyStats(): Stats {
  return { matchWins: 0, matchLosses: 0, gameWins: 0, gameLosses: 0 };
}

function buildStats(teams: readonly Team[], matches: readonly MatchRecord[]): Map<string, Stats> {
  const stats = new Map<string, Stats>();
  for (const team of teams) stats.set(team.name, emptyStats());

  for (const match of matches) {
    if (match.phase !== 'roundrobin') continue;
    const [a, b] = match.teams;
    const aStats = stats.get(a.name);
    const bStats = stats.get(b.name);
    if (!aStats || !bStats) continue; // match references a team outside this standings set; ignore defensively

    const [aWins, bWins] = match.result.games_won;
    aStats.gameWins += aWins;
    aStats.gameLosses += bWins;
    bStats.gameWins += bWins;
    bStats.gameLosses += aWins;

    if (match.result.winner_team === 0) {
      aStats.matchWins++;
      bStats.matchLosses++;
    } else {
      bStats.matchWins++;
      aStats.matchLosses++;
    }
  }
  return stats;
}

const TEAM_SLOT_TO_COMPARISON: Record<TeamSlot, number> = { 0: -1, 1: 1 };

/**
 * Head-to-head result between two teams from their direct round-robin
 * match, if one was played. Returns negative if `a` should rank above `b`,
 * positive if `b` above `a`, 0 if there's no direct match (or it hasn't
 * happened, or — not currently possible with best-of-3 — it was a wash).
 *
 * Simplification (documented for the validator): this is a pairwise
 * head-to-head comparator, not a full group "mini table" recompute for
 * larger tied clusters. For a >2-way tie it can be non-transitive; at
 * hackathon scale (~10-15 teams) this is an accepted simplification over
 * implementing round-robin sub-tables.
 */
function headToHead(a: Team, b: Team, matches: readonly MatchRecord[]): number {
  for (const match of matches) {
    if (match.phase !== 'roundrobin') continue;
    const [t0, t1] = match.teams;
    if (t0.name === a.name && t1.name === b.name) {
      return TEAM_SLOT_TO_COMPARISON[match.result.winner_team];
    }
    if (t0.name === b.name && t1.name === a.name) {
      return -TEAM_SLOT_TO_COMPARISON[match.result.winner_team];
    }
  }
  return 0;
}

/**
 * Computes ranked standings from round-robin match records. Tiebreak order
 * per DESIGN.md: head-to-head -> total game wins -> coin flip (seeded, so
 * deterministic for a given rng and match set).
 */
export function computeStandings(
  teams: readonly Team[],
  matches: readonly MatchRecord[],
  rng: Rng,
): StandingsEntry[] {
  const stats = buildStats(teams, matches);
  const coinFlipValue = new Map(teams.map((t) => [t.name, rng.next()] as const));

  const sorted = [...teams].sort((a, b) => {
    const sa = stats.get(a.name)!;
    const sb = stats.get(b.name)!;
    if (sa.matchWins !== sb.matchWins) return sb.matchWins - sa.matchWins;

    const h2h = headToHead(a, b, matches);
    if (h2h !== 0) return h2h;

    if (sa.gameWins !== sb.gameWins) return sb.gameWins - sa.gameWins;

    return coinFlipValue.get(a.name)! - coinFlipValue.get(b.name)!;
  });

  return sorted.map((team, index) => {
    const s = stats.get(team.name)!;
    return {
      team: toTeamRef(team),
      rank: index + 1,
      match_wins: s.matchWins,
      match_losses: s.matchLosses,
      game_wins: s.gameWins,
      game_losses: s.gameLosses,
    };
  });
}
