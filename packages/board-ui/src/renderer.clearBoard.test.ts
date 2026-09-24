// Animation-lifecycle regression tests for clearBoard(): the reset animation
// must resolve even when requestAnimationFrame never fires (hidden/background
// tabs suspend rAF) -- exactly like dropPiece() in renderer.fallback.test.ts,
// since clearBoard() rides the same rAF+fallback loop. Also covers the
// "setBoard()/destroy() cancel the animation but the promise still resolves"
// contract, and the idle-CPU rule (no timers scheduled once nothing is
// falling/clearing/pulsing). Pixel output stays untested per the repo's
// rendering-exclusion rule.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@connect-4/engine';
import { BoardRenderer } from './renderer.js';

function stubCanvasEnvironment(): void {
  const noopCtx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'createRadialGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        return () => undefined;
      },
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({
      style: {},
      getContext: () => noopCtx,
      remove: () => undefined,
      set width(_v: number) {},
      set height(_v: number) {},
    }),
  });
  // rAF that NEVER fires — models a hidden tab.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('performance', { now: () => Date.now() });
}

function fakeContainer(): HTMLElement {
  return {
    appendChild: () => undefined,
    getBoundingClientRect: () => ({ width: 400, height: 400 }),
    clientWidth: 400,
    clientHeight: 400,
  } as unknown as HTMLElement;
}

/** A fully-packed 8x8 board (all cells filled, alternating players). */
function fullBoard(): Board {
  return Array.from({ length: 8 }, (_, col) =>
    Array.from({ length: 8 }, (_, row) => (((col + row) % 2 === 0 ? 1 : 2) as 1 | 2)),
  );
}

describe('BoardRenderer.clearBoard() with suspended requestAnimationFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubCanvasEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves via the timeout fallback once every piece has fallen out, with rAF never firing', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8, dropDurationMs: 100 });
    renderer.setBoard(fullBoard());

    let resolved = false;
    const cleared = renderer.clearBoard().then(() => {
      resolved = true;
    });

    // The rightmost column starts its fall ~7 * 60ms = 420ms late, then
    // takes another 100ms to finish -- well under 1s should not be enough,
    // give it plenty of headroom via the 250ms fallback ticks.
    await vi.advanceTimersByTimeAsync(400);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(600);
    await cleared;
    expect(resolved).toBe(true);

    renderer.destroy();
  });

  it('leaves no scheduled timers once clearing finishes, and none after destroy()', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8, dropDurationMs: 100 });
    renderer.setBoard(fullBoard());

    await Promise.all([renderer.clearBoard(), vi.advanceTimersByTimeAsync(2000)]);
    expect(vi.getTimerCount()).toBe(0);

    renderer.setBoard(fullBoard());
    void renderer.clearBoard();
    renderer.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves immediately when the board is already empty', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8 });

    let resolved = false;
    void renderer.clearBoard().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    renderer.destroy();
  });

  it('highlightWin() is fully static (schedules no timers) and clearBoard() still leaves none idle', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8, dropDurationMs: 100 });
    renderer.setBoard(fullBoard());
    renderer.highlightWin([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
      { col: 3, row: 3 },
    ]);

    // The win highlight dims non-winning chips by redrawing the static
    // layer once -- it never schedules a timer/rAF loop on its own (no
    // ring, no pulse to animate).
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);

    // clearBoard() still retires the highlight along with the pieces: once
    // the clear finishes, nothing is falling/clearing, so no timers remain.
    await Promise.all([renderer.clearBoard(), vi.advanceTimersByTimeAsync(2000)]);
    expect(vi.getTimerCount()).toBe(0);

    renderer.destroy();
  });

  it('setBoard() mid-clearBoard() resolves the in-flight promise instead of hanging it', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8, dropDurationMs: 100 });
    renderer.setBoard(fullBoard());

    let resolved = false;
    const cleared = renderer.clearBoard().then(() => {
      resolved = true;
    });

    // Interrupt well before the staggered fall-out could finish on its own.
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);

    renderer.setBoard(fullBoard());
    await cleared;
    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    renderer.destroy();
  });

  it('destroy() mid-clearBoard() resolves the in-flight promise instead of hanging it', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { cols: 8, rows: 8, dropDurationMs: 100 });
    renderer.setBoard(fullBoard());

    let resolved = false;
    const cleared = renderer.clearBoard().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);

    renderer.destroy();
    await cleared;
    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
