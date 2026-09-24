// Script to synthesize a full plausible tournament for presenter rehearsal.
// Generates 12 fake teams with varying strengths, runs them through
// round-robin and bracket, emitting contract-valid game records into fixtures/.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Board,
  type Player,
  emptyBoard,
  applyMove,
  checkWin,
  isDraw,
} from '@connect-4/engine';
import {
  type GameRecord,
  type MatchRecord,
  type TournamentSummary,
  MatchRecordSchema,
  TournamentSummarySchema,
  type GameOutcome,
} from '@connect-4/contract';
import { randomBot, greedyBot, minimaxBot } from '@connect-4/practice-bots';
import {
  roundRobinPairings,
  computeStandings,
  firstRoundPairings,
  nextRoundPairings,
  roundLabel,
  createSeededRng,
  coinFlipSlot,
  toTeamRef,
  type Team,
} from '@connect-4/match-engine';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

// Define bot strategies at varying strengths
type BotStrategy = (board: Board, you: Player) => number;

interface FakeTeam {
  readonly name: string;
  readonly repoUrl: string;
  readonly strategy: BotStrategy;
}

// Create 12 fake teams with varying strengths
function createFakeTeams(): FakeTeam[] {
  return [
    { name: 'Random Alpha', repoUrl: 'https://github.com/fake/random-alpha', strategy: randomBot },
    { name: 'Random Beta', repoUrl: 'https://github.com/fake/random-beta', strategy: randomBot },
    { name: 'Greedy Gamma', repoUrl: 'https://github.com/fake/greedy-gamma', strategy: greedyBot },
    { name: 'Greedy Delta', repoUrl: 'https://github.com/fake/greedy-delta', strategy: greedyBot },
    { name: 'Greedy Epsilon', repoUrl: 'https://github.com/fake/greedy-epsilon', strategy: greedyBot },
    { name: 'Minimax Zeta', repoUrl: 'https://github.com/fake/minimax-zeta', strategy: minimaxBot },
    { name: 'Minimax Eta', repoUrl: 'https://github.com/fake/minimax-eta', strategy: minimaxBot },
    { name: 'Minimax Theta', repoUrl: 'https://github.com/fake/minimax-theta', strategy: minimaxBot },
    { name: 'Minimax Iota', repoUrl: 'https://github.com/fake/minimax-iota', strategy: minimaxBot },
    { name: 'Hybrid Kappa', repoUrl: 'https://github.com/fake/hybrid-kappa', strategy: greedyBot },
    { name: 'Hybrid Lambda', repoUrl: 'https://github.com/fake/hybrid-lambda', strategy: greedyBot },
    { name: 'Hybrid Mu', repoUrl: 'https://github.com/fake/hybrid-mu', strategy: minimaxBot },
  ];
}

// Play a single game between two teams
function playGame(
  teamA: FakeTeam,
  teamB: FakeTeam,
  firstPlayer: Player,
): { moves: number[]; outcome: GameOutcome; clockEvents: any[] } {
  let board = emptyBoard();
  const moves: number[] = [];
  const clockEvents: any[] = [];
  let currentPlayer = firstPlayer;

  while (true) {
    // Check for win or draw before playing
    const win = checkWin(board);
    if (win) {
      const outcome: GameOutcome = {
        type: 'four_in_a_row',
        winner: win.player,
      };
      return { moves, outcome, clockEvents };
    }
    if (isDraw(board)) {
      const outcome: GameOutcome = { type: 'draw' };
      return { moves, outcome, clockEvents };
    }

    // Get move from current player's strategy
    const team = currentPlayer === 1 ? teamA : teamB;
    const column = team.strategy(board, currentPlayer);

    // Apply the move
    board = applyMove(board, column, currentPlayer);
    moves.push(column);

    // Switch player
    currentPlayer = currentPlayer === 1 ? 2 : 1;
  }
}

