import { describe, expect, it, vi } from 'vitest';
import { fetchRoster, type FetchFn } from './roster.js';

const okTeam = { id: '1', team_name: 'A', repo_url: 'https://x', members: [], submitter_email: 'a@uga.edu', updated_at: 'now' };

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('fetchRoster', () => {
  it('uses the worker on success', async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonRes({ teams: [okTeam] }));
    const { roster, source } = await fetchRoster({
      workerUrl: 'https://worker.example',
      rosterToken: 'tok',
      timeoutMs: 1000,
      fetchFn,
    });
    expect(source).toBe('worker');
    expect(roster.teams).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn as any).mock.calls[0][0]).toBe('https://worker.example/api/roster');
  });

  it('falls back to backup url when the worker errors', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonRes({ teams: [okTeam] }) as any);
    const { roster, source } = await fetchRoster({
      workerUrl: 'https://worker.example',
      rosterToken: 'tok',
      backupRosterUrl: 'https://script.google.com/exec',
      timeoutMs: 1000,
      fetchFn,
    });
    expect(source).toBe('backup');
    expect(roster.teams).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const backupUrl = (fetchFn as any).mock.calls[1][0] as string;
    expect(backupUrl).toContain('token=tok');
  });

  it('falls back to backup url on non-2xx from the worker', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonRes({}, false, 500) as any)
      .mockResolvedValueOnce(jsonRes({ teams: [okTeam] }) as any);
    const { source } = await fetchRoster({
      workerUrl: 'https://worker.example',
      rosterToken: 'tok',
      backupRosterUrl: 'https://script.google.com/exec',
      timeoutMs: 1000,
      fetchFn,
    });
    expect(source).toBe('backup');
  });

  it('throws when both worker and backup fail', async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new Error('down'));
    await expect(
      fetchRoster({
        workerUrl: 'https://worker.example',
        rosterToken: 'tok',
        backupRosterUrl: 'https://script.google.com/exec',
        timeoutMs: 1000,
        fetchFn,
      }),
    ).rejects.toThrow();
  });

  it('throws when the worker fails and no backup is configured', async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new Error('down'));
    await expect(
      fetchRoster({
        workerUrl: 'https://worker.example',
        rosterToken: 'tok',
        timeoutMs: 1000,
        fetchFn,
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed roster body (no teams[])', async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonRes({ nope: true }));
    await expect(
      fetchRoster({
        workerUrl: 'https://worker.example',
        rosterToken: 'tok',
        timeoutMs: 1000,
        fetchFn,
      }),
    ).rejects.toThrow();
  });
});
