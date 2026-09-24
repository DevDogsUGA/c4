// Animation-lifecycle regression test: dropPiece() must resolve even when
// requestAnimationFrame never fires (hidden/background tabs suspend rAF).
// Without the setTimeout fallback tick, the testground's game loop and the
// presenter's replays hang forever in that state. This tests promise
// resolution and board-state settling only — pixel output stays untested
// per the repo's rendering-exclusion rule.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardRenderer } from './renderer.js';

function stubCanvasEnvironment(): void {
  const noopCtx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'setTransform' || prop === 'clearRect' || prop === 'fillRect') return () => undefined;
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

describe('BoardRenderer with suspended requestAnimationFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubCanvasEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves dropPiece via the timeout fallback and settles the piece', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { dropDurationMs: 450 });

    let resolved = false;
    const drop = renderer.dropPiece(3, 0, 1).then(() => {
      resolved = true;
    });

    // Before the drop duration elapses, the fallback ticks but the piece is
    // still falling.
    await vi.advanceTimersByTimeAsync(250);
    expect(resolved).toBe(false);

    // Fallback ticks every 250ms; after the 450ms drop duration has passed,
    // the next tick must finish the animation and resolve the promise —
    // with rAF never firing at all.
    await vi.advanceTimersByTimeAsync(500);
    await drop;
    expect(resolved).toBe(true);

    renderer.destroy();
  });

  it('stops scheduling fallback timers once the queue is empty and after destroy()', async () => {
    const renderer = new BoardRenderer(fakeContainer(), { dropDurationMs: 100 });
    await Promise.all([renderer.dropPiece(0, 0, 1), vi.advanceTimersByTimeAsync(1000)]);

    expect(vi.getTimerCount()).toBe(0);

    void renderer.dropPiece(1, 0, 2);
    renderer.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
