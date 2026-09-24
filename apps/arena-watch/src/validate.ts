import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RosterTeam, ValidateResult } from './types.js';

const execFileAsync = promisify(execFile);

export interface RunValidateFn {
  (team: RosterTeam): Promise<ValidateResult>;
}

export interface EngineValidateOptions {
  engineBin: string;
  timeoutMs: number;
}

/**
 * Runs `node <engineBin> validate --roster <tmp-one-team.json> --json` for a
 * single team and parses the one-row result. Each call gets its own temp
 * roster file + workdir so concurrent teams never collide.
 */
export function makeEngineValidate(opts: EngineValidateOptions): RunValidateFn {
  return async (team: RosterTeam): Promise<ValidateResult> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'c4-watch-'));
    const rosterPath = path.join(dir, 'roster.json');
    try {
      await writeFile(
        rosterPath,
        JSON.stringify({ teams: [team] }),
        'utf8',
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        [opts.engineBin, 'validate', '--roster', rosterPath, '--json'],
        { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      );
      const rows = JSON.parse(stdout) as ValidateResult[];
      const row = rows[0];
      if (!row) throw new Error('validate --json returned no rows for team');
      return row;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
