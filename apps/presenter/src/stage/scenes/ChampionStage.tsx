// Pixi champion scene (SHOW_PLAN.md §4 item 4, §9c item 6): the red display
// hero, dense ParticleContainer-backed confetti (~1500 particles, see
// ChampionConfetti.tsx), and the title slide's drifting/twinkling scatter
// dots as ambient motion behind the name.
//
// Per the Iron Rule (SHOW_PLAN.md §9b): the hero's entrance is a single
// timeline track (a confident pop-in); the scatter dots' drift/twinkle is
// pure per-frame math (particles.ts's `driftOffset`/`twinkleAlpha`) applied
// directly to Graphics draw calls every `useTick` -- no `setState` in
// either loop.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- the layout it renders IS tested (layout.ts's
// `layoutChampion`); the drift/twinkle math IS tested (particles.ts).

import '../pixiExtend.js';
import { useEffect, useRef } from 'react';
import { useTick } from '@pixi/react';
import type { Graphics as PixiGraphics } from 'pixi.js';
import type { TeamRef } from '@connect-4/contract';
import { layoutChampion } from '../layout.js';
import { easeOutBack, track } from '../timeline.js';
import { useTimelineRefs } from '../useTimeline.js';
import { eyebrowTextStyle, heroTextStyle } from '../textStyles.js';
import { ChampionConfetti } from '../ChampionConfetti.js';
import { driftOffset, twinkleAlpha } from '../particles.js';
import { TOKENS } from '@connect-4/theme/tokens';

const HERO_ENTRANCE_MS = 900;

function ScatterField({ count }: { count: number }) {
  const graphicsRef = useRef<PixiGraphics | null>(null);
  const { scatter } = layoutChampion();
  const dots = scatter.slice(0, count);

  useTick(() => {
    const g = graphicsRef.current;
    if (!g) return;
    const t = performance.now();
    g.clear();
    dots.forEach((dot, i) => {
      const offset = driftOffset(i, t);
      const alpha = twinkleAlpha(i, t);
      g.circle(dot.x + offset.x, dot.y + offset.y, 2).fill({ color: TOKENS.bulldog, alpha });
    });
  });

  return <pixiGraphics ref={graphicsRef} draw={() => {}} />;
}

export function ChampionStage({ team }: { team: TeamRef }) {
  const layout = layoutChampion();
  const timeline = useTimelineRefs();

  useEffect(() => {
    timeline.setTracks([
      track({ key: 'hero', prop: 'scaleX', t0: 0, t1: HERO_ENTRANCE_MS, from: 0.6, to: 1, ease: easeOutBack }),
      track({ key: 'hero', prop: 'scaleY', t0: 0, t1: HERO_ENTRANCE_MS, from: 0.6, to: 1, ease: easeOutBack }),
      track({ key: 'hero', prop: 'alpha', t0: 0, t1: HERO_ENTRANCE_MS, from: 0, to: 1 }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.name]);

  return (
    <pixiContainer>
      <ScatterField count={layout.scatter.length} />

      <pixiText
        text="CHAMPION"
        style={eyebrowTextStyle({ fontSize: 26 })}
        anchor={{ x: 0.5, y: 0 }}
        x={layout.eyebrow.x + layout.eyebrow.w / 2}
        y={layout.eyebrow.y}
      />

      <pixiContainer ref={timeline.register('hero')} x={layout.hero.x + layout.hero.w / 2} y={layout.hero.y + layout.hero.h / 2}>
        <pixiText
          text={team.name}
          style={heroTextStyle({ fontSize: 128, wordWrap: true, wordWrapWidth: layout.hero.w })}
          anchor={{ x: 0.5, y: 0.5 }}
        />
      </pixiContainer>

      <ChampionConfetti seed={1} active />
    </pixiContainer>
  );
}