// Play a best-of-3 match
function playMatch(
  teamA: FakeTeam,
  teamB: FakeTeam,
  matchId: string,
  rng: ReturnType<typeof createSeededRng>,
  phase: 'roundrobin' | 'bracket' = 'roundrobin',
): MatchRecord {
  const games: GameRecord[] = [];
  let aWins = 0;
  let bWins = 0;

  for (let gameNum = 1; gameNum <= 3; gameNum++) {
    // Determine first player
    let firstPlayer: Player;
    let coinFlip: boolean;

    if (gameNum === 1) {
      // Game 1: coin flip
      const slot = coinFlipSlot(rng);
      firstPlayer = slot === 0 ? 1 : 2;
      coinFlip = true;
    } else {
      // Alternating: if team A (slot 0) went first last game, team B goes first now
      const lastFirstPlayerWasSlot0 = games[gameNum - 2]!.first_player_team === 0;
      const thisFirstPlayerSlot = lastFirstPlayerWasSlot0 ? 1 : 0;
      firstPlayer = thisFirstPlayerSlot === 0 ? 1 : 2;
      coinFlip = false;
    }

    const firstPlayerTeam = firstPlayer === 1 ? 0 : 1;

    const { moves, outcome, clockEvents } = playGame(teamA, teamB, firstPlayer);

    const gameRecord: GameRecord = {
      game_number: gameNum,
      first_player: firstPlayer,
      first_player_team: firstPlayerTeam as 0 | 1,
      coin_flip: coinFlip,
      moves: moves.map((col, idx) => {
        // Alternate players: even indices are firstPlayer, odd indices are opponent
        const movePlayer = idx % 2 === 0 ? firstPlayer : (firstPlayer === 1 ? 2 : 1);
        return {
          player: movePlayer,
          column: col,
          think_ms: Math.floor(Math.random() * 100) + 10, // simulate 10-110ms think time
        };
      }),
      clock_events: clockEvents,
      outcome,
    };

    games.push(gameRecord);

    // Track wins
    if (outcome.type === 'four_in_a_row') {
      if (outcome.winner === 1) aWins++;
      else bWins++;
    } else if (outcome.type === 'forfeit') {
      if (outcome.winner === 1) aWins++;
      else bWins++;
    }
    // draws don't count

    // Check if match is over (first to 2 wins)
    if (aWins > 1 || bWins > 1) {
      break;
    }
  }

  // Determine winner
  let winnerTeam: 0 | 1;
  if (aWins > bWins) {
    winnerTeam = 0;
  } else {
    winnerTeam = 1;
  }

  const matchRecord: MatchRecord = {
    match_id: matchId,
    phase,
    teams: [toTeamRef(teamA), toTeamRef(teamB)],
    games,
    result: {
      winner_team: winnerTeam,
      games_won: [aWins, bWins],
      reason: 'played',
    },
  };

  return matchRecord;
}

