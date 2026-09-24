// The Pixi stage root (SHOW_PLAN.md §9b): one <Application> filling the
// window, with a single root Container holding every scene in the fixed
// 1920x1080 logical coordinate space. The root container is scaled by
// min(winW/1920, winH/1080) and centered, so children never think about
// the window's actual size -- only StagePixi (and layout.ts's
// computeStageScale/computeStageOffset, which it reuses) does.
//
// Renderer resolution is devicePixelRatio-aware but capped
// (layout.ts's computeRendererResolution) so a hi-DPI projector laptop
// can't blow its fill-rate budget. The Application's own `background` fill
// covers the window edge-to-edge, which doubles as the letterbox/pillarbox
// bars for free -- no separate background Graphics node needed.
//
// Text never draws before document.fonts.ready resolves (children are held
// back until then) -- otherwise the very first frame can measure/wrap text
// against a fallback font and never re-flow.
//
// @pixi/react owns the underlying Application's mount/unmount lifecycle
// (keyed off the <canvas> DOM node via its internal `roots` map), so this
// component is StrictMode-safe by construction: a double-invoked effect
// reuses the same canvas element and reconnects to the existing root
// instead of constructing a second Application.

import './pixiExtend.js';
import { useEffect, useState, type ReactNode } from 'react';
import { Application, useApplication } from '@pixi/react';
import { TOKENS } from '@connect-4/theme/tokens';
import { computeRendererResolution, computeStageOffset, computeStageScale } from './layout.js';

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    function onResize(): void {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function useFontsReady(): boolean {
  const [ready, setReady] = useState(
    () => typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded',
  );
  useEffect(() => {
    if (ready || typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);
  return ready;
}

export interface StagePixiProps {
  children: ReactNode;
}

/**
 * Dev-only: exposes the Application on globalThis.__PIXI_APP__ (the Pixi
 * DevTools convention) so browser tooling / QA scripts can inspect the
 * scene graph and extract real rendered frames. No-op in production.
 */
function DevtoolsBridge() {
  const { app } = useApplication();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (globalThis as Record<string, unknown>).__PIXI_APP__ = app;
    return () => {
      if ((globalThis as Record<string, unknown>).__PIXI_APP__ === app) {
        delete (globalThis as Record<string, unknown>).__PIXI_APP__;
      }
    };
  }, [app]);
  return null;
}

/** Mounts the Pixi Application and the scaled 1920x1080 logical root Container that every stage scene renders into. */
export function StagePixi({ children }: StagePixiProps) {
  const { width, height } = useWindowSize();
  const fontsReady = useFontsReady();

  const scale = computeStageScale(width, height);
  const offset = computeStageOffset(width, height, scale);
  const resolution = computeRendererResolution(width, height, window.devicePixelRatio || 1);

  return (
    <Application background={TOKENS.ink} resolution={resolution} resizeTo={window} antialias autoDensity>
      <DevtoolsBridge />
      {fontsReady ? (
        <pixiContainer x={offset.x} y={offset.y} scale={scale}>
          {children}
        </pixiContainer>
      ) : null}
    </Application>
  );
}
