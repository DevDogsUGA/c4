// Pixi renders of slides.ts's title/agenda/content slides (SHOW_PLAN.md §4
// item 1/5, §9b/§9c item 5/7): red display heroes, mono eyebrows, wordWrap
// bullets, the pixel-computer icon (nearest-neighbor), a red glow and
// drifting/twinkling scatter dots on the title slide, and thin ICPC-style
// corner frames. Every position comes from layout.ts's per-kind layout
// functions (pure, tested); this file only turns that layout into Pixi
// nodes. The one per-frame exception (the title scatter dots' ambient
// motion) is pure math from particles.ts applied straight to a Graphics
// draw call via `useTick` -- never React state (the Iron Rule, §9b).
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention; the layout/content it renders IS tested (layout.ts,
// slides.ts, particles.ts).

import '../pixiExtend.js';
import { useRef } from 'react';
import { useTick } from '@pixi/react';
import type { Graphics as PixiGraphics } from 'pixi.js';
import type { AgendaSlide, ContentSlide, Slide, TitleSlide } from '../../slides.js';
import {
  layoutAgendaSlide,
  layoutContentSlide,
  layoutTitleSlide,
  type AgendaSlideLayout,
  type ContentSlideLayout,
  type ScatterDot,
  type TitleSlideLayout,
} from '../layout.js';
import { bodyTextStyle, eyebrowTextStyle, headingTextStyle, heroTextStyle, monoTextStyle, rowTextStyle } from '../textStyles.js';
import { Glow } from '../Glow.js';
import { CornerFrame } from '../CornerFrame.js';
import { usePixelTexture } from '../useTexture.js';
import { driftOffset, twinkleAlpha } from '../particles.js';
import { TOKENS } from '@connect-4/theme/tokens';

/**
 * The title slide's scatter dots with a slow ambient drift/twinkle
 * (SHOW_PLAN.md §9c item 7) -- pure per-frame math (particles.ts's
 * `driftOffset`/`twinkleAlpha`) applied straight to the Graphics draw call
 * every `useTick`, never through React state (the Iron Rule, §9b).
 */
function ScatterDots({ dots }: { dots: ScatterDot[] }) {
  const ref = useRef<PixiGraphics | null>(null);
  useTick(() => {
    const g = ref.current;
    if (!g) return;
    const t = performance.now();
    g.clear();
    dots.forEach((dot, i) => {
      const offset = driftOffset(i, t);
      g.circle(dot.x + offset.x, dot.y + offset.y, 2).fill({ color: TOKENS.bulldog, alpha: twinkleAlpha(i, t) });
    });
  });
  return <pixiGraphics ref={ref} draw={() => {}} />;
}

function PixelImage({ url, x, y, size }: { url: string; x: number; y: number; size: number }) {
  const texture = usePixelTexture(url);
  if (!texture) return null;
  return <pixiSprite texture={texture} x={x} y={y} width={size} height={size} roundPixels />;
}

function TitleSlideStage({ slide, layout }: { slide: TitleSlide; layout: TitleSlideLayout }) {
  return (
    <pixiContainer>
      <ScatterDots dots={layout.scatter} />
      <Glow x={layout.glow.x + layout.glow.w / 2} y={layout.glow.y + layout.glow.h / 2} radius={layout.glow.w / 2} />
      <CornerFrame box={layout.cornerFrame} />
      {layout.eyebrow && slide.eyebrow ? (
        <pixiText
          text={slide.eyebrow}
          style={eyebrowTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.eyebrow.x + layout.eyebrow.w / 2}
          y={layout.eyebrow.y}
        />
      ) : null}
      <pixiText
        text={slide.heading}
        style={heroTextStyle({ wordWrap: true, wordWrapWidth: layout.heading.w })}
        anchor={{ x: 0.5, y: 0 }}
        x={layout.heading.x + layout.heading.w / 2}
        y={layout.heading.y}
      />
      {layout.image && slide.image ? (
        <PixelImage url={slide.image} x={layout.image.x} y={layout.image.y} size={layout.image.w} />
      ) : null}
      {layout.footnote && slide.footnote ? (
        <pixiText
          text={slide.footnote}
          style={monoTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.footnote.x + layout.footnote.w / 2}
          y={layout.footnote.y}
        />
      ) : null}
    </pixiContainer>
  );
}

function AgendaSlideStage({ slide, layout }: { slide: AgendaSlide; layout: AgendaSlideLayout }) {
  return (
    <pixiContainer>
      {layout.eyebrow && slide.eyebrow ? (
        <pixiText
          text={slide.eyebrow}
          style={eyebrowTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.eyebrow.x + layout.eyebrow.w / 2}
          y={layout.eyebrow.y}
        />
      ) : null}
      <pixiText
        text={slide.heading}
        style={headingTextStyle()}
        anchor={{ x: 0.5, y: 0 }}
        x={layout.heading.x + layout.heading.w / 2}
        y={layout.heading.y}
      />
      {layout.rows.map((box, i) => (
        <pixiText key={box.key} text={slide.rows[i] ?? ''} style={rowTextStyle()} anchor={{ x: 0, y: 0.5 }} x={box.x} y={box.y + box.h / 2} />
      ))}
      {layout.footnote && slide.footnote ? (
        <pixiText
          text={slide.footnote}
          style={monoTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.footnote.x + layout.footnote.w / 2}
          y={layout.footnote.y}
        />
      ) : null}
    </pixiContainer>
  );
}

function ContentSlideStage({ slide, layout }: { slide: ContentSlide; layout: ContentSlideLayout }) {
  return (
    <pixiContainer>
      {layout.cornerFrame ? <CornerFrame box={layout.cornerFrame} /> : null}
      {layout.eyebrow && slide.eyebrow ? (
        <pixiText
          text={slide.eyebrow}
          style={eyebrowTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.eyebrow.x + layout.eyebrow.w / 2}
          y={layout.eyebrow.y}
        />
      ) : null}
      <pixiText
        text={slide.heading}
        style={headingTextStyle()}
        anchor={{ x: 0.5, y: 0 }}
        x={layout.heading.x + layout.heading.w / 2}
        y={layout.heading.y}
      />
      {layout.bullets.map((box, i) => (
        <pixiText
          key={box.key}
          text={slide.bullets[i] ?? ''}
          style={bodyTextStyle({ wordWrapWidth: box.w })}
          anchor={{ x: 0.5, y: 0 }}
          x={box.x + box.w / 2}
          y={box.y}
        />
      ))}
      {layout.image && slide.image ? (
        <PixelImage url={slide.image} x={layout.image.x} y={layout.image.y} size={layout.image.w} />
      ) : null}
      {layout.footnote && slide.footnote ? (
        <pixiText
          text={slide.footnote}
          style={monoTextStyle()}
          anchor={{ x: 0.5, y: 0 }}
          x={layout.footnote.x + layout.footnote.w / 2}
          y={layout.footnote.y}
        />
      ) : null}
    </pixiContainer>
  );
}

/** Renders any Slide (title/agenda/content) at its layout.ts position. */
export function SlideStage({ slide }: { slide: Slide }) {
  switch (slide.kind) {
    case 'title':
      return <TitleSlideStage slide={slide} layout={layoutTitleSlide(slide)} />;
    case 'agenda':
      return <AgendaSlideStage slide={slide} layout={layoutAgendaSlide(slide)} />;
    case 'content':
      return <ContentSlideStage slide={slide} layout={layoutContentSlide(slide)} />;
  }
}
