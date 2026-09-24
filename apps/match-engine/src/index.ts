// Public API of @acm-uga/c4-match-engine.

export { ChessClock } from './clock.js';
export { createSeededRng, coinFlipSlot, shuffle, type Rng } from './rng.js';
export type { BotTransport, MoveOutcome, Team, BotProvider, BotProviderStartOptions, StartedBot } from './types.js';
export { toTeamRef } from './types.js';

export { playGame, gameWinningTeamSlot, type GameConfig, type PlayerTransports } from './game-runner.js';
export { playMatch, startupForfeitMatch, type MatchConfig, type MatchTransports } from './match-runner.js';
export { roundRobinPairings, computeStandings } from './round-robin.js';
export {
  bracketSize,
  seedOrder,
  nextPowerOfTwo,
  firstRoundPairings,
  nextRoundPairings,
  isBye,
  byeWinner,
  roundLabel,
  type BracketPairing,
} from './bracket.js';
export { runWithConcurrency, matchConcurrency } from './scheduler.js';
export { parseRosterCsv, RosterParseError } from './roster.js';
export { writeMatchRecord, writeTournamentSummary } from './output.js';

export {
  DockerContainerRuntime,
  StartupTimeoutError,
  ImageBuildError,
  type ContainerRuntime,
  type ContainerHandle,
  type StartOptions,
} from './docker/container-runtime.js';
export { HttpBotTransport } from './docker/http-bot-transport.js';
export { DockerBotProvider } from './docker/docker-bot-provider.js';
export { orchestrateMatch, type OrchestrateMatchOptions } from './match-orchestrator.js';
export { runTournament, type TournamentOptions, type TournamentResult } from './tournament-runner.js';
export { checkoutRepo, safeDirName } from './git.js';
export { validateTeam, validateAll, type ValidateOptions, type ValidateTeamResult } from './validate.js';

export { FakeBotTransport, type FakeBotScript } from './testing/fake-bot-transport.js';
export { FakeBotProvider, type FakeBotProviderOptions } from './testing/fake-bot-provider.js';
