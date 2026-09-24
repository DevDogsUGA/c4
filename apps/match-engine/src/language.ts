// Best-effort language detection from a frozen checkout, per EVENT_PLAN.md:
// "rust (Cargo.toml), go (go.mod), csharp (*.csproj), java (*.java),
// typescript (package.json + tsconfig.json or *.ts), node (package.json),
// cpp (*.cpp), c (*.c), python (*.py); else undefined." Populates
// TeamRef.language for the presenter (member intros, team cards) — never
// affects match play.
//
// Order matters: more specific / unambiguous markers are checked first
// (Cargo.toml can't mean anything but Rust), and the TypeScript-vs-Node
// disambiguation (package.json alone is Node; package.json + tsconfig.json
// or a *.ts file is TypeScript) happens before the bare Node fallback.

import { readdir } from 'node:fs/promises';

async function hasFile(dir: string, name: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.includes(name);
  } catch {
    return false;
  }
}

async function hasFileWithExtension(dir: string, extension: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some((e) => e.endsWith(extension));
  } catch {
    return false;
  }
}

/**
 * Detects the submission's template language by inspecting the top level of
 * `repoDir` (a checked-out team repo). Returns undefined if nothing
 * recognizable is present — the arena should not fail a submission over
 * this, it's presentation metadata only.
 */
export async function detectLanguage(repoDir: string): Promise<string | undefined> {
  if (await hasFile(repoDir, 'Cargo.toml')) return 'rust';
  if (await hasFile(repoDir, 'go.mod')) return 'go';
  if (await hasFileWithExtension(repoDir, '.csproj')) return 'csharp';
  if (await hasFileWithExtension(repoDir, '.java')) return 'java';

  const hasPackageJson = await hasFile(repoDir, 'package.json');
  if (hasPackageJson) {
    const hasTsConfig = await hasFile(repoDir, 'tsconfig.json');
    const hasTsFile = await hasFileWithExtension(repoDir, '.ts');
    if (hasTsConfig || hasTsFile) return 'typescript';
    return 'node';
  }

  if (await hasFileWithExtension(repoDir, '.cpp')) return 'cpp';
  if (await hasFileWithExtension(repoDir, '.c')) return 'c';
  if (await hasFileWithExtension(repoDir, '.py')) return 'python';

  return undefined;
}
