import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WatchState {
  // repo_url -> last commit SHA we finished processing (built + reported)
  lastSeen: Record<string, string>;
}

export function emptyState(): WatchState {
  return { lastSeen: {} };
}

export async function loadState(stateFile: string): Promise<WatchState> {
  try {
    const text = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'lastSeen' in parsed &&
      typeof (parsed as WatchState).lastSeen === 'object'
    ) {
      return parsed as WatchState;
    }
    return emptyState();
  } catch {
    return emptyState();
  }
}

/** Atomic write (write to temp file + rename) so a crash mid-write never corrupts state. */
export async function saveState(stateFile: string, state: WatchState): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, stateFile);
}
