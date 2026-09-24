import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Code.gs isn't a Node module (Apps Script has no module system), so we
 * load its source text and evaluate it in a sandbox that provides a
 * `module`/`exports` pair — the file's own `if (typeof module !== ...)`
 * export block then populates `module.exports` exactly as it would if
 * required normally.
 */
function loadAppsScript(): {
  parseMembers: (raw: string) => string[];
  bytesToHex: (bytes: number[]) => string;
  computeSignatureHex: (computeHmac: (body: string, key: string) => number[], secret: string, body: string) => string;
  buildFormPayload: (opts: Record<string, unknown>) => Record<string, unknown>;
  findAnswerByTitle: (items: unknown[], titleContains: string) => unknown;
  extractAnswers: (items: unknown[]) => Record<string, unknown>;
} {
  const code = readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const moduleShim = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', code);
  fn(moduleShim, moduleShim.exports);
  return moduleShim.exports as ReturnType<typeof loadAppsScript>;
}

const gs = loadAppsScript();

describe('parseMembers', () => {
  it('splits on newlines, trims, and drops empty lines', () => {
    expect(gs.parseMembers('Alice\n Bob \n\nCarol\n')).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('returns an empty array for empty/undefined input', () => {
    expect(gs.parseMembers('')).toEqual([]);
    expect(gs.parseMembers(undefined as unknown as string)).toEqual([]);
  });
});

describe('bytesToHex / computeSignatureHex', () => {
  // Shim for Utilities.computeHmacSha256Signature: Apps Script returns
  // *signed* bytes (-128..127); Node's Buffer gives unsigned 0..255, so we
  // convert to signed the same way GAS would, to exercise the masking in
  // bytesToHex.
  function gasLikeHmac(body: string, key: string): number[] {
    const digest = createHmac('sha256', key).update(body, 'utf8').digest();
    return Array.from(digest).map((b) => (b > 127 ? b - 256 : b));
  }

  it('produces the same hex as a standard HMAC-SHA256 hex digest', () => {
    const secret = 'shhh';
    const body = JSON.stringify({ a: 1 });
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(gs.computeSignatureHex(gasLikeHmac, secret, body)).toBe(expected);
  });
});

describe('buildFormPayload', () => {
  it('builds the exact /api/form contract shape, defaulting env to production', () => {
    const payload = gs.buildFormPayload({
      responseId: 'r1',
      submitterEmail: 'a@uga.edu',
      teamName: 'Team A',
      repoUrl: 'https://github.com/a/b',
      membersText: 'Alice\nBob',
      submittedAt: '2026-09-24T00:00:00.000Z',
    });
    expect(payload).toEqual({
      response_id: 'r1',
      submitter_email: 'a@uga.edu',
      team_name: 'Team A',
      repo_url: 'https://github.com/a/b',
      members: ['Alice', 'Bob'],
      submitted_at: '2026-09-24T00:00:00.000Z',
      env: 'production',
    });
  });

  it('carries through an explicit env override (staging)', () => {
    const payload = gs.buildFormPayload({
      responseId: 'r2',
      submitterEmail: 'b@uga.edu',
      teamName: 'Team B',
      repoUrl: 'https://github.com/c/d',
      membersText: '',
      submittedAt: '2026-09-24T00:00:00.000Z',
      env: 'staging',
    });
    expect(payload.env).toBe('staging');
    expect(payload.members).toEqual([]);
  });
});

describe('findAnswerByTitle / extractAnswers', () => {
  // Shimmed item-response shape matching what our extractAnswers expects
  // (mirrors the `getItem().getTitle()` / `getResponse()` GAS API via the
  // plain-object fallback branch in findAnswerByTitle).
  const items = [
    { title: 'Team Name', response: 'The Dogs' },
    { title: 'GitHub Repo URL', response: 'https://github.com/dogs/bot' },
    { title: 'Team members (one per line)', response: 'A\nB' },
    { title: 'Anything else?', response: 'nope' },
  ];

  it('matches case-insensitively on a substring of the question title', () => {
    expect(gs.findAnswerByTitle(items, 'team name')).toBe('The Dogs');
    expect(gs.findAnswerByTitle(items, 'repo')).toBe('https://github.com/dogs/bot');
    expect(gs.findAnswerByTitle(items, 'MEMBERS')).toBe('A\nB');
  });

  it('returns null when no question matches', () => {
    expect(gs.findAnswerByTitle(items, 'does not exist')).toBeNull();
  });

  it('extractAnswers pulls all three fields at once', () => {
    expect(gs.extractAnswers(items)).toEqual({
      teamName: 'The Dogs',
      repoUrl: 'https://github.com/dogs/bot',
      membersText: 'A\nB',
    });
  });
});
