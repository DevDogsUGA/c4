// End-to-end smoke test: replays the ENTIRE rehearsal tournament exactly
// the way a host at the event would, in BOTH loading modes the presenter
// supports (records.ts / App.tsx):
//
//   - `?dir=/` -- a manifest.json + per-match-file directory listing
//     (fixtures/, served at the site root because vite's publicDir is
//     repointed there -- see vite.config.ts).
//   - `?bundle=/tournament.json` -- the single-file tournament-bundle
//     format (fixtures/tournament.json, also served at the site root),
//     the engine's single-file R2 export, loaded via `loadTournamentDataFromBundleUrl`.
//     This fixture is the edge-case bundle: it exercises every match- and
//     game-level forfeit reason, a double forfeit in both round robin and
//     the bracket, a bye produced by a double-forfeit walkover, and a
//     double-forfeit final (no champion) -- see records.test.ts/show.test.ts
//     for the same fixture's unit coverage.
//
// For each mode:
//   1. load the primary/control window with the query above,
//   2. click "Launch stage display" -- this window becomes the fullscreen
//      Pixi stage, and opens a control popup (`?role=control`) that owns
//      the ShowController and syncs position to the stage over
//      BroadcastChannel('c4-show') (see showSync.ts, App.tsx, Stage.tsx),
//   3. drive the popup with the Space bar (the same input a presenter's
//      clicker sends -- see App.tsx's keydown handler), one scene/phase at
//      a time, from the first slide to the final one, using
//      `ShowController.advance()`'s own no-op-at-the-end as the "done"
//      signal (see show.ts) rather than a hardcoded scene count.
//
// At every step: no console errors, no uncaught page errors, and the
// stage's Pixi canvas is verified non-blank by screenshotting just the
// canvas element and sampling a pixel grid from the decoded PNG. This is
// NOT the same as reading the canvas from within the page (e.g.
// `ctx.drawImage(canvas, ...)` + `getImageData`): Pixi's WebGL context uses
// `preserveDrawingBuffer: false` for performance, so by the time an
// `evaluate()` round-trip runs, Chromium has already discarded the
// just-presented backbuffer and any in-page read comes back blank (proven
// empirically during development of this suite). Playwright's
// `page.screenshot()` instead reads the compositor's last-presented frame,
// which is what a real host/projector sees. "Settling" between steps waits
// on two requestAnimationFrame ticks on the stage window -- a real signal
// that Pixi's `useTick`-driven renderer has repainted after the
// BroadcastChannel 'state' message lands, not a fixed sleep.

import { test, expect, type Page, type BrowserContext, type ConsoleMessage } from '@playwright/test';
import { PNG } from 'pngjs';

interface Diagnostic {
  source: 'stage' | 'control';
  kind: 'console-error' | 'pageerror';
  text: string;
  position: string;
}

// Allowlist for genuinely benign console errors. Empty: nothing observed
// during development warranted an exception. If one is added later,
// justify it right here.
const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [];

interface CanvasSignature {
  notBlank: boolean;
  distinctColors: number;
  width: number;
  height: number;
}

/**
 * Loads the presenter at `loadPath`, launches the stage, and steps the
 * whole show to completion via the control popup's keyboard input,
 * asserting no console/page errors and a non-blank canvas at every
 * scene/phase. Shared by both loading-mode tests below.
 */
