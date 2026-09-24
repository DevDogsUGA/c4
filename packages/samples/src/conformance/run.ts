// Cross-language conformance runner.
//
// For each of the 9 hackathon template languages: copies the real student
// template, overlays a thin reference-algorithm sample bot (from
// samples/ref-<lang>/), builds a real Docker image, runs it with the same
// kind of resource limits the arena uses, and POSTs every position in
// corpus.json to it over real HTTP -- exactly the path a student's bot goes
// through. Every language's answer must match the TypeScript reference's
// precomputed `expected` column for every position.
//
// Usage:
//   pnpm -C packages/samples conformance                # all 9 languages
//   pnpm -C packages/samples conformance -- --lang rust  # just one
//   pnpm -C packages/samples conformance -- --template-dir /path/to/templates
//
// Docker safety: every container/image this script creates is named/tagged
// with an `a7-` prefix. It only ever stops/removes/builds resources it
// created itself, one image at a time, and never touches the daemon's
// other containers/images/networks/volumes and never prunes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLS, ROWS, type Board } from './reference.js';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_ROOT = path.resolve(HERE, '../../../../samples'); // repo-root samples/

interface LangSpec {
  lang: string;
  templateSubdir: string; // subdir name under --template-dir
  /** Files/dirs to skip when copying the template (build junk, vendored lockfiles etc. are fine to keep). */
  skip: string[];
}

const LANGS: LangSpec[] = [
  { lang: 'python', templateSubdir: 'python', skip: ['__pycache__'] },
  { lang: 'node', templateSubdir: 'node', skip: ['node_modules'] },
  { lang: 'typescript', templateSubdir: 'typescript', skip: ['node_modules'] },
  { lang: 'java', templateSubdir: 'java', skip: [] },
  { lang: 'go', templateSubdir: 'go', skip: [] },
  { lang: 'csharp', templateSubdir: 'csharp', skip: ['bin', 'obj'] },
  { lang: 'cpp', templateSubdir: 'cpp', skip: [] },
  { lang: 'c', templateSubdir: 'c', skip: [] },
  { lang: 'rust', templateSubdir: 'rust', skip: ['target'] },
];

interface CorpusEntry {
  name: string;
  you: 1 | 2;
  board: Board;
  moves: number[];
  expected: number;
}

interface Args {
  lang?: string;
  templateDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { templateDir: '/home/sloan/code/acm-uga/c4-hackathon/templates' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lang') args.lang = argv[++i];
    else if (argv[i] === '--template-dir') args.templateDir = argv[++i];
  }
  return args;
}

function loadCorpus(): CorpusEntry[] {
  const p = path.join(HERE, 'corpus.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

function copyTemplate(templateDir: string, spec: LangSpec, dest: string) {
  const src = path.join(templateDir, spec.templateSubdir);
  if (!existsSync(src)) {
    throw new Error(`template dir not found: ${src}`);
  }
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      if (base === '.git') return false;
      return !spec.skip.includes(base);
    },
  });
}

function copyOverlay(lang: string, dest: string) {
  const overlayDir = path.join(SAMPLES_ROOT, `ref-${lang}`);
  if (!existsSync(overlayDir)) {
    throw new Error(`missing sample overlay: ${overlayDir}`);
  }
  cpSync(overlayDir, dest, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'sample.json',
  });
}

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`container never became healthy on port ${port}: ${String(lastErr)}`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function renderBoard(board: Board): string {
  const lines: string[] = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < COLS; c++) {
      const cell = board[c][r];
      line += cell === 0 ? '.' : cell === 1 ? 'X' : 'O';
    }
    lines.push(line);
  }
  lines.push('01234567 (columns)');
  return lines.join('\n');
}

interface Mismatch {
  name: string;
  you: number;
  expected: number;
  got: number;
  board: Board;
}

interface LangResult {
  lang: string;
  ok: boolean;
  error?: string;
  total: number;
  passed: number;
  mismatches: Mismatch[];
  latenciesMs: number[];
}

