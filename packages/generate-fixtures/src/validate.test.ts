// Test that generated fixtures validate against contract schemas.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchRecordSchema, TournamentSummarySchema } from '@acm-uga/c4-contract';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

describe('Generated fixtures validation', () => {
  it('should have generated fixture files', () => {
    const files = readdirSync(FIXTURES_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('should validate all match records against MatchRecordSchema', () => {
    const files = readdirSync(FIXTURES_DIR);
    const matchFiles = files.filter(
      (f) => f.endsWith('.json') && f !== 'tournament-summary.json' && f !== 'manifest.json',
    );

    expect(matchFiles.length).toBeGreaterThan(0);

    for (const file of matchFiles) {
      const path = resolve(FIXTURES_DIR, file);
      const content = readFileSync(path, 'utf-8');
      const record = JSON.parse(content);

      const result = MatchRecordSchema.safeParse(record);
      expect(result.success).toBe(true, `${file} should validate against MatchRecordSchema. Errors: ${JSON.stringify(result.error)}`);
    }
  });

  it('should validate tournament summary against TournamentSummarySchema', () => {
    const summaryPath = resolve(FIXTURES_DIR, 'tournament-summary.json');
    const content = readFileSync(summaryPath, 'utf-8');
    const summary = JSON.parse(content);

    const result = TournamentSummarySchema.safeParse(summary);
    expect(result.success).toBe(true, `tournament-summary.json should validate. Errors: ${JSON.stringify(result.error)}`);
  });

  it('should have 77 match records, a tournament summary, and a manifest', () => {
    const files = readdirSync(FIXTURES_DIR);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const matchFiles = jsonFiles.filter((f) => f !== 'tournament-summary.json' && f !== 'manifest.json');

    // 66 round-robin + 11 bracket matches
    expect(matchFiles.length).toBe(77);
    expect(jsonFiles.includes('tournament-summary.json')).toBe(true);

    // manifest.json is the presenter's entry point: it must list exactly
    // the match files that exist and point at the summary.
    const manifest = JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.summary).toBe('tournament-summary.json');
    expect([...manifest.matches].sort()).toEqual([...matchFiles].sort());
  });
});
