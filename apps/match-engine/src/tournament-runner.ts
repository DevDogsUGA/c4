// Orchestrates a full tournament per DESIGN.md "Tournament structure":
// round-robin (parallel matches) -> standings -> seeded single-elimination
// bracket, round by round (each round's matches run in parallel, byes
// resolved without playing). Writes one game-record file per match plus a
// tournament summary, via output.ts — "the presenter never gets anything
// else" (IMPLEMENTATION_PLAN.md).

import os from 'node:os';
import path from 'node:path';
import { THINK_BUDGET_MS, type BracketMatch, type MatchForfeitReason, type MatchRecord, type TournamentBundle, type TournamentSummary } from '@acm-uga/c4-contract';
import { bracketSize, byeWinner, firstRoundPairings, isBye, nextRoundPairings, roundLabel, type BracketPairing } from './bracket.js';
import { orchestrateMatch } from './match-orchestrator.js';
import type { BotProvider } from './types.js';
import { buildTournamentBundle, writeManifest, writeMatchRecord, writeTournamentBundle, writeTournamentSummary } from './output.js';
import { computeStandings, roundRobinPairings } from './round-robin.js';
import type { Rng } from './rng.js';
import { matchConcurrency, runWithConcurrency } from './scheduler.js';
import { toTeamRef, type Team } from './types.js';

export interface TournamentOptions {
  teams: Team[];
  outputDir: string;
  provider: BotProvider;
  rng: Rng;
  /**
   * Resolves a team to a local directory containing its (checked-out)
   * repo. Called exactly ONCE per team, up front, before any match is
   * played — not per match (per-match resolution both re-does checkout
   * work needlessly and risks two concurrent matches running `git` in the
   * same team's working directory). Use prepare.ts's `prepareTeams` (via
   * the CLI's `--lock` / implicit-freeze path) for the full
   * checkout-once-at-an-exact-commit workflow; this hook is intentionally
   * still swappable for tests and simpler callers.
   */
  resolveRepoDir: (team: Team) => Promise<string> | string;
  /**
   * Per-team match-level forfeits determined ahead of time (e.g. by
   * prepare.ts) — a team with an entry here never has `resolveRepoDir`
   * called for it and never gets a bot started; every match it's part of
   * is recorded as a forfeit with this reason. Keyed by `Team.name`.
   */
  preparedForfeits?: ReadonlyMap<string, MatchForfeitReason>;
  /** Max matches run in parallel. Defaults to EVENT_PLAN.md's host-sized formula (2 cores/match, 2 reserved). */
  concurrency?: number;
  /** Per-player, per-game think budget in ms. Default THINK_BUDGET_MS (5s) per EVENT_PLAN.md. */
  thinkBudgetMs?: number;
  /** Container port the bot listens on. Default 8000. */
  botPort?: number;
  /** Off-clock startup health-check grace in ms. Default 30_000 per DESIGN.md. */
  healthGraceMs?: number;
  /** Minimum bracket slots. Default 16 per DESIGN.md ("scales to 32 if needed"). */
  minBracketSlots?: number;
  /** Free-form run metadata (CLI settings, lock file hash, etc) embedded in the bundle's `provenance`. Never read by the presenter. */
  provenance?: Record<string, unknown>;
  /** If set, additionally writes a validated TournamentBundle to this path (on top of the bundle always written into `outputDir/tournament.json`). */
  bundlePath?: string;
}

export interface TournamentResult {
  matches: MatchRecord[];
  summary: TournamentSummary;
  bundle: TournamentBundle;
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
    preparedForfeits,
    concurrency = matchConcurrency(os.cpus().length),
    thinkBudgetMs = THINK_BUDGET_MS,
    botPort,
    healthGraceMs,
    minBracketSlots = 16,
    provenance,
    bundlePath,
  } = options;

  // ---- Prepare: resolve each team's repo dir exactly ONCE, up front ------
  // (not per match — avoids redundant checkout work and concurrent `git`
  // in the same team's working directory). A team with a preparedForfeits
  // entry skips resolution entirely; every match it plays forfeits
  // immediately per match-orchestrator.ts's `preForfeits`.
  const repoDirs = new Map<string, string>();
  await Promise.all(
    teams
      .filter((t) => !preparedForfeits?.has(t.name))
      .map(async (t) => {
        repoDirs.set(t.name, await resolveRepoDir(t));
      }),
  );

  function preForfeitsFor(a: Team, b: Team): [MatchForfeitReason | undefined, MatchForfeitReason | undefined] | undefined {
    const fa = preparedForfeits?.get(a.name);
    const fb = preparedForfeits?.get(b.name);
    if (!fa && !fb) return undefined;
    return [fa, fb];
  }

  // ---- Round robin -----------------------------------------------------
  const pairings = roundRobinPairings(teams);
  const rrJobs = pairings.map(([a, b], index) => async () => {
    const matchId = `rr-${String(index + 1).padStart(3, '0')}`;
    const record = await orchestrateMatch({
      matchId,
      phase: 'roundrobin',
      teams: [a, b],
      repoDirs: [repoDirs.get(a.name) ?? '', repoDirs.get(b.name) ?? ''],
      provider,
      rng,
      thinkBudgetMs,
      botPort,
      healthGraceMs,
      preForfeits: preForfeitsFor(a, b),
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
        const record = await orchestrateMatch({
          matchId,
          phase: 'bracket',
          round: label,
          teams: [pairing.teamA, pairing.teamB],
          repoDirs: [repoDirs.get(pairing.teamA.name) ?? '', repoDirs.get(pairing.teamB.name) ?? ''],
          provider,
          rng,
          thinkBudgetMs,
          botPort,
          healthGraceMs,
          preForfeits: preForfeitsFor(pairing.teamA, pairing.teamB),
        });
        await writeMatchRecord(outputDir, record);
        bracketMatches.push(record);

        // A double forfeit (winner_team null) eliminates both teams: no
        // winner advances. `winners` flowing into nextRoundPairings treats
        // null exactly like a bye slot, so the next-round opponent (if any)
        // automatically advances as a bye per EVENT_PLAN.md ("their
        // next-round opponent advances as a bye"). If this was the final,
        // the loop below breaks with no champion (winner: null).
        const winnerTeam =
          record.result.winner_team === null ? null : record.result.winner_team === 0 ? pairing.teamA : pairing.teamB;
        bracketSummary.push({
          match_id: record.match_id,
          round: label,
          slot: pairing.slot,
          team_a: toTeamRef(pairing.teamA),
          team_b: toTeamRef(pairing.teamB),
          winner: winnerTeam ? toTeamRef(winnerTeam) : null,
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

  // Single-file export: always written into the output dir alongside the
  // per-match files + manifest, per EVENT_PLAN.md's Output section; an
  // extra copy at `bundlePath` supports `--bundle <file>` and R2 upload.
  const bundle = buildTournamentBundle(summary, allMatches, provenance);
  await writeTournamentBundle(path.join(outputDir, 'tournament.json'), bundle);
  if (bundlePath) {
    await writeTournamentBundle(bundlePath, bundle);
  }

  return { matches: allMatches, summary, bundle };
}
