import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyState, loadState, saveState } from './state.js';

describe('state', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'c4-watch-state-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty state when the file does not exist', async () => {
    const state = await loadState(path.join(dir, 'missing.json'));
    expect(state).toEqual(emptyState());
  });

  it('round-trips state through save + load', async () => {
    const file = path.join(dir, 'state.json');
    const state = { lastSeen: { 'https://github.com/a/b': 'deadbeef' } };
    await saveState(file, state);
    const loaded = await loadState(file);
    expect(loaded).toEqual(state);
  });

  it('creates parent directories on save', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'state.json');
    await saveState(file, { lastSeen: { x: 'y' } });
    const loaded = await loadState(file);
    expect(loaded.lastSeen).toEqual({ x: 'y' });
  });

  it('returns empty state for corrupt json rather than throwing', async () => {
    const file = path.join(dir, 'corrupt.json');
    const fs = await import('node:fs/promises');
    await fs.writeFile(file, 'not json{{{', 'utf8');
    const state = await loadState(file);
    expect(state).toEqual(emptyState());
  });
});
