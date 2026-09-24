// Bridges board-ui's framework-free canvas BoardRenderer onto the Pixi
// stage (SHOW_PLAN.md §9b/§9c item 6): mounts a BoardRenderer against a
// detached <div> that is NEVER appended to the document (board-ui's public
// API is out of this task's scope, so instead of touching it, this fakes
// just enough layout via a getBoundingClientRect() override for its
// resize() to size the canvas correctly without real DOM flow), and
// exposes its live canvas as a Pixi Sprite texture, refreshed every tick
// while the board is animating (Texture.from + texture.source.update()).
//
// The DOM BoardCanvas.tsx keeps using BoardRenderer directly and is
// completely unaffected -- this is an additional consumer, not a
// replacement. A later stage wires this into the match/sudden-death
// scenes; for now it exists as stage foundation only (nothing renders it
// yet).
//
// Rendering/DOM-adjacent, so left untested per this repo's ground rules --
// board-ui's own renderer tests (and the pure geometry/easing/pixels
// modules it's built from) cover the pipeline this blits.

import './pixiExtend.js';
import { useEffect, useRef, useState } from 'react';
import { Texture } from 'pixi.js';
import { useTick } from '@pixi/react';
import { BoardRenderer, type BoardRendererOptions } from '@acm-uga/c4-board-ui';

/** A BoardRenderer mounted off-DOM at a fixed logical size, with its canvas exposed as a live Pixi texture. */
export interface BoardTextureHandle {
  renderer: BoardRenderer;
  texture: Texture;
}

/** Fakes a fixed layout box for a <div> that's never appended to the document, so BoardRenderer.resize() (which reads getBoundingClientRect()) sizes its canvas correctly without real DOM flow. */
function detachedBoardContainer(size: number): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      width: size,
      height: size,
      top: 0,
      left: 0,
      right: size,
      bottom: size,
      x: 0,
      y: 0,
      toJSON() {
        return this;
      },
    }) as DOMRect;
  return el;
}

/**
 * Mounts (and remounts on `size`/`resolutionScale`/`dropHand` change) a
 * detached BoardRenderer and keeps a Pixi Texture wrapping its canvas fresh
 * every tick. Returns `null` until the renderer is ready.
 */
export function useBoardTexture(options: BoardRendererOptions & { size: number }): BoardTextureHandle | null {
  const { size, ...rendererOptions } = options;
  const rendererRef = useRef<BoardRenderer | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const [handle, setHandle] = useState<BoardTextureHandle | null>(null);

  useEffect(() => {
    const container = detachedBoardContainer(size);
    const renderer = new BoardRenderer(container, rendererOptions);
    const texture = Texture.from(renderer.canvas, true);
    rendererRef.current = renderer;
    textureRef.current = texture;
    setHandle({ renderer, texture });

    return () => {
      renderer.destroy();
      texture.destroy(true);
      rendererRef.current = null;
      textureRef.current = null;
      setHandle(null);
    };
    // Renderer options are captured once per mount, keyed explicitly by the
    // deps below -- matching BoardCanvas.tsx's own lifecycle convention
    // (the renderer's own imperative API, not React props, drives replay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, options.resolutionScale, options.dropHand]);

  useTick(() => {
    textureRef.current?.source.update();
  });

  return handle;
}

export interface BoardTextureProps {
  x: number;
  y: number;
  size: number;
  resolutionScale?: number;
  dropHand?: boolean;
  onReady?: (renderer: BoardRenderer) => void;
}

/** Pixi Sprite wrapper around `useBoardTexture` -- positions the live board canvas at (x, y) in logical stage px, `size` square. */
export function BoardTexture({ x, y, size, resolutionScale, dropHand, onReady }: BoardTextureProps) {
  const handle = useBoardTexture({ size, resolutionScale, dropHand });

  useEffect(() => {
    if (handle) onReady?.(handle.renderer);
  }, [handle, onReady]);

  if (!handle) return null;
  return <pixiSprite texture={handle.texture} x={x} y={y} width={size} height={size} />;
}