async function runLang(lang: string, args: Args, corpus: CorpusEntry[]): Promise<LangResult> {
  const spec = LANGS.find((l) => l.lang === lang);
  if (!spec) throw new Error(`unknown language: ${lang}`);

  const tag = `a7-ref-${lang}`;
  const containerName = `a7-ref-${lang}-${randomSuffix()}`;
  const tmp = mkdtempSync(path.join(tmpdir(), `a7-conformance-${lang}-`));
  let containerStarted = false;
  let imageBuilt = false;

  const result: LangResult = { lang, ok: false, total: corpus.length, passed: 0, mismatches: [], latenciesMs: [] };

  try {
    copyTemplate(args.templateDir, spec, tmp);
    copyOverlay(lang, tmp);

    console.log(`[${lang}] building image ${tag} from ${tmp} ...`);
    await execFileAsync('docker', ['build', '-t', tag, tmp], { maxBuffer: 64 * 1024 * 1024 });
    imageBuilt = true;

    const port = randomPort();
    console.log(`[${lang}] starting container ${containerName} on port ${port} ...`);
    await execFileAsync('docker', [
      'run', '-d',
      '--name', containerName,
      '--memory', '512m',
      '--pids-limit', '256',
      '--cpus', '1',
      '-p', `${port}:8000`,
      tag,
    ]);
    containerStarted = true;

    await waitForHealth(port, 30_000);

    for (const entry of corpus) {
      const body = {
        you: entry.you,
        board: entry.board,
        moves: entry.moves,
        game: { match_id: `conformance-${lang}`, game_number: 1, clock_remaining_ms: 5000 },
      };
      const start = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const elapsed = performance.now() - start;
      result.latenciesMs.push(elapsed);

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        result.mismatches.push({ name: entry.name, you: entry.you, expected: entry.expected, got: -1, board: entry.board });
        console.error(`[${lang}] ${entry.name}: HTTP ${res.status}: ${text}`);
        continue;
      }
      const json = (await res.json()) as { column?: number };
      if (json.column === entry.expected) {
        result.passed++;
      } else {
        result.mismatches.push({
          name: entry.name,
          you: entry.you,
          expected: entry.expected,
          got: json.column ?? -1,
          board: entry.board,
        });
      }
    }

    result.ok = result.passed === result.total;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    // Cleanup: only ever touch the container/image *this run* created.
    if (containerStarted) {
      try {
        await execFileAsync('docker', ['stop', containerName]);
      } catch {
        /* best effort */
      }
      try {
        await execFileAsync('docker', ['rm', '-f', containerName]);
      } catch {
        /* best effort */
      }
    }
    if (imageBuilt) {
      try {
        await execFileAsync('docker', ['rmi', '-f', tag]);
      } catch {
        /* best effort */
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  return result;
}

function printReport(result: LangResult): void {
  console.log(`\n=== ${result.lang} ===`);
  if (result.error) {
    console.log(`FAILED TO RUN: ${result.error}`);
    return;
  }
  console.log(`${result.passed}/${result.total} passed`);
  if (result.latenciesMs.length > 0) {
    const sorted = [...result.latenciesMs].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p99 = percentile(sorted, 99);
    const max = sorted[sorted.length - 1];
    console.log(
      `latency: p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms`,
    );
    if (p99 >= 150) {
      console.log(`  ** WARNING: p99 latency ${p99.toFixed(1)}ms is not well under the 150ms budget **`);
    }
  }
  if (result.mismatches.length > 0) {
    console.log(`first ${Math.min(5, result.mismatches.length)} mismatches:`);
    for (const m of result.mismatches.slice(0, 5)) {
      console.log(`-- ${m.name} (you=${m.you}) expected col ${m.expected}, got col ${m.got}`);
      console.log(renderBoard(m.board));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = loadCorpus();
  console.log(`Loaded ${corpus.length} corpus positions.`);

  const langsToRun = args.lang ? [args.lang] : LANGS.map((l) => l.lang);

  const results: LangResult[] = [];
  for (const lang of langsToRun) {
    const result = await runLang(lang, args, corpus);
    printReport(result);
    results.push(result);
  }

  console.log('\n=== summary ===');
  let anyFailed = false;
  for (const r of results) {
    const status = r.error ? `ERROR: ${r.error}` : r.ok ? 'PASS' : `FAIL (${r.passed}/${r.total})`;
    console.log(`${r.lang.padEnd(12)} ${status}`);
    if (r.error || !r.ok) anyFailed = true;
  }

  if (anyFailed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