async function runFullShow(page: Page, context: BrowserContext, loadPath: string): Promise<void> {
  const diagnostics: Diagnostic[] = [];
  const positionBox = { current: 'boot' };

  function attachDiagnostics(target: Page, source: 'stage' | 'control'): void {
    target.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (ALLOWED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
      diagnostics.push({ source, kind: 'console-error', text, position: positionBox.current });
    });
    target.on('pageerror', (err) => {
      diagnostics.push({ source, kind: 'pageerror', text: err.stack ?? String(err), position: positionBox.current });
    });
  }

  function assertNoDiagnostics(): void {
    if (diagnostics.length === 0) return;
    const details = diagnostics.map((d) => `  [${d.source} ${d.kind} @ ${d.position}] ${d.text}`).join('\n');
    throw new Error(`Presenter reported ${diagnostics.length} error(s) during the show:\n${details}`);
  }

  attachDiagnostics(page, 'stage');

  const start = Date.now();

  // --- 1. Load the tournament in the primary/control window. ---
  positionBox.current = `loading fixture (${loadPath})`;
  await page.goto(loadPath);

  const launchButton = page.getByRole('button', { name: 'Launch stage display' });
  await expect(launchButton).toBeEnabled({ timeout: 15_000 });
  assertNoDiagnostics();

  // --- 2. Launch: this window becomes the fullscreen stage; a control
  // popup opens and becomes the controller. ---
  const popupPromise = context.waitForEvent('page');
  positionBox.current = 'launching stage';
  await launchButton.click();
  const control = await popupPromise;
  attachDiagnostics(control, 'control');
  await control.waitForLoadState('domcontentloaded');

  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

  // The popup has no ?dir=/?bundle= of its own -- it acquires the
  // tournament data from the stage window over BroadcastChannel (hello ->
  // data) and mounts its own ShowController. Wait for its first descriptor
  // card to render.
  const nowMeta = control.locator('p.text-graphite').first();
  await expect(nowMeta).toHaveText(/Scene \d+ of \d+ · Phase \d+/, { timeout: 15_000 });
  assertNoDiagnostics();

  async function readPosition(): Promise<{ scene: number; total: number; phase: number }> {
    const text = await nowMeta.textContent();
    const match = text?.match(/Scene (\d+) of (\d+) · Phase (\d+)/);
    if (!match) throw new Error(`could not parse control position from "${text}"`);
    return { scene: Number(match[1]), total: Number(match[2]), phase: Number(match[3]) };
  }

  async function settle(): Promise<void> {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }

  async function canvasSignature(): Promise<CanvasSignature> {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      return { notBlank: false, distinctColors: 0, width: 0, height: 0 };
    }
    const buffer = await page.screenshot({ clip: box });
    const png = PNG.sync.read(buffer);
    const { width: w, height: h, data } = png;
    const colors = new Set<string>();
    const gridW = 48;
    const gridH = 27;
    outer: for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const x = Math.min(w - 1, Math.floor(((gx + 0.5) * w) / gridW));
        const y = Math.min(h - 1, Math.floor(((gy + 0.5) * h) / gridH));
        const idx = (y * w + x) * 4;
        colors.add(`${data[idx]},${data[idx + 1]},${data[idx + 2]}`);
        if (colors.size > 12) break outer;
      }
    }
    return { notBlank: colors.size > 1, distinctColors: colors.size, width: w, height: h };
  }

  // StagePixi.tsx deliberately holds every scene's children back until
  // `document.fonts.ready` resolves (so the first frame never measures
  // text against a fallback font) -- the canvas is a legitimate solid
  // TOKENS.ink fill until then. So "settled" for the canvas-non-blank
  // check is bounded polling on the pixel signal itself, not a fixed
  // sleep: most scenes settle within a frame or two, but the very first
  // paint can additionally wait on a webfont network fetch.
  async function waitForNonBlankCanvas(label: string): Promise<CanvasSignature> {
    let last = await canvasSignature();
    await expect
      .poll(
        async () => {
          last = await canvasSignature();
          return last.notBlank;
        },
        { message: `stage canvas is blank at ${label}`, timeout: 10_000, intervals: [50, 100, 250, 500] },
      )
      .toBe(true);
    return last;
  }

  // --- 3. Step through the entire show, phase by phase / scene by scene,
  // via the same Space-bar input a host's clicker sends. ---
  await control.bringToFront();

  let position = await readPosition();
  const totalScenes = position.total;
  let steps = 0;
  const maxSteps = 500; // generous ceiling; either fixture is well under 100 advances

  await settle();
  let signature = await waitForNonBlankCanvas(`scene ${position.scene}/${position.total} phase ${position.phase}`);
  expect(signature.width, 'stage canvas should have a real backing size').toBeGreaterThan(0);
  assertNoDiagnostics();

  while (steps < maxSteps) {
    positionBox.current = `scene ${position.scene}/${position.total} phase ${position.phase}`;
    await control.keyboard.press('Space');
    steps += 1;

    const next = await readPosition();
    const unchanged = next.scene === position.scene && next.phase === position.phase;
    position = next;
    positionBox.current = `scene ${position.scene}/${position.total} phase ${position.phase}`;

    if (unchanged) {
      // ShowController.advance() is a no-op once atEnd() -- this IS the
      // show's own "done" signal, not a hardcoded scene count.
      break;
    }

    await settle();
    signature = await waitForNonBlankCanvas(positionBox.current);
    assertNoDiagnostics();
  }

  expect(steps, 'show should not hit the runaway-step ceiling (possible stuck advance())').toBeLessThan(maxSteps);
  expect(position.scene, 'show should have reached the final scene in the script').toBe(position.total);

  const elapsedMs = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    `presenter e2e [${loadPath}]: ${totalScenes} scenes, ${steps} advance steps, ${(elapsedMs / 1000).toFixed(1)}s total`,
  );
  expect(elapsedMs, 'full show replay should stay well under the 3-minute budget').toBeLessThan(170_000);

  assertNoDiagnostics();
}

test('replays the full rehearsal tournament end to end (?dir=/ manifest fixtures)', async ({ page, context }) => {
  await runFullShow(page, context, '/?dir=/');
});

test('replays the full edge-case tournament bundle end to end (?bundle=/tournament.json)', async ({
  page,
  context,
}) => {
  await runFullShow(page, context, '/?bundle=/tournament.json');
});
