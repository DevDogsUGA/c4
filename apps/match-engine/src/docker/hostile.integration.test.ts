// Hostile-bot hardening tests, run against a real Docker daemon. Skipped by
// default; run with:
//
//   C4_DOCKER_TESTS=1 npx vitest run src/docker/hostile.integration.test.ts
//
// Each test builds a tiny, throwaway "stress bot" image from a temp dir and
// runs it through DockerContainerRuntime with the exact caps production
// uses, then proves a specific isolation guarantee from DESIGN.md / the
// event's stress-bot tiers (protocol, lifecycle, resource abuse). Every
// container/network/image this file creates goes through
// DockerContainerRuntime (which stamps c4.arena/c4.run labels) or is
// explicitly labeled `c4.test=a1b` and name-prefixed `a1b-` when created
// directly via dockerode, per the DOCKER SAFETY rule: never touch anything
// this file didn't create.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerContainerRuntime, type ContainerHandle } from './container-runtime.js';
import { HttpBotTransport } from './http-bot-transport.js';

const RUN_DOCKER_TESTS = process.env.C4_DOCKER_TESTS === '1';

const docker = new Docker();

function sampleRequest(clockRemainingMs: number) {
  const empty = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as const));
  return {
    you: 1 as const,
    board: empty,
    moves: [],
    game: { match_id: 'a1b-hostile-test', game_number: 1, clock_remaining_ms: clockRemainingMs },
  };
}

async function writeRepo(dir: string, dockerfile: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'Dockerfile'), dockerfile, 'utf8');
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents, 'utf8');
  }
}

const PY_DOCKERFILE = `
FROM python:3.12-alpine
COPY server.py /server.py
ENV PORT=8000
EXPOSE 8000
CMD ["python3", "/server.py"]
`;

/** A minimal stdlib-only HTTP bot server, parameterized by a snippet of Python that runs inside do_POST /move, after a 200 response is already flushed to the client (so the test's fetch doesn't itself hang on the misbehavior). */
function botServer(moveBody: string, extra = ''): string {
  return `
import json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer

${extra}

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)
        try:
            self.wfile.flush()
        except Exception:
            pass

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
        self.rfile.read(length) if length else None
${moveBody}

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
`;
}

async function listContainerIdsForRun(runId: string): Promise<string[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`c4.run=${runId}`] }),
  });
  return containers.map((c) => c.Id);
}

