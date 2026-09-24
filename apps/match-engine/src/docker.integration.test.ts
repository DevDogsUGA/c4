// The one integration test that touches real Docker, per
// IMPLEMENTATION_PLAN.md: "one optional integration test behind an env flag
// uses real Docker." Skipped by default; run with:
//
//   C4_DOCKER_TESTS=1 npx vitest run src/docker.integration.test.ts
//
// Requires a working Docker daemon reachable via the default dockerode
// connection (DOCKER_HOST / the local socket).
//
// This exercises the one seam the rest of the suite deliberately fakes out:
// building a real image, running it with DESIGN.md's caps, health-checking
// it off-clock, playing a real match over real HTTP, and tearing everything
// down (container + network + image) afterward.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DockerContainerRuntime, ImageBuildError } from './docker/container-runtime.js';
import { DockerBotProvider } from './docker/docker-bot-provider.js';
import { orchestrateMatch } from './match-orchestrator.js';
import { createSeededRng } from './rng.js';
import type { Team } from './types.js';

const RUN_DOCKER_TESTS = process.env.C4_DOCKER_TESTS === '1';

// A minimal, zero-dependency (stdlib-only) Python bot: plays the first
// legal column, per the /move and /health contracts in DESIGN.md.
const BOT_SERVER_PY = `
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != '/move':
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get('Content-Length', 0))
        data = json.loads(self.rfile.read(length) or b'{}')
        board = data['board']
        choices = [c for c in range(len(board)) if 0 in board[c]]
        self._send(200, {"column": choices[0] if choices else 0})

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
`;

const DOCKERFILE = `
FROM python:3.12-alpine
COPY server.py /server.py
ENV PORT=8000
EXPOSE 8000
CMD ["python3", "/server.py"]
`;

async function writeBotRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'server.py'), BOT_SERVER_PY, 'utf8');
  await writeFile(path.join(dir, 'Dockerfile'), DOCKERFILE, 'utf8');
}

describe.skipIf(!RUN_DOCKER_TESTS)('Docker integration (real containers)', () => {
  let workDir: string;
  let botADir: string;
  let botBDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-docker-it-'));
    botADir = path.join(workDir, 'bot-a');
    botBDir = path.join(workDir, 'bot-b');
    await Promise.all([writeBotRepo(botADir), writeBotRepo(botBDir)]);
  }, 30_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it(
    'builds, starts, and health-checks a real container, then tears it down cleanly',
    async () => {
      const runtime = new DockerContainerRuntime();
      const handle = await runtime.start({ repoDir: botADir, port: 8000, healthGraceMs: 30_000 });
      try {
        const res = await fetch(`${handle.baseUrl}/health`);
        expect(res.ok).toBe(true);
      } finally {
        await handle.dispose();
      }
    },
    60_000,
  );

  it(
    'plays a full real match end-to-end through orchestrateMatch and produces a valid game record',
    async () => {
      const provider = new DockerBotProvider();
      const teamA: Team = { name: 'Integration Bot A', repoUrl: 'https://example.com/a' };
      const teamB: Team = { name: 'Integration Bot B', repoUrl: 'https://example.com/b' };

      const record = await orchestrateMatch({
        matchId: 'integration-match',
        phase: 'roundrobin',
        teams: [teamA, teamB],
        repoDirs: [botADir, botBDir],
        provider,
        rng: createSeededRng(1),
        thinkBudgetMs: 10_000,
      });

      expect(record.result.reason).toBe('played');
      expect(record.games.length).toBeGreaterThan(0);
      expect(['four_in_a_row', 'draw', 'forfeit']).toContain(record.games[0].outcome.type);
    },
    120_000,
  );

  // TASK 1 (match-engine build-once-per-team): prepare() builds a single
  // image, labeled for this run; every subsequent start() call for the same
  // repoDir reuses it (no rebuild) until cleanupImages() is opted into.
  it(
    'prepare() builds exactly once per repoDir; start() reuses the prebuilt image; cleanupImages() removes it only when asked',
    async () => {
      const docker = new Docker();
      const buildSpy = vi.spyOn(docker, 'buildImage');
      const runtime = new DockerContainerRuntime(docker, 'a1c-build-once-it');

      const tag = await runtime.prepare(botADir);
      expect(buildSpy).toHaveBeenCalledTimes(1);

      // A second prepare() for the same (still-cached) tag is a no-op.
      const tagAgain = await runtime.prepare(botADir);
      expect(tagAgain).toBe(tag);
      expect(buildSpy).toHaveBeenCalledTimes(1);

      const info = await docker.getImage(tag).inspect();
      expect(info.Config.Labels?.['c4.arena']).toBe('1');
      expect(info.Config.Labels?.['c4.run']).toBe('a1c-build-once-it');

      // Two matches' worth of start()/dispose() against the same repoDir
      // must not trigger a second build.
      const h1 = await runtime.start({ repoDir: botADir, port: 8000, healthGraceMs: 30_000 });
      await h1.dispose();
      const h2 = await runtime.start({ repoDir: botADir, port: 8000, healthGraceMs: 30_000 });
      await h2.dispose();
      expect(buildSpy).toHaveBeenCalledTimes(1);

      // The shared image must survive both per-match dispose() calls (default: keep).
      await expect(docker.getImage(tag).inspect()).resolves.toBeTruthy();

      // Only cleanupImages() (the opt-in path) removes it.
      await runtime.cleanupImages();
      await expect(docker.getImage(tag).inspect()).rejects.toThrow();
    },
    120_000,
  );

  it(
    'prepare() surfaces a broken build as ImageBuildError with a readable detail (build_failed forfeit path)',
    async () => {
      const brokenDir = path.join(workDir, 'broken-bot');
      await mkdir(brokenDir, { recursive: true });
      await writeFile(brokenDir + '/Dockerfile', 'FROM python:3.12-alpine\nRUN this-command-does-not-exist\n', 'utf8');

      const runtime = new DockerContainerRuntime(new Docker(), 'a1c-build-fail-it');
      await expect(runtime.prepare(brokenDir)).rejects.toBeInstanceOf(ImageBuildError);
    },
    60_000,
  );
});
