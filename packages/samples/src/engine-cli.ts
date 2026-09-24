// Thin wrapper around the match-engine CLI, coded against the *documented*
// interface from EVENT_PLAN.md (not yet on this branch — A1a lands it
// separately):
//
//   c4 freeze --roster <src> --output lock.json
//   c4 run-tournament --roster <src> --lock lock.json --output <dir>
//     --bundle <file> [--seed n] [--think-ms n]
//   c4 validate --json
//
// Kept behind an interface (`EngineCli`) so run.ts's orchestration logic is
// unit-testable with a fake before the real CLI flags exist.

import { spawn } from 'node:child_process';

export interface FreezeOptions {
  rosterPath: string;
  lockPath: string;
}

export interface RunTournamentOptions {
  rosterPath: string;
  lockPath: string;
  outputDir: string;
  bundlePath: string;
  seed?: number;
  thinkMs?: number;
}

export interface EngineCli {
  freeze(opts: FreezeOptions): Promise<void>;
  runTournament(opts: RunTournamentOptions): Promise<void>;
}

function runCli(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`c4 ${args.join(' ')} exited ${code}`))));
  });
}

/**
 * Real CLI backed by apps/match-engine/dist/cli.js. Prefer CLI over the
 * programmatic API for realism (this is meant to exercise the exact path a
 * live event run takes).
 */
export class RealEngineCli implements EngineCli {
  constructor(
    private readonly cliBin: string,
    private readonly cwd: string = process.cwd(),
  ) {}

  async freeze(opts: FreezeOptions): Promise<void> {
    await runCli(this.cliBin, ['freeze', '--roster', opts.rosterPath, '--output', opts.lockPath], this.cwd);
  }

  async runTournament(opts: RunTournamentOptions): Promise<void> {
    const args = [
      'run-tournament',
      '--roster',
      opts.rosterPath,
      '--lock',
      opts.lockPath,
      '--output',
      opts.outputDir,
      '--bundle',
      opts.bundlePath,
    ];
    if (opts.seed !== undefined) args.push('--seed', String(opts.seed));
    if (opts.thinkMs !== undefined) args.push('--think-ms', String(opts.thinkMs));
    await runCli(this.cliBin, args, this.cwd);
  }
}
