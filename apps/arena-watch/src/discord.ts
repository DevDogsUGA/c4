import { log } from './log.js';
import type { FetchFn } from './roster.js';

export interface PostDiscordOptions {
  webhookUrl: string | undefined;
  fetchFn?: FetchFn;
}

export async function postDiscord(content: string, opts: PostDiscordOptions): Promise<void> {
  if (!opts.webhookUrl) return;
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  try {
    await (fetchFn as unknown as (
      input: string,
      init: { method: string; headers: Record<string, string>; body: string },
    ) => Promise<{ ok: boolean; status: number }>)(opts.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    log.warn('discord post failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function statusEmoji(status: 'building' | 'passed' | 'failed'): string {
  if (status === 'passed') return '✅';
  if (status === 'failed') return '❌';
  return '⏳';
}
