import { env } from 'cloudflare:test';
import { signHex } from '../src/crypto';
import type { FormPayload } from '../src/types';

/** Bindings injected via vitest.config.ts miniflare.bindings. */
export const TEST_ENV = env as unknown as {
  DB: D1Database;
  FORM_HMAC_SECRET: string;
  ROSTER_TOKEN: string;
  RESULTS_TOKEN: string;
  GITHUB_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  ADMIN_EMAILS: string;
  MODE?: 'public' | 'admin' | 'both';
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

let counter = 0;

export function makeFormPayload(overrides: Partial<FormPayload> = {}): FormPayload {
  counter += 1;
  return {
    response_id: `resp-${counter}`,
    submitter_email: `team${counter}@uga.edu`,
    team_name: `Team ${counter}`,
    repo_url: `https://github.com/team${counter}/repo${counter}`,
    members: [`Member ${counter}A`, `Member ${counter}B`],
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

export async function signedFormRequest(payload: FormPayload, secret = TEST_ENV.FORM_HMAC_SECRET): Promise<Request> {
  const raw = JSON.stringify(payload);
  const sig = await signHex(secret, raw);
  return new Request('https://registry.test/api/form', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-C4-Signature': sig },
    body: raw,
  });
}
