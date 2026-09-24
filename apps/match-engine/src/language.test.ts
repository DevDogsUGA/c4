import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLanguage } from './language.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'c4-language-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function touch(name: string, contents = ''): Promise<void> {
  await writeFile(path.join(dir, name), contents, 'utf8');
}

describe('detectLanguage', () => {
  it('returns undefined for an empty directory', async () => {
    expect(await detectLanguage(dir)).toBeUndefined();
  });

  it('returns undefined for a nonexistent directory', async () => {
    expect(await detectLanguage(path.join(dir, 'nope'))).toBeUndefined();
  });

  it('detects rust from Cargo.toml', async () => {
    await touch('Cargo.toml');
    expect(await detectLanguage(dir)).toBe('rust');
  });

  it('detects go from go.mod', async () => {
    await touch('go.mod');
    expect(await detectLanguage(dir)).toBe('go');
  });

  it('detects csharp from a *.csproj file', async () => {
    await touch('Bot.csproj');
    expect(await detectLanguage(dir)).toBe('csharp');
  });

  it('detects java from a *.java file', async () => {
    await touch('Bot.java');
    expect(await detectLanguage(dir)).toBe('java');
  });

  it('detects typescript from package.json + tsconfig.json', async () => {
    await touch('package.json', '{}');
    await touch('tsconfig.json', '{}');
    expect(await detectLanguage(dir)).toBe('typescript');
  });

  it('detects typescript from package.json + a *.ts file, even without tsconfig.json', async () => {
    await touch('package.json', '{}');
    await touch('bot.ts');
    expect(await detectLanguage(dir)).toBe('typescript');
  });

  it('detects node from package.json alone', async () => {
    await touch('package.json', '{}');
    expect(await detectLanguage(dir)).toBe('node');
  });

  it('detects cpp from a *.cpp file', async () => {
    await touch('bot.cpp');
    expect(await detectLanguage(dir)).toBe('cpp');
  });

  it('detects c from a *.c file', async () => {
    await touch('bot.c');
    expect(await detectLanguage(dir)).toBe('c');
  });

  it('detects python from a *.py file', async () => {
    await touch('bot.py');
    expect(await detectLanguage(dir)).toBe('python');
  });

  it('prefers Cargo.toml over other markers when multiple are present', async () => {
    await touch('Cargo.toml');
    await touch('package.json', '{}');
    await touch('bot.py');
    expect(await detectLanguage(dir)).toBe('rust');
  });
});
