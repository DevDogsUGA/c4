import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TEMPLATES, TEMPLATE_NAMES, isTemplateName } from './templates.js';
import { resolveTemplateSource } from './template-source.js';

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

/** Builds a throwaway git repo shaped like c4-hackathon: templates/<lang>/<designated file>. */
async function buildFakeTemplateRepo(root: string): Promise<void> {
  for (const [template, botFile] of Object.entries(TEMPLATES)) {
    const dir = path.join(root, 'templates', template, path.dirname(botFile));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(root, 'templates', template, botFile), `// ${template} designated bot file\n`);
    await writeFile(path.join(root, 'templates', template, 'server.stub'), '// plumbing\n');
  }
  await run('git', ['init', '-q'], root);
  await run('git', ['config', 'user.email', 'test@c4.local'], root);
  await run('git', ['config', 'user.name', 'test'], root);
  await run('git', ['add', '-A'], root);
  await run('git', ['commit', '-q', '-m', 'templates'], root);
}

describe('TEMPLATES map against a fetched template source', () => {
  let repoDir: string;
  let workDir: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), 'c4-fake-template-repo-'));
    await buildFakeTemplateRepo(repoDir);
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-template-extract-'));
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  it('lists all 9 templates', () => {
    expect(TEMPLATE_NAMES.sort()).toEqual(
      ['python', 'node', 'typescript', 'java', 'go', 'csharp', 'cpp', 'c', 'rust'].sort(),
    );
  });

  it('isTemplateName rejects unknown templates', () => {
    expect(isTemplateName('python')).toBe(true);
    expect(isTemplateName('cobol')).toBe(false);
  });

  it('every designated bot file exists once extracted from the fetched template', async () => {
    const source = await resolveTemplateSource({ templateRepo: repoDir, allowUnpublished: true, templateRef: 'HEAD' });
    for (const [template, botFile] of Object.entries(TEMPLATES)) {
      const dest = path.join(workDir, template);
      await mkdir(dest, { recursive: true });
      await source.extract(template, dest);
      const exists = await import('node:fs/promises').then((fs) =>
        fs.stat(path.join(dest, botFile)).then(
          () => true,
          () => false,
        ),
      );
      expect(exists, `${template}: expected ${botFile} to exist after extraction`).toBe(true);
    }
  });
});
