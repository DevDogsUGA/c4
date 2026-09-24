// The ICPC-flyer "thin white corner frame" motif (SHOW_PLAN.md §1) around a
// framed slide region -- four independent L-shaped brackets, one per
// corner. Pure presentational Pixi Graphics; redrawn only when `box`
// changes (scene boundaries), never per frame.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention; the box it draws comes from layout.ts's cornerFrameBox()
// (pure, tested).

import './pixiExtend.js';
import { TOKENS } from '@acm-uga/c4-theme/tokens';
import type { PlacedElement } from './layout.js';

const ARM_LENGTH = 48;
const LINE_WIDTH = 2;

export function CornerFrame({ box }: { box: PlacedElement }) {
  const { x, y, w, h } = box;

  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        // [cornerX, cornerY, armDirectionX, armDirectionY] -- each corner's
        // two arms point inward along the frame's edges.
        const corners: Array<[number, number, number, number]> = [
          [x, y, 1, 1],
          [x + w, y, -1, 1],
          [x, y + h, 1, -1],
          [x + w, y + h, -1, -1],
        ];
        for (const [cx, cy, dx, dy] of corners) {
          g.moveTo(cx, cy + ARM_LENGTH * dy);
          g.lineTo(cx, cy);
          g.lineTo(cx + ARM_LENGTH * dx, cy);
          g.stroke({ width: LINE_WIDTH, color: TOKENS.chalk });
        }
      }}
    />
  );
}
