// Writes the match engine's entire output: one game-record JSON file per
// match plus a tournament summary file, into an output directory. Per
// DESIGN.md, this directory IS the interface to the presenter — nothing
// else crosses that boundary — so every write is validated against the
// contract schema first; a record that doesn't validate is a match-engine
// bug and must fail loudly rather than hand the presenter something bad.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MatchRecordSchema,
  TournamentBundleSchema,
  TournamentSummarySchema,
  type MatchRecord,
  type TournamentBundle,
  type TournamentSummary,
} from '@acm-uga/c4-contract';

function safeFileName(matchId: string): string {
  return matchId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function matchRecordFileName(matchId: string): string {
  return `${safeFileName(matchId)}.json`;
}

export async function writeMatchRecord(outputDir: string, record: MatchRecord): Promise<string> {
  const parsed = MatchRecordSchema.parse(record);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, matchRecordFileName(parsed.match_id));
  await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * The presenter locates the output directory's contents through
 * manifest.json: `{ summary: "<filename>", matches: ["<filename>", ...] }`.
 * This is part of the match-engine ↔ presenter boundary and must stay in
 * sync with the presenter's Manifest type (packages/presenter/src/records.ts).
 */
export async function writeManifest(outputDir: string, matchIds: string[]): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const manifest = {
    summary: 'tournament-summary.json',
    matches: matchIds.map(matchRecordFileName),
  };
  const filePath = path.join(outputDir, 'manifest.json');
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return filePath;
}

export async function writeTournamentSummary(outputDir: string, summary: TournamentSummary): Promise<string> {
  const parsed = TournamentSummarySchema.parse(summary);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, 'tournament-summary.json');
  await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * Builds the single-file export (EVENT_PLAN.md "Output": "a single JSON
 * bundle, uploaded to R2 ... the presenter loads it with ?bundle=<url> or
 * from a file"), validating it against TournamentBundleSchema before
 * returning it — a bundle that doesn't validate is a match-engine bug and
 * must fail loudly rather than hand the presenter something bad.
 */
export function buildTournamentBundle(
  summary: TournamentSummary,
  matches: MatchRecord[],
  provenance?: Record<string, unknown>,
): TournamentBundle {
  return TournamentBundleSchema.parse({
    format: 'c4-tournament-bundle',
    version: 1,
    summary,
    matches,
    ...(provenance ? { provenance } : {}),
  });
}

/** Writes a validated TournamentBundle to `filePath` (always writes into the output dir per runTournament; `--bundle` additionally writes a copy at a caller-chosen path). */
export async function writeTournamentBundle(filePath: string, bundle: TournamentBundle): Promise<string> {
  const parsed = TournamentBundleSchema.parse(bundle);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return filePath;
}
