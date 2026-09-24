// Shared glue between timeline.ts's pure evaluator and Pixi node refs
// (SHOW_PLAN.md §9b's Iron Rule): every scene registers its animated nodes
// by key into a ref-backed map, hands this hook a `Track[]` list (only ever
// from an effect at a scene/phase boundary, never per frame), and
// `useTick` evaluates + applies x/y/rotation/alpha/scale to each node every
// frame -- no `setState` anywhere in this loop.
//
// DOM/Pixi-adjacent (imports pixi.js's Container + @pixi/react's useTick),
// left untested per this repo's rendering-exclusion convention; the pure
// module it wraps (timeline.ts) IS tested.

import { useCallback, useRef } from 'react';
import { useTick } from '@pixi/react';
import type { Container } from 'pixi.js';
import { evaluate, type Track } from './timeline.js';

export interface TimelineRefs {
  /** Returns a ref callback that registers/unregisters a Pixi node under `key` -- pass as `ref={register(key)}` on any `pixiContainer`/`pixiSprite`/`pixiText`. */
  register: (key: string) => (node: Container | null) => void;
  /** Replaces the active track list. `resetStart` (default true) re-zeroes the elapsed clock -- pass false to keep an in-flight clock running (e.g. appending tracks mid-animation). */
  setTracks: (tracks: readonly Track[], opts?: { resetStart?: boolean }) => void;
  /** Milliseconds since the last `resetStart`-ing `setTracks()` call. Safe to call from a `useTick` callback or a render (e.g. to gate a "done" flag). */
  elapsedMs: () => number;
}

export function useTimelineRefs(): TimelineRefs {
  const nodesRef = useRef(new Map<string, Container>());
  const tracksRef = useRef<readonly Track[]>([]);
  const startRef = useRef(performance.now());

  const register = useCallback(
    (key: string) =>
      (node: Container | null): void => {
        if (node) nodesRef.current.set(key, node);
        else nodesRef.current.delete(key);
      },
    [],
  );

  const setTracks = useCallback((tracks: readonly Track[], opts?: { resetStart?: boolean }): void => {
    tracksRef.current = tracks;
    if (opts?.resetStart !== false) startRef.current = performance.now();
  }, []);

  const elapsedMs = useCallback(() => performance.now() - startRef.current, []);

  useTick(() => {
    const elapsed = performance.now() - startRef.current;
    const frame = evaluate(tracksRef.current, elapsed);
    for (const key in frame) {
      const node = nodesRef.current.get(key);
      if (!node) continue;
      const props = frame[key]!;
      if (props.x !== undefined) node.x = props.x;
      if (props.y !== undefined) node.y = props.y;
      if (props.rotation !== undefined) node.rotation = props.rotation;
      if (props.alpha !== undefined) node.alpha = props.alpha;
      if (props.scaleX !== undefined) node.scale.x = props.scaleX;
      if (props.scaleY !== undefined) node.scale.y = props.scaleY;
    }
  });

  return { register, setTracks, elapsedMs };
}
