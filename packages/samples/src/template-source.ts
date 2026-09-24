// Resolves "the templates" to an exact, committed git ref of
// https://github.com/DevDogsUGA/c4-hackathon.git (private; local git
// credentials work), then extracts `templates/<lang>` via `git archive` —
// never the working tree, so what we test is byte-identical to what's
// pushed to GitHub.
//
// Two modes:
//   - default: a gitignored local cache clone of the public repo, fetched,
//     ref defaults to `origin/main`. The resolved commit must be an
//     ancestor of `origin/main` (the "pin check") unless --allow-unpublished.
//   - `--template-repo <path> --allow-unpublished`: point at a local git
//     repo (e.g. the sibling `c4-hackathon` checkout) for template dev
//     loops. The ref must still be *committed* there (git archive can't see
//     uncommitted changes) — that's what keeps "never read working-tree
//     files" true even in this mode. The pin check is skipped.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_TEMPLATE_REPO = 'https://github.com/DevDogsUGA/c4-hackathon.git';
export const DEFAULT_TEMPLATE_REF = 'origin/main';
export const DEFAULT_CACHE_DIR = '.c4-template-cache';

export interface TemplateSourceOptions {
  /** URL (default) or local path (with allowUnpublished) of the public repo. */
  templateRepo?: string;
  /** Ref to resolve, default 'origin/main' (resolved after fetch). */
  templateRef?: string;
  /** Skip the "ref is on origin/main" pin check. Local dev only. */
  allowUnpublished?: boolean;
  /** Where the cached clone lives (gitignored). */
  cacheDir?: string;
}

export interface ResolvedTemplateSource {
  /** The ref as requested. */
  ref: string;
  /** The resolved, immutable commit sha. */
  commitSha: string;
  /** The git repo directory `git archive` runs against. */
  repoDir: string;
  /** Extracts templates/<template> into destDir (destDir becomes the template root). */
  extract(template: string, destDir: string): Promise<void>;
}

function run(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr || stdout}`));
    });
  });
}

/** `git archive <sha> <treePath>` piped into `tar -x -C destDir --strip-components=<n>`. */
function archiveExtract(repoDir: string, sha: string, treePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const strip = treePath.split('/').length;
    const archive = spawn('git', ['archive', sha, treePath], { cwd: repoDir });
    const tar = spawn('tar', ['-x', `--strip-components=${strip}`, '-C', destDir], { stdio: ['pipe', 'inherit', 'pipe'] });
    let archiveErr = '';
    let tarErr = '';
    archive.stderr?.on('data', (d) => (archiveErr += d.toString()));
    tar.stderr?.on('data', (d) => (tarErr += d.toString()));
    archive.stdout.pipe(tar.stdin);
    let archiveCode: number | null = null;
    let tarCode: number | null = null;
    const finish = () => {
      if (archiveCode === null || tarCode === null) return;
      if (archiveCode !== 0) return reject(new Error(`git archive ${sha} ${treePath} exited ${archiveCode}: ${archiveErr}`));
      if (tarCode !== 0) return reject(new Error(`tar extract exited ${tarCode}: ${tarErr}`));
      resolve();
    };
    archive.on('error', reject);
    tar.on('error', reject);
    archive.on('close', (code) => {
      archiveCode = code;
      finish();
    });
    tar.on('close', (code) => {
      tarCode = code;
      finish();
    });
  });
}

async function ensureCachedClone(repoUrl: string, cacheDir: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(cacheDir)), { recursive: true }).catch(() => {});
  const exists = await run('git', ['rev-parse', '--git-dir'], cacheDir).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await mkdir(cacheDir, { recursive: true });
    await run('git', ['clone', repoUrl, '.'], cacheDir);
  }
  await run('git', ['fetch', 'origin'], cacheDir);
}

function looksLikeUrl(repo: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(repo) || repo.startsWith('git@');
}

export async function resolveTemplateSource(opts: TemplateSourceOptions = {}): Promise<ResolvedTemplateSource> {
  const allowUnpublished = opts.allowUnpublished ?? false;
  const templateRef = opts.templateRef ?? DEFAULT_TEMPLATE_REF;
  const templateRepo = opts.templateRepo ?? DEFAULT_TEMPLATE_REPO;

  let repoDir: string;
  if (!looksLikeUrl(templateRepo)) {
    // A local filesystem path: --template-repo <path> --allow-unpublished
    // for local template dev loops. The ref must still be committed there
    // (git archive can't see uncommitted changes).
    if (!allowUnpublished) {
      throw new Error('a local --template-repo path requires --allow-unpublished (local dev only; otherwise pass a URL for the cached clone)');
    }
    repoDir = path.resolve(templateRepo);
  } else {
    const cacheDir = path.resolve(opts.cacheDir ?? DEFAULT_CACHE_DIR);
    await ensureCachedClone(templateRepo, cacheDir);
    repoDir = cacheDir;
  }

  const { stdout: shaOut } = await run('git', ['rev-parse', `${templateRef}^{commit}`], repoDir);
  const commitSha = shaOut.trim();
  if (!commitSha) {
    throw new Error(`could not resolve template ref "${templateRef}" in ${repoDir}`);
  }

  if (!allowUnpublished) {
    const ok = await run('git', ['merge-base', '--is-ancestor', commitSha, 'origin/main'], repoDir).then(
      () => true,
      () => false,
    );
    if (!ok) {
      throw new Error(
        `template ref ${templateRef} (${commitSha}) is not an ancestor of origin/main — pin check failed. ` +
          `Use --allow-unpublished for local template dev.`,
      );
    }
  }

  return {
    ref: templateRef,
    commitSha,
    repoDir,
    extract: (template, destDir) => archiveExtract(repoDir, commitSha, path.posix.join('templates', template), destDir),
  };
}
