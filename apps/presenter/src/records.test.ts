import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RecordValidationError,
  parseManifest,
  parseMatchRecord,
  parseTournamentSummary,
} from './records.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(fixturesDir + name, 'utf-8'));
}

describe('parseManifest', () => {
  it('parses the hand-written dev fixture manifest', () => {
    const manifest = parseManifest(readJson('manifest.json'));
    expect(manifest.summary).toBe('summary.json');
    expect(manifest.matches).toContain('match-final.json');
  });

  it('rejects a malformed manifest', () => {
    expect(() => parseManifest({ summary: 'x.json' })).toThrow(RecordValidationError);
    expect(() => parseManifest(null)).toThrow(RecordValidationError);
  });
});

describe('parseTournamentSummary', () => {
  it('parses the hand-written dev fixture summary against the contract schema', () => {
    const summary = parseTournamentSummary(readJson('summary.json'), 'summary.json');
    expect(summary.standings).toHaveLength(4);
    expect(summary.bracket).toHaveLength(3);
  });

  it('rejects an invalid summary', () => {
    expect(() => parseTournamentSummary({ standings: 'nope' }, 'bad.json')).toThrow(
      RecordValidationError,
    );
  });
});

describe('parseMatchRecord', () => {
  it('parses every hand-written dev fixture match record against the contract schema', () => {
    const manifest = parseManifest(readJson('manifest.json'));
    for (const filename of manifest.matches) {
      const match = parseMatchRecord(readJson(filename), filename);
      expect(match.teams).toHaveLength(2);
      expect(match.games.length).toBeGreaterThan(0);
    }
  });

  it('rejects an invalid match record', () => {
    expect(() => parseMatchRecord({ match_id: 'x' }, 'bad.json')).toThrow(RecordValidationError);
  });
});
