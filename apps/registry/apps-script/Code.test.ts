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
  safeRespondentEmail_: (formResponse: unknown) => string;
  payloadFromFormResponse_: (formResponse: unknown) => Record<string, unknown>;
  doGet: (e: unknown) => { getContent: () => string };
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

  it('matches the live form\'s titles ("Team Participants", "GitHub Repository URL")', () => {
    const live = [
      { title: 'Team Name', response: 'Live Dogs' },
      { title: 'GitHub Repository URL', response: 'https://github.com/live/bot' },
      { title: 'Team Participants', response: 'Ann\nBo' },
    ];
    expect(gs.extractAnswers(live)).toEqual({
      teamName: 'Live Dogs',
      repoUrl: 'https://github.com/live/bot',
      membersText: 'Ann\nBo',
    });
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

describe('safeRespondentEmail_', () => {
  it('returns the respondent email when available', () => {
    const fr = { getRespondentEmail: () => 'a@uga.edu' };
    expect(gs.safeRespondentEmail_(fr)).toBe('a@uga.edu');
  });

  it("returns '' when getRespondentEmail() returns an empty string", () => {
    const fr = { getRespondentEmail: () => '' };
    expect(gs.safeRespondentEmail_(fr)).toBe('');
  });

  it("returns '' when getRespondentEmail() throws (collection disabled)", () => {
    const fr = {
      getRespondentEmail: () => {
        throw new Error('Email collection is not enabled for this form.');
      },
    };
    expect(gs.safeRespondentEmail_(fr)).toBe('');
  });
});

/**
 * doGet and payloadFromFormResponse_ call GAS-only globals (FormApp,
 * PropertiesService, ContentService). `new Function('module', 'exports',
 * code)` runs the script body in global scope (not a lexical closure over
 * this test file), so these shims are installed as real globals for the
 * duration of each test and removed afterwards.
 */
describe('doGet (shimmed FormApp/PropertiesService/ContentService)', () => {
  const ROSTER_TOKEN = 'test-roster-token';

  function makeItemResponses(answers: { teamName: string; repoUrl: string; membersText: string }) {
    return [
      { title: 'Team Name', response: answers.teamName },
      { title: 'GitHub Repo URL', response: answers.repoUrl },
      { title: 'Team members (one per line)', response: answers.membersText },
    ];
  }

  function makeFormResponse(opts: {
    id: string;
    teamName: string;
    repoUrl: string;
    membersText: string;
    timestamp?: Date;
    respondentEmail?: string | (() => string);
  }) {
    return {
      getId: () => opts.id,
      getItemResponses: () => makeItemResponses(opts),
      getTimestamp: () => opts.timestamp ?? new Date('2026-09-24T00:00:00.000Z'),
      getRespondentEmail: () => {
        if (typeof opts.respondentEmail === 'function') return opts.respondentEmail();
        if (opts.respondentEmail === undefined) {
          throw new Error('Email collection is not enabled for this form.');
        }
        return opts.respondentEmail;
      },
    };
  }

  function installShims(responses: unknown[]) {
    const form = { getResponses: () => responses };
    (globalThis as Record<string, unknown>).FormApp = {
      getActiveForm: () => form,
      openById: () => form,
    };
    (globalThis as Record<string, unknown>).PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (name: string) => (name === 'ROSTER_TOKEN' ? ROSTER_TOKEN : null),
      }),
    };
    (globalThis as Record<string, unknown>).ContentService = {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text: string) => ({
        setMimeType: () => ({ getContent: () => text }),
      }),
    };
  }

  function removeShims() {
    delete (globalThis as Record<string, unknown>).FormApp;
    delete (globalThis as Record<string, unknown>).PropertiesService;
    delete (globalThis as Record<string, unknown>).ContentService;
  }

  it('returns one team per form response, with empty submitter_email when the form collects none', () => {
    const responses = [
      makeFormResponse({ id: 'r1', teamName: 'Team A', repoUrl: 'https://github.com/a/a', membersText: 'Alice' }),
      makeFormResponse({ id: 'r2', teamName: 'Team B', repoUrl: 'https://github.com/b/b', membersText: 'Bob' }),
      makeFormResponse({ id: 'r3', teamName: 'Team C', repoUrl: 'https://github.com/c/c', membersText: 'Carol' }),
    ];
    installShims(responses);
    try {
      const result = gs.doGet({ parameter: { token: ROSTER_TOKEN } });
      const body = JSON.parse(result.getContent()) as { teams: Array<Record<string, unknown>> };
      expect(body.teams).toHaveLength(3);
      expect(body.teams.map((t) => t.id).sort()).toEqual(['r1', 'r2', 'r3']);
      for (const team of body.teams) {
        expect(team.submitter_email).toBe('');
      }
    } finally {
      removeShims();
    }
  });

  it('rejects a missing/incorrect token', () => {
    installShims([]);
    try {
      const result = gs.doGet({ parameter: { token: 'wrong' } });
      const body = JSON.parse(result.getContent()) as { error?: string };
      expect(body.error).toBe('unauthorized');
    } finally {
      removeShims();
    }
  });
});
