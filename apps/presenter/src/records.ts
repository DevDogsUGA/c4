// Loads and validates game-record files. Per DESIGN.md's "game-record
// contract", this is the ONLY interface the presenter reads from the match
// engine -- every record is parsed through @acm-uga/c4-contract's schemas
// before the rest of the app ever sees it. No other input format is
// accepted.

import {
  MatchRecordSchema,
  TournamentBundleSchema,
  TournamentSummarySchema,
  type MatchRecord,
  type TournamentBundle,
  type TournamentSummary,
} from '@acm-uga/c4-contract';

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
 * Parses+validates a single-file tournament bundle's already-JSON.parsed
 * contents (the contract's TournamentBundleSchema: `{ format, version,
 * summary, matches, provenance? }`) -- the whole tournament the engine
 * uploads to R2 as one file, loaded either by URL (`?bundle=`) or a single
 * file from the picker. `provenance` is free-form and never read here.
 */
export function parseTournamentBundle(raw: unknown, source: string): TournamentBundle {
  const result = TournamentBundleSchema.safeParse(raw);
  if (!result.success) {
    throw new RecordValidationError(source, result.error.message);
  }
  return result.data;
}

/** A parsed bundle, reshaped to the same `TournamentData` shape the rest of the app (show.ts, etc.) already consumes -- `format`/`version`/`provenance` are load-time-only concerns. */
export function tournamentDataFromBundle(bundle: TournamentBundle): TournamentData {
  return { summary: bundle.summary, matches: bundle.matches };
}

/**
 * Fetches and validates a single bundle file from `url` (e.g. the `?bundle=`
 * query param -- typically an R2 presigned URL, cross-origin, hence a plain
 * `fetch` rather than anything origin-relative like `loadTournamentDataFromDir`).
 */
export async function loadTournamentDataFromBundleUrl(url: string): Promise<TournamentData> {
  const raw = await fetchJson(url);
  const bundle = parseTournamentBundle(raw, url);
  return tournamentDataFromBundle(bundle);
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
