// Orchestrates a full tournament per DESIGN.md "Tournament structure":
// round-robin (parallel matches) -> standings -> seeded single-elimination
// bracket, round by round (each round's matches run in parallel, byes
// resolved without playing). Writes one game-record file per match plus a
// tournament summary, via output.ts — "the presenter never gets anything
// else" (IMPLEMENTATION_PLAN.md).

import os from 'node:os';
import type { BracketMatch, MatchRecord, TournamentSummary } from '@acm-uga/c4-contract';
import { bracketSize, byeWinner, firstRoundPairings, isBye, nextRoundPairings, roundLabel, type BracketPairing } from './bracket.js';
import { orchestrateMatch } from './match-orchestrator.js';
import type { BotProvider } from './types.js';
import { computeStandings, roundRobinPairings } from './round-robin.js';
import { writeManifest, writeMatchRecord, writeTournamentSummary } from './output.js';
import type { Rng } from './rng.js';
import { matchConcurrency, runWithConcurrency } from './scheduler.js';
import { toTeamRef, type Team } from './types.js';

export interface TournamentOptions {
  teams: Team[];
  outputDir: string;
  provider: BotProvider;
  rng: Rng;
  /** Resolves a team to a local directory containing its (checked-out) repo. */
  resolveRepoDir: (team: Team) => Promise<string> | string;
  /** Max matches run in parallel. Defaults to DESIGN.md's host-sized formula (2 cores/match, up to 4). */
  concurrency?: number;
  /** Per-player, per-game think budget in ms. Default 10_000 per DESIGN.md. */
  thinkBudgetMs?: number;
  /** Container port the bot listens on. Default 8000. */
  botPort?: number;
  /** Off-clock startup health-check grace in ms. Default 30_000 per DESIGN.md. */
  healthGraceMs?: number;
  /** Minimum bracket slots. Default 16 per DESIGN.md ("scales to 32 if needed"). */
  minBracketSlots?: number;
}

export interface TournamentResult {
  matches: MatchRecord[];
  summary: TournamentSummary;
}

function teamRefEquals(a: { name: string }, b: { name: string }): boolean {
  return a.name === b.name;
}

export async function runTournament(options: TournamentOptions): Promise<TournamentResult> {
  const {
    teams,
    outputDir,
    provider,
    rng,
    resolveRepoDir,
    concurrency = matchConcurrency(os.cpus().length),
    thinkBudgetMs,
    botPort,
    healthGraceMs,
    minBracketSlots = 16,
  } = options;

  // ---- Round robin -----------------------------------------------------
  const pairings = roundRobinPairings(teams);
  const rrJobs = pairings.map(([a, b], index) => async () => {
    const matchId = `rr-${String(index + 1).padStart(3, '0')}`;
    const [repoDirA, repoDirB] = await Promise.all([resolveRepoDir(a), resolveRepoDir(b)]);
    const record = await orchestrateMatch({
      matchId,
      phase: 'roundrobin',
      teams: [a, b],
      repoDirs: [repoDirA, repoDirB],
      provider,
      rng,
      thinkBudgetMs,
      botPort,
      healthGraceMs,
    });
    await writeMatchRecord(outputDir, record);
    return record;
  });
  const roundRobinMatches = await runWithConcurrency(rrJobs, concurrency);

  // ---- Standings ---------------------------------------------------------
  const standings = computeStandings(teams, roundRobinMatches, rng);
  const rankedTeams = standings.map((entry) => teams.find((t) => teamRefEquals(t, entry.team))!);

  // ---- Bracket, round by round --------------------------------------------
  const bracketMatches: MatchRecord[] = [];
  const bracketSummary: BracketMatch[] = [];

  if (rankedTeams.length > 0) {
    let currentPairings: BracketPairing[] = firstRoundPairings(rankedTeams, minBracketSlots);
    let teamsEnteringRound = bracketSize(rankedTeams.length, minBracketSlots);

    for (;;) {
      const label = roundLabel(teamsEnteringRound);
      const jobs = currentPairings.map((pairing) => async (): Promise<Team | null> => {
        if (isBye(pairing)) {
          const winner = byeWinner(pairing);
          bracketSummary.push({
            match_id: null,
            round: label,
            slot: pairing.slot,
            team_a: pairing.teamA ? toTeamRef(pairing.teamA) : null,
            team_b: pairing.teamB ? toTeamRef(pairing.teamB) : null,
            winner: winner ? toTeamRef(winner) : null,
            bye: true,
          });
          return winner;
        }

        if (!pairing.teamA || !pairing.teamB) {
          // Both sides undetermined (shouldn't happen given we resolve each round fully before building the next), recorded defensively.
          bracketSummary.push({ match_id: null, round: label, slot: pairing.slot, team_a: null, team_b: null, winner: null, bye: false });
          return null;
        }

        const matchId = `bracket-${label.toLowerCase().replace(/\s+/g, '-')}-${pairing.slot + 1}`;
        const [repoDirA, repoDirB] = await Promise.all([resolveRepoDir(pairing.teamA), resolveRepoDir(pairing.teamB)]);
        const record = await orchestrateMatch({
          matchId,
          phase: 'bracket',
          round: label,
          teams: [pairing.teamA, pairing.teamB],
          repoDirs: [repoDirA, repoDirB],
          provider,
          rng,
          thinkBudgetMs,
          botPort,
          healthGraceMs,
        });
        await writeMatchRecord(outputDir, record);
        bracketMatches.push(record);

        const winnerTeam = record.result.winner_team === 0 ? pairing.teamA : pairing.teamB;
        bracketSummary.push({
          match_id: record.match_id,
          round: label,
          slot: pairing.slot,
          team_a: toTeamRef(pairing.teamA),
          team_b: toTeamRef(pairing.teamB),
          winner: toTeamRef(winnerTeam),
          bye: false,
        });
        return winnerTeam;
      });

      const winners = await runWithConcurrency(jobs, concurrency);

      if (currentPairings.length === 1) break; // the final has been played

      currentPairings = nextRoundPairings(winners);
      teamsEnteringRound = teamsEnteringRound / 2;
    }
  }

  const summary: TournamentSummary = {
    standings,
    bracket: bracketSummary,
    generated_at: new Date().toISOString(),
  };
  await writeTournamentSummary(outputDir, summary);

  const allMatches = [...roundRobinMatches, ...bracketMatches];
  await writeManifest(outputDir, allMatches.map((m) => m.match_id));

  return { matches: allMatches, summary };
}
