import { readdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MatchRecordSchema, TournamentSummarySchema } from '@connect-4/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRng } from './rng.js';
import { runTournament } from './tournament-runner.js';
import { FakeBotProvider } from './testing/fake-bot-provider.js';
import type { FakeBotTransportOptions } from './testing/fake-bot-transport.js';
import type { Team } from './types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'c4-tournament-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Each team is assigned a distinct dedicated column so whoever moves first in a given game reliably wins it (see game-runner.test.ts for why). Good enough to exercise orchestration without asserting who "should" win by skill. */
function makeTeams(names: string[]): Team[] {
  return names.map((name) => ({ name, repoUrl: `https://github.com/example/${name}` }));
}

function transportsFor(teams: Team[]): Record<string, FakeBotTransportOptions> {
  const entries = teams.map((team, i) => [team.repoUrl, { script: () => ({ type: 'ok' as const, column: i }) }] as const);
  return Object.fromEntries(entries);
}

describe('runTournament', () => {
  it('plays a full round robin + bracket for a field that exactly fills the bracket, with no byes', async () => {
    const teams = makeTeams(['T1', 'T2', 'T3', 'T4']);
    const provider = new FakeBotProvider({ transports: transportsFor(teams) });

    const result = await runTournament({
      teams,
      outputDir: dir,
      provider,
      rng: createSeededRng(1),
      resolveRepoDir: (team) => team.repoUrl,
      minBracketSlots: 4,
      concurrency: 2,
    });

    // Round robin: C(4,2) = 6 matches.
    const rrMatches = result.matches.filter((m) => m.phase === 'roundrobin');
    expect(rrMatches).toHaveLength(6);

    // Bracket: 4 teams, no byes -> semifinal (2 matches) + final (1 match) = 3.
    const bracketMatches = result.matches.filter((m) => m.phase === 'bracket');
    expect(bracketMatches).toHaveLength(3);
    expect(bracketMatches.map((m) => m.round).sort()).toEqual(['Final', 'Semifinal', 'Semifinal']);

    expect(result.summary.standings).toHaveLength(4);
    expect(result.summary.standings.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    expect(result.summary.bracket.filter((b) => !b.bye)).toHaveLength(3);
    expect(result.summary.bracket.every((b) => !b.bye)).toBe(true);

    // Every match record + the tournament summary + the presenter's
    // manifest were written; records and summary are schema-valid and the
    // manifest points at exactly the files that exist.
    const files = await readdir(dir);
    expect(files).toContain('tournament-summary.json');
    expect(files).toContain('manifest.json');
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(6 + 3 + 2);

    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.summary).toBe('tournament-summary.json');
    expect([...manifest.matches].sort()).toEqual(
      files.filter((f) => f !== 'tournament-summary.json' && f !== 'manifest.json').sort(),
    );

    for (const file of files) {
      if (file === 'manifest.json') continue;
      const contents = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      if (file === 'tournament-summary.json') {
        expect(() => TournamentSummarySchema.parse(contents)).not.toThrow();
      } else {
        expect(() => MatchRecordSchema.parse(contents)).not.toThrow();
      }
    }
  });

  it('resolves byes without starting any bots for them, when the field is smaller than the bracket', async () => {
    const teams = makeTeams(['T1', 'T2', 'T3']);
    const provider = new FakeBotProvider({ transports: transportsFor(teams) });

    const result = await runTournament({
      teams,
      outputDir: dir,
      provider,
      rng: createSeededRng(2),
      resolveRepoDir: (team) => team.repoUrl,
      minBracketSlots: 4,
      concurrency: 2,
    });

    const rrMatches = result.matches.filter((m) => m.phase === 'roundrobin');
    const bracketMatches = result.matches.filter((m) => m.phase === 'bracket');
    // 4-slot bracket, 3 real teams -> round 1 has one bye + one real match; final is the 2nd (bracket) match played.
    expect(bracketMatches).toHaveLength(2);

    const byeEntries = result.summary.bracket.filter((b) => b.bye);
    expect(byeEntries).toHaveLength(1);
    expect(byeEntries[0].winner).not.toBeNull();
    expect(byeEntries[0].match_id).toBeNull();

    // A bye never starts a bot (no wasted container): total starts == 2 per *played* match only.
    expect(provider.startedRepoDirs).toHaveLength((rrMatches.length + bracketMatches.length) * 2);
  });
});