describe.skipIf(!RUN_DOCKER_TESTS)('Docker hostile-bot hardening (real containers)', () => {
  let workDir: string;
  const rawContainers: string[] = [];
  const rawNetworks: string[] = [];
  const rawImages: string[] = [];
  const handles: ContainerHandle[] = [];

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'c4-hostile-it-'));
  });

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.dispose().catch(() => undefined)));
    for (const id of rawContainers.splice(0)) {
      await docker
        .getContainer(id)
        .remove({ force: true })
        .catch(() => undefined);
    }
    for (const name of rawNetworks.splice(0)) {
      await docker
        .getNetwork(name)
        .remove()
        .catch(() => undefined);
    }
    for (const tag of rawImages.splice(0)) {
      await docker
        .getImage(tag)
        .remove({ force: true })
        .catch(() => undefined);
    }
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it(
    'fork bomb: PidsLimit contains it, host and container stay responsive',
    async () => {
      const dir = path.join(workDir, 'forkbomb');
      await writeRepo(
        dir,
        PY_DOCKERFILE,
        {
          'server.py': botServer(
            `        self._send(200, {"column": 0})\n` +
              `        try:\n` +
              `            os.system(':(){ :|:& };:')\n` +
              `        except Exception:\n` +
              `            pass\n`,
          ),
        },
      );

      const runId = `a1b-forkbomb-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);

      // Safety gate: confirm PidsLimit is actually applied before triggering the bomb.
      const ids = await listContainerIdsForRun(runId);
      expect(ids.length).toBe(1);
      const info = await docker.getContainer(ids[0]).inspect();
      expect(info.HostConfig.PidsLimit).toBe(256);

      const transport = new HttpBotTransport(handle);
      const outcome = await transport.move(sampleRequest(10_000));
      expect(outcome.type).toBe('ok');

      // Give the fork bomb a few seconds to try to run away, then confirm it was capped.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const after = await docker.getContainer(ids[0]).inspect();
      // Either still running (bomb was capped, container survived) or exited
      // (kernel/cgroup pushed back hard) — either way the host must still be
      // reachable and PID count, if the container lives, must respect the cap.
      if (after.State.Running) {
        const top = await docker.getContainer(ids[0]).top({});
        // top.Processes is one row per PID; well under the 256 cap proves containment held.
        expect(top.Processes.length).toBeLessThan(256);
      }
      // Host is still responsive: a trivial docker API call succeeds.
      await expect(docker.ping()).resolves.toBeDefined();
    },
    60_000,
  );

  it(
    'memory bomb: OOM-kill surfaces as a crashed MoveOutcome and restart recovers the bot',
    async () => {
      const dir = path.join(workDir, 'membomb');
      await writeRepo(dir, PY_DOCKERFILE, {
        'server.py': botServer(`        data = bytearray(900 * 1024 * 1024)\n        self._send(200, {"column": 0})\n`),
      });

      const runId = `a1b-membomb-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);

      const ids = await listContainerIdsForRun(runId);
      const info = await docker.getContainer(ids[0]).inspect();
      expect(info.HostConfig.Memory).toBe(512 * 1024 * 1024);
      expect(info.HostConfig.MemorySwap).toBe(info.HostConfig.Memory); // swap disabled

      const transport = new HttpBotTransport(handle);
      const outcome = await transport.move(sampleRequest(10_000));
      expect(outcome.type).toBe('crashed');

      const afterKill = await docker.getContainer(ids[0]).inspect();
      expect(afterKill.State.OOMKilled).toBe(true);

      // The existing restart/crash_loop path must actually recover the container.
      const billedMs = await transport.restart();
      expect(typeof billedMs).toBe('number');
      const healthRes = await fetch(`${handle.baseUrl}/health`);
      expect(healthRes.ok).toBe(true);
    },
    60_000,
  );

  it(
    'disk fill: ReadonlyRootfs + size-limited /tmp tmpfs stop a bot from filling the host disk',
    async () => {
      const dir = path.join(workDir, 'diskfill');
      await writeRepo(dir, PY_DOCKERFILE, {
        // Tries to write 4GiB into the 64MiB tmpfs. Deliberately does NOT try
        // to also write a "how much did I write" marker file afterward: once
        // the tmpfs is full, *any* further write (including a few bytes)
        // also fails with ENOSPC, which is itself proof the cap held — the
        // test instead stats fill.bin's on-disk size directly via exec.
        'server.py': botServer(
          `        self._send(200, {"column": 0})\n` +
            `        chunk = b'0' * (1024 * 1024)\n` +
            `        try:\n` +
            `            with open('/tmp/fill.bin', 'wb') as f:\n` +
            `                for _ in range(4096):\n` +
            `                    f.write(chunk)\n` +
            `        except OSError:\n` +
            `            pass\n`,
        ),
      });

      const runId = `a1b-diskfill-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);
      const ids = await listContainerIdsForRun(runId);
      const info = await docker.getContainer(ids[0]).inspect();
      expect(info.HostConfig.ReadonlyRootfs).toBe(true);

      const transport = new HttpBotTransport(handle);
      const outcome = await transport.move(sampleRequest(10_000));
      expect(outcome.type).toBe('ok');

      // Give the fill loop a moment to hit ENOSPC against the 64m tmpfs cap.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const exec = await docker.getContainer(ids[0]).exec({
        Cmd: ['sh', '-c', 'stat -c %s /tmp/fill.bin 2>/dev/null || echo -1'],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({});
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', resolve);
      });
      const raw = Buffer.concat(chunks).toString('utf8').replace(/[^\d-]/g, '');
      const fillBinBytes = Number.parseInt(raw || '-1', 10);
      // It must have been stopped well short of the 4096 MiB it tried to write
      // (proving the tmpfs cap held, not the host disk), and land right around
      // the configured 64MiB cap.
      expect(fillBinBytes).toBeGreaterThan(0);
      expect(fillBinBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
      expect(fillBinBytes).toBeLessThan(100 * 1024 * 1024);
    },
    60_000,
  );

  it(
    'egress blocked: a container cannot reach the internet from inside',
    async () => {
      const dir = path.join(workDir, 'egress');
      await writeRepo(dir, PY_DOCKERFILE, { 'server.py': botServer(`        self._send(200, {"column": 0})\n`) });

      const runId = `a1b-egress-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);
      const ids = await listContainerIdsForRun(runId);

      const exec = await docker.getContainer(ids[0]).exec({
        Cmd: [
          'python3',
          '-c',
          "import socket\ns = socket.socket()\ns.settimeout(3)\ntry:\n    s.connect(('8.8.8.8', 53))\n    print('CONNECTED')\nexcept Exception as e:\n    print('BLOCKED:' + type(e).__name__)\n",
        ],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({});
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', resolve);
      });
      const output = Buffer.concat(chunks).toString('utf8');
      expect(output).toContain('BLOCKED');
      expect(output).not.toContain('CONNECTED');
    },
    30_000,
  );

  it(
    'cross-match unreachable: a container cannot reach a different match\'s container IP',
    async () => {
      const dirA = path.join(workDir, 'match-a');
      const dirB = path.join(workDir, 'match-b');
      const server = botServer(`        self._send(200, {"column": 0})\n`);
      await writeRepo(dirA, PY_DOCKERFILE, { 'server.py': server });
      await writeRepo(dirB, PY_DOCKERFILE, { 'server.py': server });

      const runtimeA = new DockerContainerRuntime(undefined, `a1b-xmatch-a-${randomUUID()}`);
      const runtimeB = new DockerContainerRuntime(undefined, `a1b-xmatch-b-${randomUUID()}`);
      const handleA = await runtimeA.start({ repoDir: dirA, port: 8000, healthGraceMs: 30_000 });
      const handleB = await runtimeB.start({ repoDir: dirB, port: 8000, healthGraceMs: 30_000 });
      handles.push(handleA, handleB);

      const ipB = new URL(handleB.baseUrl).hostname;
      // Find match A's real container id to exec into.
      const containersA = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`c4.arena=1`] }),
      });
      // Narrow to the one whose baseUrl host matches handleA's IP.
      const ipA = new URL(handleA.baseUrl).hostname;
      const containerAInfo = containersA.find((c) =>
        Object.values(c.NetworkSettings.Networks ?? {}).some((n) => (n as { IPAddress?: string }).IPAddress === ipA),
      );
      expect(containerAInfo).toBeDefined();

      const exec = await docker.getContainer(containerAInfo!.Id).exec({
        Cmd: [
          'python3',
          '-c',
          `import socket\ns = socket.socket()\ns.settimeout(3)\ntry:\n    s.connect(('${ipB}', 8000))\n    print('CONNECTED')\nexcept Exception as e:\n    print('BLOCKED:' + type(e).__name__)\n`,
        ],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({});
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', resolve);
      });
      const output = Buffer.concat(chunks).toString('utf8');
      expect(output).toContain('BLOCKED');
    },
    60_000,
  );

  it(
    'log spam: json-file log driver is capped, cannot fill the host disk',
    async () => {
      const dir = path.join(workDir, 'logspam');
      await writeRepo(dir, PY_DOCKERFILE, {
        'server.py': botServer(
          `        self._send(200, {"column": 0})\n` +
            `        for i in range(2_000_000):\n` +
            `            print('x' * 200, flush=True)\n`,
        ),
      });

      const runId = `a1b-logspam-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);
      const ids = await listContainerIdsForRun(runId);
      const info = await docker.getContainer(ids[0]).inspect();
      expect(info.HostConfig.LogConfig?.Type).toBe('json-file');
      expect(info.HostConfig.LogConfig?.Config?.['max-size']).toBe('1m');

      const transport = new HttpBotTransport(handle);
      await transport.move(sampleRequest(10_000));

      // Let the spam run for a few seconds, then check the on-disk log file(s) stay bounded.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const logPath = info.LogPath;
      if (logPath) {
        const { stat } = await import('node:fs/promises');
        // With max-file=1 there is exactly one rotation file at most `max-size` (1MB) plus
        // whatever hasn't rotated yet; give generous headroom (4MB) for the current segment.
        const st = await stat(logPath).catch(() => null);
        if (st) {
          expect(st.size).toBeLessThan(4 * 1024 * 1024);
        }
      }
    },
    30_000,
  );

  it(
    'never-responding bot: the /move fetch is aborted at the clock budget instead of hanging',
    async () => {
      const dir = path.join(workDir, 'neverrespond');
      await writeRepo(dir, PY_DOCKERFILE, {
        'server.py': botServer(`        time.sleep(3600)\n`),
      });

      const runId = `a1b-neverrespond-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);

      const transport = new HttpBotTransport(handle);
      const budgetMs = 1_000;
      const started = Date.now();
      const outcome = await transport.move(sampleRequest(budgetMs));
      const elapsed = Date.now() - started;

      expect(outcome.type).toBe('crashed');
      // Must resolve close to the budget, not hang for the 3600s the bot sleeps.
      expect(elapsed).toBeLessThan(budgetMs + 3_000);
    },
    30_000,
  );

  it(
    'oversized response body: treated as an invalid move, not buffered in full',
    async () => {
      const dir = path.join(workDir, 'oversized');
      await writeRepo(dir, PY_DOCKERFILE, {
        'server.py': botServer(
          `        payload = json.dumps({"column": 0, "padding": "A" * (200 * 1024)}).encode()\n` +
            `        self.send_response(200)\n` +
            `        self.send_header('Content-Type', 'application/json')\n` +
            `        self.end_headers()\n` +
            `        self.wfile.write(payload)\n`,
        ),
      });

      const runId = `a1b-oversized-${randomUUID()}`;
      const runtime = new DockerContainerRuntime(undefined, runId);
      const handle = await runtime.start({ repoDir: dir, port: 8000, healthGraceMs: 30_000 });
      handles.push(handle);

      const transport = new HttpBotTransport(handle);
      const outcome = await transport.move(sampleRequest(10_000));
      expect(outcome.type).toBe('invalid');
    },
    30_000,
  );
});
