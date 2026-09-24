import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  parseMatchRecord,
  parseTournamentBundle,
  parseTournamentSummary,
  RecordValidationError,
  tournamentDataFromBundle,
} from './records.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(fixturesDir + name, 'utf-8'));
}

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = parseManifest(readJson('manifest.json'));
    expect(manifest.summary).toBe('summary.json');
    expect(manifest.matches.length).toBeGreaterThan(0);
  });

  it('rejects a manifest missing the required shape', () => {
    expect(() => parseManifest({ summary: 'x' })).toThrow(RecordValidationError);
    expect(() => parseManifest({ matches: [] })).toThrow(RecordValidationError);
    expect(() => parseManifest(null)).toThrow(RecordValidationError);
  });
});

describe('parseTournamentSummary', () => {
  it('accepts a valid summary', () => {
    const summary = parseTournamentSummary(readJson('summary.json'), 'summary.json');
    expect(summary.standings.length).toBeGreaterThan(0);
    expect(summary.bracket.length).toBeGreaterThan(0);
  });

  it('rejects an invalid summary with a RecordValidationError naming the source', () => {
    expect(() => parseTournamentSummary({}, 'bad-summary.json')).toThrowError(/bad-summary\.json/);
  });
});

describe('parseMatchRecord', () => {
  it('accepts a valid match record', () => {
    const match = parseMatchRecord(readJson('match-rr-1.json'), 'match-rr-1.json');
    expect(match.match_id).toBe('rr-1');
  });

  it('rejects a record with the old forfeit_detail field shape (superseded by forfeits[])', () => {
    const stale = {
      match_id: 'm1',
      phase: 'bracket',
      teams: [
        { name: 'A', repo_url: 'https://example.com/a' },
        { name: 'B', repo_url: 'https://example.com/b' },
      ],
      games: [],
      result: {
        winner_team: 0,
        games_won: [0, 0],
        reason: 'forfeit',
        forfeit_detail: { team: 1, reason: 'startup_timeout' },
      },
    };
    expect(() => parseMatchRecord(stale, 'stale.json')).toThrow(RecordValidationError);
  });

  it('accepts a double-forfeit match record (winner_team: null, two forfeits)', () => {
    const doubleForfeit = {
      match_id: 'm1',
      phase: 'roundrobin',
      teams: [
        { name: 'A', repo_url: 'https://example.com/a' },
        { name: 'B', repo_url: 'https://example.com/b' },
      ],
      games: [],
      result: {
        winner_team: null,
        games_won: [0, 0],
        reason: 'forfeit',
        forfeits: [
          { team: 0, reason: 'startup_timeout' },
          { team: 1, reason: 'build_failed' },
        ],
      },
    };
    const parsed = parseMatchRecord(doubleForfeit, 'double.json');
    expect(parsed.result.winner_team).toBeNull();
    expect(parsed.result.forfeits).toHaveLength(2);
  });
});

describe('parseTournamentBundle / tournamentDataFromBundle', () => {
  it('accepts the rehearsal edge-case bundle and reshapes it to TournamentData', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    expect(bundle.format).toBe('c4-tournament-bundle');
    expect(bundle.version).toBe(1);
    expect(bundle.matches.length).toBeGreaterThan(0);

    const data = tournamentDataFromBundle(bundle);
    expect(data.summary).toBe(bundle.summary);
    expect(data.matches).toBe(bundle.matches);
  });

  it('the bundle carries every single-team match forfeit reason at least once', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    const singleForfeitReasons = bundle.matches
      .filter((m) => m.result.forfeits?.length === 1)
      .map((m) => m.result.forfeits![0]!.reason);
    expect(new Set(singleForfeitReasons)).toEqual(new Set(['startup_timeout', 'build_failed', 'checkout_failed']));
  });

  it('the bundle carries a double forfeit in round robin and in the bracket', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    const doubleForfeits = bundle.matches.filter((m) => m.result.winner_team === null);
    expect(doubleForfeits.map((m) => m.phase).sort()).toEqual(['bracket', 'bracket', 'roundrobin']);
  });

  it('the bundle carries a bracket bye slot (the double-forfeit walkover)', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    const bye = bundle.summary.bracket.find((m) => m.bye);
    expect(bye).toBeDefined();
    expect(bye!.match_id).toBeNull();
    expect(bye!.winner).not.toBeNull();
  });

  it('the bundle carries a double-forfeit final (no champion)', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    const final = bundle.summary.bracket.find((m) => m.round === 'Final')!;
    expect(final.winner).toBeNull();
  });

  it('rejects a non-bundle payload', () => {
    expect(() => parseTournamentBundle({ foo: 'bar' }, 'not-a-bundle.json')).toThrow(RecordValidationError);
  });

  it('rejects a bundle with the wrong format/version tag', () => {
    const bundle = parseTournamentBundle(readJson('tournament.json'), 'tournament.json');
    expect(() => parseTournamentBundle({ ...bundle, format: 'something-else' }, 'x.json')).toThrow(
      RecordValidationError,
    );
    expect(() => parseTournamentBundle({ ...bundle, version: 2 }, 'x.json')).toThrow(RecordValidationError);
  });
});
