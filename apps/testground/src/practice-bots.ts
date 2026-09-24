// Config for the practice-bot opponents teams can play against. The
// practice-bots Worker (packages/practice-bots) serves POST /{name}/move +
// /health per DESIGN.md; deployment is deferred (IMPLEMENTATION_PLAN.md), so
// the base URL is user-editable in the UI and defaults to a local
// `wrangler dev` instance rather than a hardcoded production URL.

export interface PracticeBot {
  id: string;
  label: string;
  /** Path segment the Worker routes this bot under, e.g. "random" -> POST /random/move. */
  path: string;
}

export const PRACTICE_BOTS: readonly PracticeBot[] = [
  { id: 'random', label: 'Random', path: 'random' },
  { id: 'greedy', label: 'Greedy', path: 'greedy' },
  { id: 'minimax', label: 'Minimax', path: 'minimax' },
];

/**
 * The deployed practice-bots Worker. Override at build time with
 * VITE_PRACTICE_BOTS_URL (e.g. http://localhost:8787 for `wrangler dev`).
 */
export const DEFAULT_PRACTICE_BOTS_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PRACTICE_BOTS_URL ??
  'https://c4-practice-bots.devdogs.workers.dev';

/** Builds the base URL to POST /move against for a given practice bot. */
export function practiceBotUrl(baseUrl: string, bot: PracticeBot): string {
  return `${baseUrl.replace(/\/+$/, '')}/${bot.path}`;
}
