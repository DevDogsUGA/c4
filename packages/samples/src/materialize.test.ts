import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { materializeSample, checkOverlayRule, listSampleSlugs, OverlayViolationError } from './materialize.js';
import { resolveTemplateSource, type ResolvedTemplateSource } from './template-source.js';
import { TEMPLATES } from './templates.js';

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function buildFakeTemplateRepo(root: string): Promise<void> {
  for (const [template, botFile] of Object.entries(TEMPLATES)) {
    const dir = path.join(root, 'templates', template, path.dirname(botFile));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'templates', template, botFile), `// ${template} designated bot file\n`);
    await writeFile(path.join(root, 'templates', template, 'server.stub'), '// plumbing, do not touch\n');
  }
  await run('git', ['init', '-q'], root);
  await run('git', ['config', 'user.email', 'test@c4.local'], root);
  await run('git', ['config', 'user.name', 'test'], root);
  await run('git', ['add', '-A'], root);
  await run('git', ['commit', '-q', '-m', 'templates'], root);
}

describe('overlay rule + materialize', () => {
  let repoDir: string;
  let samplesRoot: string;
  let workDir: string;
  let source: ResolvedTemplateSource;

  beforeAll(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), 'c4-fake-template-repo-'));
    await buildFakeTemplateRepo(repoDir);
    source = await resolveTemplateSource({ templateRepo: repoDir, allowUnpublished: true, templateRef: 'HEAD' });
    samplesRoot = await mkdtemp(path.join(tmpdir(), 'c4-samples-src-'));
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-samples-work-'));
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(samplesRoot, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeSample(slug: string, files: Record<string, string>) {
    const dir = path.join(samplesRoot, slug);
    await mkdir(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(dir, rel);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, content);
    }
  }

  it('allows replacing the designated bot file', async () => {
    await writeSample('replace-bot', {
      'sample.json': JSON.stringify({ name: 'replace-bot', template: 'python', expect: { kind: 'normal' } }),
      'bot.py': '# overridden\n',
    });
    const result = await materializeSample({ samplesRoot, slug: 'replace-bot', templateSource: source, workDir });
    expect(result.repoUrl.startsWith('file://')).toBe(true);
    const content = await readFile(path.join(result.dir, 'bot.py'), 'utf8');
    expect(content).toBe('# overridden\n');
  });

  it('allows adding a new helper file', async () => {
    await writeSample('with-helper', {
      'sample.json': JSON.stringify({ name: 'with-helper', template: 'python', expect: { kind: 'normal' } }),
      'bot.py': '# uses helper\n',
      'search.py': '# helper module\n',
    });
    const result = await materializeSample({ samplesRoot, slug: 'with-helper', templateSource: source, workDir });
    const content = await readFile(path.join(result.dir, 'search.py'), 'utf8');
    expect(content).toBe('# helper module\n');
  });

  it('rejects replacing a non-designated (plumbing) file without allowPlumbing', async () => {
    await writeSample('bad-plumbing', {
      'sample.json': JSON.stringify({ name: 'bad-plumbing', template: 'python', expect: { kind: 'normal' } }),
      'server.stub': '# tampered\n',
    });
    await expect(
      materializeSample({ samplesRoot, slug: 'bad-plumbing', templateSource: source, workDir }),
    ).rejects.toBeInstanceOf(OverlayViolationError);
  });

  it('allows replacing plumbing when allowPlumbing is true', async () => {
    await writeSample('stress-plumbing', {
      'sample.json': JSON.stringify({
        name: 'stress-plumbing',
        template: 'python',
        expect: { kind: 'game_forfeit', reason: 'invalid_move' },
        allowPlumbing: true,
      }),
      'server.stub': '# custom minimal server\n',
    });
    const result = await materializeSample({ samplesRoot, slug: 'stress-plumbing', templateSource: source, workDir });
    const content = await readFile(path.join(result.dir, 'server.stub'), 'utf8');
    expect(content).toBe('# custom minimal server\n');
  });

  it('rejects an unknown template at schema parse time', async () => {
    await writeSample('unknown-template', {
      'sample.json': JSON.stringify({ name: 'unknown-template', template: 'brainfuck', expect: { kind: 'normal' } }),
      'bot.bf': '+++\n',
    });
    await expect(
      materializeSample({ samplesRoot, slug: 'unknown-template', templateSource: source, workDir }),
    ).rejects.toThrow();
  });

  it('checkOverlayRule is directly testable without touching disk twice', async () => {
    await expect(
      checkOverlayRule('python', path.join(workDir, 'replace-bot'), path.join(samplesRoot, 'bad-plumbing'), {
        name: 'x',
        template: 'python',
        expect: { kind: 'normal' },
      }),
    ).rejects.toBeInstanceOf(OverlayViolationError);
  });

  it('listSampleSlugs finds every sample.json directory', async () => {
    const slugs = await listSampleSlugs(samplesRoot);
    expect(slugs).toContain('replace-bot');
    expect(slugs).toContain('with-helper');
    expect(slugs).toContain('stress-plumbing');
  });
});
