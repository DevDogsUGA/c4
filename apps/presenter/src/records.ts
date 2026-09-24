// Loads and validates game-record files. Per DESIGN.md's "game-record
// contract", this is the ONLY interface the presenter reads from the match
// engine -- every record is parsed through @connect-4/contract's schemas
// before the rest of the app ever sees it. No other input format is
// accepted.

import { MatchRecordSchema, TournamentSummarySchema, type MatchRecord, type TournamentSummary } from '@connect-4/contract';

export interface TournamentData {
  summary: TournamentSummary;
  matches: MatchRecord[];
}

/** A directory listing of game-record files, itself NOT part of the contract package -- it's just how this app discovers file names, either via fetch (`?dir=`) or a browser file picker. */
export interface Manifest {
  /** Filename (relative to the same directory) of the TournamentSummary record. */
  summary: string;
  /** Filenames (relative to the same directory) of MatchRecord files. */
  matches: string[];
}

export class RecordValidationError extends Error {
  constructor(
    public readonly source: string,
    public readonly issues: string,
  ) {
    super(`Invalid game record in ${source}: ${issues}`);
    this.name = 'RecordValidationError';
  }
}

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Manifest).summary === 'string' &&
    Array.isArray((value as Manifest).matches) &&
    (value as Manifest).matches.every((m) => typeof m === 'string')
  );
}

/** Parses+validates a manifest.json's already-JSON.parsed contents. */
export function parseManifest(raw: unknown, source = 'manifest.json'): Manifest {
  if (!isManifest(raw)) {
    throw new RecordValidationError(source, 'expected { summary: string, matches: string[] }');
  }
  return raw;
}

/** Parses+validates a single match-record file's already-JSON.parsed contents. */
export function parseMatchRecord(raw: unknown, source: string): MatchRecord {
  const result = MatchRecordSchema.safeParse(raw);
  if (!result.success) {
    throw new RecordValidationError(source, result.error.message);
  }
  return result.data;
}

/** Parses+validates the tournament summary file's already-JSON.parsed contents. */
export function parseTournamentSummary(raw: unknown, source: string): TournamentSummary {
  const result = TournamentSummarySchema.safeParse(raw);
  if (!result.success) {
    throw new RecordValidationError(source, result.error.message);
  }
  return result.data;
}

/**
 * Fetches a manifest + every file it lists from `dir` (a URL or path
 * fetch() can resolve, e.g. `?dir=` query param resolved against the
 * page's origin) and validates all of it against the contract schemas.
 * Used by the `?dir=` load path; the file-picker path instead reads
 * `File` objects directly and calls `parseManifest`/`parseMatchRecord`/
 * `parseTournamentSummary` per file (see main.ts).
 */
export async function loadTournamentDataFromDir(dir: string): Promise<TournamentData> {
  const manifestUrl = joinUrl(dir, 'manifest.json');
  const manifestRaw = await fetchJson(manifestUrl);
  const manifest = parseManifest(manifestRaw, manifestUrl);

  const summaryUrl = joinUrl(dir, manifest.summary);
  const summary = parseTournamentSummary(await fetchJson(summaryUrl), summaryUrl);

  const matches = await Promise.all(
    manifest.matches.map(async (filename) => {
      const url = joinUrl(dir, filename);
      return parseMatchRecord(await fetchJson(url), url);
    }),
  );

  return { summary, matches };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function joinUrl(dir: string, filename: string): string {
  return dir.endsWith('/') ? `${dir}${filename}` : `${dir}/${filename}`;
}