// Generate all fixtures
function generateFixtures() {
  // Create fixtures directory
  mkdirSync(FIXTURES_DIR, { recursive: true });

  // Create seeded RNG for determinism
  const rng = createSeededRng(42);

  // Create fake teams
  const teams = createFakeTeams();
  console.log(`Created ${teams.length} fake teams`);

  // Generate round-robin matches
  const pairings = roundRobinPairings(teams as unknown as Team[]);
  console.log(`Round-robin has ${pairings.length} matches`);

  const matchRecords: MatchRecord[] = [];

  for (let i = 0; i < pairings.length; i++) {
    const [teamA, teamB] = pairings[i]!;
    const matchId = `rr-${String(i + 1).padStart(3, '0')}`;

    const fakeTeamA = teamA as FakeTeam;
    const fakeTeamB = teamB as FakeTeam;

    const matchRecord = playMatch(fakeTeamA, fakeTeamB, matchId, rng);

    // Validate match record
    const parseResult = MatchRecordSchema.safeParse(matchRecord);
    if (!parseResult.success) {
      console.error(`Match ${matchId} failed validation:`, parseResult.error);
      process.exit(1);
    }

    matchRecords.push(matchRecord);

    // Write match file
    const filename = resolve(FIXTURES_DIR, `${matchId}.json`);
    writeFileSync(filename, JSON.stringify(matchRecord, null, 2));
    console.log(`Wrote ${filename}`);
  }

  // Compute standings
  const standings = computeStandings(teams as unknown as Team[], matchRecords, rng);
  console.log(`Computed standings for ${standings.length} teams`);

  // Generate bracket
  const bracketTeams = standings.map((s: typeof standings[0]) => {
    const team = teams.find((t) => t.name === s.team.name);
    if (!team) throw new Error(`Team ${s.team.name} not found`);
    return team;
  });

  // Create a map from team name to FakeTeam for quick lookup
  const teamMap = new Map(teams.map((t) => [t.name, t]));

  // Play bracket rounds
  let currentRoundTeams: Team[] = bracketTeams;
  let roundNum = 0;

  const bracketMatches: Array<{
    matchId: string | null;
    round: string;
    slot: number;
    teamA: FakeTeam | null;
    teamB: FakeTeam | null;
    winner: FakeTeam | null;
  }> = [];

  while (currentRoundTeams.length > 1) {
    roundNum++;
    const currentRound = roundLabel(currentRoundTeams.length);
    console.log(`Playing bracket ${currentRound}`);

    const pairings = roundNum === 1 ? firstRoundPairings(currentRoundTeams) : nextRoundPairings(currentRoundTeams);

    const roundWinners: (Team | null)[] = [];

    for (const pairing of pairings) {
      if (pairing.teamA === null || pairing.teamB === null) {
        // This is a bye
        const winner = pairing.teamA ?? pairing.teamB;
        roundWinners.push(winner);

        bracketMatches.push({
          matchId: null, // byes have no game record
          round: currentRound,
          slot: pairing.slot,
          teamA: pairing.teamA ? (teamMap.get(pairing.teamA.name) || null) : null,
          teamB: pairing.teamB ? (teamMap.get(pairing.teamB.name) || null) : null,
          winner: winner ? (teamMap.get(winner.name) || null) : null,
        });

        continue;
      }

      const teamA = teamMap.get(pairing.teamA.name)!;
      const teamB = teamMap.get(pairing.teamB.name)!;
      const matchId = `bracket-${roundNum}-${pairing.slot}`;

      const matchRecord = playMatch(teamA, teamB, matchId, rng, 'bracket');

      // Validate match record
      const parseResult = MatchRecordSchema.safeParse(matchRecord);
      if (!parseResult.success) {
        console.error(`Match ${matchId} failed validation:`, parseResult.error);
        process.exit(1);
      }

      matchRecords.push(matchRecord);

      // Write match file
      const filename = resolve(FIXTURES_DIR, `${matchId}.json`);
      writeFileSync(filename, JSON.stringify(matchRecord, null, 2));
      console.log(`Wrote ${filename}`);

      // Determine winner
      const winner = matchRecord.result.winner_team === 0 ? teamA : teamB;
      roundWinners.push(winner);

      bracketMatches.push({
        matchId,
        round: currentRound,
        slot: pairing.slot,
        teamA,
        teamB,
        winner,
      });
    }

    currentRoundTeams = roundWinners.filter((w) => w !== null) as Team[];
  }

  // Create tournament summary
  const tournamentSummary: TournamentSummary = {
    standings: standings,
    bracket: bracketMatches.map((m) => ({
      match_id: m.matchId,
      round: m.round,
      slot: m.slot,
      team_a: m.teamA ? toTeamRef(m.teamA) : null,
      team_b: m.teamB ? toTeamRef(m.teamB) : null,
      winner: m.winner ? toTeamRef(m.winner) : null,
      bye: (m.teamA === null) !== (m.teamB === null),
    })),
    generated_at: new Date().toISOString(),
  };

  // Validate tournament summary
  const summaryParseResult = TournamentSummarySchema.safeParse(tournamentSummary);
  if (!summaryParseResult.success) {
    console.error('Tournament summary failed validation:', summaryParseResult.error);
    process.exit(1);
  }

  // Write tournament summary
  const summaryFilename = resolve(FIXTURES_DIR, 'tournament-summary.json');
  writeFileSync(summaryFilename, JSON.stringify(tournamentSummary, null, 2));
  console.log(`Wrote ${summaryFilename}`);

  // Write manifest.json — the presenter's entry point into this directory.
  // Shape must match the presenter's Manifest type (records.ts) and the
  // match engine's writeManifest (packages/match-engine/src/output.ts).
  const manifest = {
    summary: 'tournament-summary.json',
    matches: matchRecords.map((m) => `${m.match_id}.json`),
  };
  const manifestFilename = resolve(FIXTURES_DIR, 'manifest.json');
  writeFileSync(manifestFilename, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifestFilename}`);

  console.log(`\nFixtures generated successfully in ${FIXTURES_DIR}`);
  console.log(`- ${matchRecords.length} match records`);
  console.log(`- 1 tournament summary + manifest.json`);
}

generateFixtures();
