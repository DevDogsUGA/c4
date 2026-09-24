// The title/champion slide's soft red radial glow (SHOW_PLAN.md §1's
// "image3" motif, recreated on the stage per §9b). A pixi.js FillGradient
// builds (and internally caches) its own small gradient texture the first
// time it's used; memoizing the FillGradient instance itself via useMemo
// means that build happens once per mount, never per frame -- "a
// radial-gradient texture generated once" per this stage's brief.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention.

import './pixiExtend.js';
import { useMemo } from 'react';
import { FillGradient } from 'pixi.js';
import { TOKENS } from '@acm-uga/c4-theme/tokens';

export interface GlowProps {
  /** Center x/y and radius, in logical stage px. */
  x: number;
  y: number;
  radius: number;
}

export function Glow({ x, y, radius }: GlowProps) {
  const gradient = useMemo(
    () =>
      new FillGradient({
        type: 'radial',
        center: { x: 0.5, y: 0.5 },
        innerRadius: 0,
        outerCenter: { x: 0.5, y: 0.5 },
        outerRadius: 0.5,
        colorStops: [
          { offset: 0, color: `${TOKENS.bulldog}55` },
          { offset: 1, color: `${TOKENS.bulldog}00` },
        ],
        textureSpace: 'local',
      }),
    [],
  );

  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        g.rect(x - radius, y - radius, radius * 2, radius * 2);
        g.fill(gradient);
      }}
    />
  );
}
