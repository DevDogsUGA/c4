// Overlays a sample's files onto a pinned template extraction, then commits
// the result as a standalone git repo so the engine's real clone/checkout
// path runs against it (via a file:// URL) — the same as a student's GitHub
// repo, just local.

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { designatedBotFile, type TemplateName } from './templates.js';
import { SampleJsonSchema, type SampleJson } from './sample-schema.js';
import type { ResolvedTemplateSource } from './template-source.js';

export class OverlayViolationError extends Error {}

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr || stdout}`));
    });
  });
}

/** Recursively lists files under dir, relative to dir, posix-separated. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * The overlay rule: a sample's directory (everything but sample.json) may
 * replace ONLY the template's designated bot file, and may add any new
 * files. Replacing any other template file is an error unless
 * sample.json has allowPlumbing: true.
 */
export async function checkOverlayRule(
  template: TemplateName,
  templateDir: string,
  sampleDir: string,
  sample: SampleJson,
): Promise<void> {
  const designated = designatedBotFile(template);
  const templateFiles = new Set(await listFiles(templateDir));
  const sampleFiles = (await listFiles(sampleDir)).filter((f) => f !== 'sample.json');

  if (sample.allowPlumbing) return;

  const violations = sampleFiles.filter((f) => templateFiles.has(f) && f !== designated);
  if (violations.length > 0) {
    throw new OverlayViolationError(
      `sample "${sample.name}" (template ${template}) replaces non-designated template file(s) ` +
        `${violations.join(', ')} without "allowPlumbing": true (designated file is ${designated})`,
    );
  }
}

export interface MaterializedSample {
  slug: string;
  sample: SampleJson;
  /** The materialized working directory (gitignored). */
  dir: string;
  /** file:// URL to the committed git repo, for the engine's real checkout path. */
  repoUrl: string;
  commitSha: string;
}

export interface MaterializeOptions {
  /** Root containing samples/<slug>/. */
  samplesRoot: string;
  /** Slug of the sample directory under samplesRoot. */
  slug: string;
  /** Resolved, pinned template source. */
  templateSource: ResolvedTemplateSource;
  /** Root work dir samples get materialized into (gitignored, wiped per-sample). */
  workDir: string;
}

export async function materializeSample(opts: MaterializeOptions): Promise<MaterializedSample> {
  const sampleSrcDir = path.join(opts.samplesRoot, opts.slug);
  const sampleJsonRaw = await import('node:fs/promises').then((fs) => fs.readFile(path.join(sampleSrcDir, 'sample.json'), 'utf8'));
  const sample = SampleJsonSchema.parse(JSON.parse(sampleJsonRaw));
  const template = sample.template as TemplateName;

  const dir = path.join(opts.workDir, opts.slug);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // 1. Extract the pinned template (never the working tree).
  await opts.templateSource.extract(template, dir);

  // 2. Overlay rule check, against a temp copy of the sample dir (minus sample.json).
  await checkOverlayRule(template, dir, sampleSrcDir, sample);

  // 3. Copy sample files on top (everything except sample.json).
  const sampleFiles = (await listFiles(sampleSrcDir)).filter((f) => f !== 'sample.json');
  for (const rel of sampleFiles) {
    const src = path.join(sampleSrcDir, rel);
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  // 4. git init + commit so it's a real repo, checked out via file://.
  await run('git', ['init', '-q'], dir);
  await run('git', ['config', 'user.email', 'samples@c4.local'], dir);
  await run('git', ['config', 'user.name', 'c4-samples'], dir);
  await run('git', ['add', '-A'], dir);
  await run('git', ['commit', '-q', '-m', `sample: ${sample.name}`, '--allow-empty'], dir);
  const commitSha = (await run('git', ['rev-parse', 'HEAD'], dir)).trim();

  return {
    slug: opts.slug,
    sample,
    dir,
    repoUrl: `file://${dir}`,
    commitSha,
  };
}

export async function listSampleSlugs(samplesRoot: string): Promise<string[]> {
  const entries = await readdir(samplesRoot, { withFileTypes: true });
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sampleJson = path.join(samplesRoot, entry.name, 'sample.json');
    const exists = await stat(sampleJson).then(
      () => true,
      () => false,
    );
    if (exists) slugs.push(entry.name);
  }
  return slugs.sort();
}
