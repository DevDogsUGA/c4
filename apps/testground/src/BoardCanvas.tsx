// Thin React wrapper around @connect-4/board-ui's framework-free canvas
// renderer. Owns the renderer's lifecycle (create on mount, destroy on
// unmount/re-mount) via useRef + useEffect, per DESIGN.md's "testground and
// presenter share the board-ui canvas renderer" invariant -- this file adds
// no rendering logic of its own, it only bridges React's lifecycle to
// BoardRenderer's imperative API.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { BoardRenderer, type Coord } from '@connect-4/board-ui';
import type { Player } from '@connect-4/engine';
import { BOARD_THEME } from '@connect-4/theme/board';

export interface BoardCanvasHandle {
  dropPiece(col: number, row: number, player: Player): Promise<void>;
  highlightWin(line: Coord[]): void;
  /** Animates every settled piece off the board (board-ui's clearBoard), ready for a new game. */
  reset(): Promise<void>;
}

export interface BoardCanvasProps {
  /** Display name for player 1 (red piece), shown in the legend. */
  player1Name?: string;
  /** Display name for player 2 (pale silver piece), shown in the legend. */
  player2Name?: string;
}

export const BoardCanvas = forwardRef<BoardCanvasHandle, BoardCanvasProps>(function BoardCanvas(
  { player1Name = 'Player 1', player2Name = 'Player 2' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new BoardRenderer(container, { theme: BOARD_THEME });
    rendererRef.current = renderer;

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      dropPiece: (col, row, player) => rendererRef.current?.dropPiece(col, row, player) ?? Promise.resolve(),
      highlightWin: (line) => rendererRef.current?.highlightWin(line),
      reset: () => rendererRef.current?.clearBoard() ?? Promise.resolve(),
    }),
    [],
  );

  return (
    <div>
      <div ref={containerRef} className="mx-auto aspect-square w-full max-w-[640px]" />
      <div className="mt-3 flex justify-center gap-6 font-body text-sm text-steel">
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-bulldog" />
          {player1Name}
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-silver" />
          {player2Name}
        </span>
      </div>
    </div>
  );
});
