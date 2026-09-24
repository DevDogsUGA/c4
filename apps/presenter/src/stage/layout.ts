// Pure logical-space layout system for the Pixi stage (SHOW_PLAN.md §9b).
// Every scene's element positions are computed here, in the fixed
// 1920x1080 logical coordinate space that StagePixi.tsx's root Container
// scales to fit the window -- no DOM measurement, no Pixi/rendering
// imports, so this stays a plain, fully-tested data module. Later stages
// (bracket/seeding/match) add their own layout functions here, reusing the
// same centering/stack/column primitives the slide layouts below already
// use -- this is what makes the morph/travel animations trivial (two
// layouts, same keyed objects, tween between them).

import type { AgendaSlide, ContentSlide, Slide, TitleSlide } from '../slides.js';
import type { BracketRound } from '../bracket.js';
import type { SplitBracket } from '../bracketLayout.js';

/** The stage's fixed logical coordinate space (SHOW_PLAN.md §9b). */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/** A positioned rectangle for one named element in a scene's layout; `key` is stable across a scene's phases/layouts so timeline.ts's tracks (and later, shared-element morphs) can target it. */
export interface PlacedElement {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Stage scaling (StagePixi's root container) -- SHOW_PLAN.md §9b
// ---------------------------------------------------------------------------

/** How much the 1920x1080 logical space must be scaled to fit a winW x winH window, preserving aspect ratio (letterbox/pillarbox the rest). */
export function computeStageScale(winW: number, winH: number): number {
  if (winW <= 0 || winH <= 0) return 1;
  return Math.min(winW / STAGE_WIDTH, winH / STAGE_HEIGHT);
}

/** Top-left offset (in window px) that centers the scaled logical space within a winW x winH window. */
export function computeStageOffset(winW: number, winH: number, scale: number): { x: number; y: number } {
  return { x: (winW - STAGE_WIDTH * scale) / 2, y: (winH - STAGE_HEIGHT * scale) / 2 };
}

/** Physical-pixel cap: the rendered framebuffer never exceeds ~2x a 1080p frame, protecting projector-laptop fill rate regardless of the window's real size/DPR. */
export const MAX_PHYSICAL_WIDTH = STAGE_WIDTH * 2;
export const MAX_PHYSICAL_HEIGHT = STAGE_HEIGHT * 2;

/** devicePixelRatio-aware renderer resolution, capped so `winW * resolution` / `winH * resolution` never exceed MAX_PHYSICAL_*. */
export function computeRendererResolution(winW: number, winH: number, devicePixelRatio: number): number {
  const dpr = Math.max(0.1, devicePixelRatio || 1);
  if (winW <= 0 || winH <= 0) return dpr;
  const capByWidth = MAX_PHYSICAL_WIDTH / winW;
  const capByHeight = MAX_PHYSICAL_HEIGHT / winH;
  return Math.max(0.5, Math.min(dpr, capByWidth, capByHeight));
}

// ---------------------------------------------------------------------------
// General placement helpers
// ---------------------------------------------------------------------------

/** The offset that centers a `size`-long span within a `container`-long span. */
export function center(size: number, container: number): number {
  return (container - size) / 2;
}

/** Centers a w x h box within a containerW x containerH area (defaults to the full stage). */
export function centerBox(
  w: number,
  h: number,
  containerW: number = STAGE_WIDTH,
  containerH: number = STAGE_HEIGHT,
): { x: number; y: number } {
  return { x: center(w, containerW), y: center(h, containerH) };
}

/** `count` equal-width columns spanning `containerWidth`, separated by `gap`, starting at `startX`. Returns each column's {x, w}, left to right. */
export function columns(
  count: number,
  opts: { containerWidth?: number; gap?: number; startX?: number } = {},
): { x: number; w: number }[] {
  const containerWidth = opts.containerWidth ?? STAGE_WIDTH;
  const gap = opts.gap ?? 0;
  const startX = opts.startX ?? 0;
  if (count <= 0) return [];
  const w = (containerWidth - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: startX + i * (w + gap), w }));
}

/** Stacks fixed-height items vertically from `startY`, separated by `gap`, all sharing `x`/`w` -- e.g. agenda rows, content bullets. */
export function verticalStack(
  items: readonly { key: string; h: number }[],
  opts: { x: number; startY: number; w: number; gap: number },
): PlacedElement[] {
  let y = opts.startY;
  const placed: PlacedElement[] = [];
  for (const item of items) {
    placed.push({ key: item.key, x: opts.x, y, w: opts.w, h: item.h });
    y += item.h + opts.gap;
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Static scatter dots (title/champion scenes' motif, SHOW_PLAN.md §1)
// ---------------------------------------------------------------------------

export interface ScatterDot {
  key: string;
  x: number;
  y: number;
}

/**
 * A deterministic (seeded) scatter of `count` dots across a width x height
 * area. Stable across re-renders and tests, unlike `Math.random()` (the DOM
 * scene's version reseeds every mount) -- this stage's dots are static per
 * SHOW_PLAN.md §9's stage-1 scope; ambient drift/twinkle is a later-stage
 * particle upgrade (§9c item 7).
 */
export function scatterDots(
  count: number,
  seed = 1,
  width: number = STAGE_WIDTH,
  height: number = STAGE_HEIGHT,
): ScatterDot[] {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    // xorshift32: fast, deterministic, decent distribution for a decorative scatter.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    key: `dot-${i}`,
    x: next() * width,
    y: next() * height,
  }));
}

// ---------------------------------------------------------------------------
// Slide-scene layouts (SHOW_PLAN.md §4 item 1/5, §9b)
// ---------------------------------------------------------------------------

const SLIDE_MAX_WIDTH = 1400;
const HEADING_HEIGHT = 160;
const HERO_HEADING_HEIGHT = 340; // two wrapped hero lines at fontSize 140 (~1.2 line height)
const EYEBROW_WIDTH = 600;
const EYEBROW_HEIGHT = 40;
const EYEBROW_GAP = 16;
const ROW_WIDTH = 900;
const ROW_HEIGHT = 72;
const ROW_GAP = 16;
const BULLET_WIDTH = 1100;
const BULLET_HEIGHT = 64;
const BULLET_GAP = 28;
const FOOTNOTE_WIDTH = 800;
const FOOTNOTE_HEIGHT = 36;
const IMAGE_SIZE = 160;
const GLOW_SIZE = 900;
/** Inset of the ICPC-flyer corner-frame brackets from the stage edge. */
export const CORNER_FRAME_INSET = 90;

export function cornerFrameBox(): PlacedElement {
  return {
    key: 'corner-frame',
    x: CORNER_FRAME_INSET,
    y: CORNER_FRAME_INSET,
    w: STAGE_WIDTH - CORNER_FRAME_INSET * 2,
    h: STAGE_HEIGHT - CORNER_FRAME_INSET * 2,
  };
}

export interface TitleSlideLayout {
  kind: 'title';
  eyebrow: PlacedElement | null;
  heading: PlacedElement;
  image: PlacedElement | null;
  footnote: PlacedElement | null;
  glow: PlacedElement;
  scatter: ScatterDot[];
  cornerFrame: PlacedElement;
}

export interface AgendaSlideLayout {
  kind: 'agenda';
  eyebrow: PlacedElement | null;
  heading: PlacedElement;
  rows: PlacedElement[];
  footnote: PlacedElement | null;
}

export interface ContentSlideLayout {
  kind: 'content';
  eyebrow: PlacedElement | null;
  heading: PlacedElement;
  bullets: PlacedElement[];
  image: PlacedElement | null;
  footnote: PlacedElement | null;
  /** Set for the ICPC-flyer-framed slides (title slides always frame; content slides frame only the "THANKS FOR COMING!" card, matching the DOM SceneBody's `framed` rule). */
  cornerFrame: PlacedElement | null;
}

export type SlideLayout = TitleSlideLayout | AgendaSlideLayout | ContentSlideLayout;

export function layoutTitleSlide(slide: TitleSlide): TitleSlideLayout {
  let y = STAGE_HEIGHT / 2 - HERO_HEADING_HEIGHT / 2 - (slide.eyebrow ? EYEBROW_HEIGHT + EYEBROW_GAP : 0);

  const eyebrow = slide.eyebrow
    ? { key: 'eyebrow', x: center(EYEBROW_WIDTH, STAGE_WIDTH), y, w: EYEBROW_WIDTH, h: EYEBROW_HEIGHT }
    : null;
  if (eyebrow) y += EYEBROW_HEIGHT + EYEBROW_GAP;

  const heading: PlacedElement = {
    key: 'heading',
    x: center(SLIDE_MAX_WIDTH, STAGE_WIDTH),
    y,
    w: SLIDE_MAX_WIDTH,
    h: HERO_HEADING_HEIGHT,
  };
  y += HERO_HEADING_HEIGHT + 32;

  const image = slide.image
    ? { key: 'image', x: center(IMAGE_SIZE, STAGE_WIDTH), y, w: IMAGE_SIZE, h: IMAGE_SIZE }
    : null;
  if (image) y += IMAGE_SIZE + 24;

  const footnote = slide.footnote
    ? { key: 'footnote', x: center(FOOTNOTE_WIDTH, STAGE_WIDTH), y, w: FOOTNOTE_WIDTH, h: FOOTNOTE_HEIGHT }
    : null;

  return {
    kind: 'title',
    eyebrow,
    heading,
    image,
    footnote,
    glow: { key: 'glow', x: center(GLOW_SIZE, STAGE_WIDTH), y: center(GLOW_SIZE, STAGE_HEIGHT), w: GLOW_SIZE, h: GLOW_SIZE },
    scatter: scatterDots(36, 1),
    cornerFrame: cornerFrameBox(),
  };
}

export function layoutAgendaSlide(slide: AgendaSlide): AgendaSlideLayout {
  let y = 160;
  const eyebrow = slide.eyebrow
    ? { key: 'eyebrow', x: center(EYEBROW_WIDTH, STAGE_WIDTH), y, w: EYEBROW_WIDTH, h: EYEBROW_HEIGHT }
    : null;
  if (eyebrow) y += EYEBROW_HEIGHT + EYEBROW_GAP;

  const heading: PlacedElement = {
    key: 'heading',
    x: center(SLIDE_MAX_WIDTH, STAGE_WIDTH),
    y,
    w: SLIDE_MAX_WIDTH,
    h: HEADING_HEIGHT,
  };
  y += HEADING_HEIGHT + 48;

  const rows = verticalStack(
    slide.rows.map((_row, i) => ({ key: `row-${i}`, h: ROW_HEIGHT })),
    { x: center(ROW_WIDTH, STAGE_WIDTH), startY: y, w: ROW_WIDTH, gap: ROW_GAP },
  );

  const footnote = slide.footnote
    ? { key: 'footnote', x: center(FOOTNOTE_WIDTH, STAGE_WIDTH), y: STAGE_HEIGHT - 120, w: FOOTNOTE_WIDTH, h: FOOTNOTE_HEIGHT }
    : null;

  return { kind: 'agenda', eyebrow, heading, rows, footnote };
}

export function layoutContentSlide(slide: ContentSlide): ContentSlideLayout {
  const framed = /THANKS/i.test(slide.heading);
  let y = 140;
  const eyebrow = slide.eyebrow
    ? { key: 'eyebrow', x: center(EYEBROW_WIDTH, STAGE_WIDTH), y, w: EYEBROW_WIDTH, h: EYEBROW_HEIGHT }
    : null;
  if (eyebrow) y += EYEBROW_HEIGHT + EYEBROW_GAP;

  const heading: PlacedElement = {
    key: 'heading',
    x: center(SLIDE_MAX_WIDTH, STAGE_WIDTH),
    y,
    w: SLIDE_MAX_WIDTH,
    h: HEADING_HEIGHT,
  };
  y += HEADING_HEIGHT + 40;

  const bullets = verticalStack(
    slide.bullets.map((_bullet, i) => ({ key: `bullet-${i}`, h: BULLET_HEIGHT })),
    { x: center(BULLET_WIDTH, STAGE_WIDTH), startY: y, w: BULLET_WIDTH, gap: BULLET_GAP },
  );
  const lastBullet = bullets[bullets.length - 1];
  if (lastBullet) y = lastBullet.y + BULLET_HEIGHT + 40;

  const image = slide.image ? { key: 'image', x: center(IMAGE_SIZE, STAGE_WIDTH), y, w: IMAGE_SIZE, h: IMAGE_SIZE } : null;

  const footnote = slide.footnote
    ? { key: 'footnote', x: center(FOOTNOTE_WIDTH, STAGE_WIDTH), y: STAGE_HEIGHT - 100, w: FOOTNOTE_WIDTH, h: FOOTNOTE_HEIGHT }
    : null;

  return {
    kind: 'content',
    eyebrow,
    heading,
    bullets,
    image,
    footnote,
    cornerFrame: framed ? cornerFrameBox() : null,
  };
}

/** Computes the full element layout for one slide, in 1920x1080 logical px (SHOW_PLAN.md §9b). */
export function layoutSlide(slide: Slide): SlideLayout {
  switch (slide.kind) {
    case 'title':
      return layoutTitleSlide(slide);
    case 'agenda':
      return layoutAgendaSlide(slide);
    case 'content':
      return layoutContentSlide(slide);
  }
}

// ---------------------------------------------------------------------------
// Seeding-scene layout (SHOW_PLAN.md §4.2, §9c items 3/4) -- rows, digit
// columns for the W/L odometer, and the results marquee strip.
// ---------------------------------------------------------------------------

export const SEEDING_TABLE_WIDTH = 1200;
export const SEEDING_TABLE_TOP = 300;
export const SEEDING_ROW_HEIGHT = 60;
export const SEEDING_ROW_GAP = 12;
export const SEEDING_MARQUEE_HEIGHT = 48;

export interface SeedingColumns {
  rank: PlacedElement;
  name: PlacedElement;
  wins: PlacedElement;
  losses: PlacedElement;
}

/** Shared column x/w for every seeding row -- rank / team name / W / L, left-aligned within `SEEDING_TABLE_WIDTH`, centered on the stage. */
export function seedingColumnLayout(): SeedingColumns {
  const tableX = center(SEEDING_TABLE_WIDTH, STAGE_WIDTH);
  const rankW = 90;
  const winsW = 110;
  const lossesW = 110;
  const nameW = SEEDING_TABLE_WIDTH - rankW - winsW - lossesW;
  const rankX = tableX;
  const nameX = rankX + rankW;
  const winsX = nameX + nameW;
  const lossesX = winsX + winsW;
  return {
    rank: { key: 'col-rank', x: rankX, y: 0, w: rankW, h: SEEDING_ROW_HEIGHT },
    name: { key: 'col-name', x: nameX, y: 0, w: nameW, h: SEEDING_ROW_HEIGHT },
    wins: { key: 'col-wins', x: winsX, y: 0, w: winsW, h: SEEDING_ROW_HEIGHT },
    losses: { key: 'col-losses', x: lossesX, y: 0, w: lossesW, h: SEEDING_ROW_HEIGHT },
  };
}

/** The y position of the `index`-th row (0-based) in a stack of seeding rows. */
export function seedingRowY(index: number): number {
  return SEEDING_TABLE_TOP + index * (SEEDING_ROW_HEIGHT + SEEDING_ROW_GAP);
}

/**
 * Row rects (full table width, keyed by team name) for `names` in the given
 * order -- one frame of the seeding replay's FLIP tween (§9c item 3).
 * Calling this for consecutive seeding.ts `seedingReplay` frames (or with
 * `finalOrder`, mapped to names) gives the timeline module's `track()`
 * same-keyed layouts to tween between.
 */
export function seedingRowsLayout(names: readonly string[]): PlacedElement[] {
  const cols = seedingColumnLayout();
  return names.map((name, i) => ({
    key: name,
    x: cols.rank.x,
    y: seedingRowY(i),
    w: SEEDING_TABLE_WIDTH,
    h: SEEDING_ROW_HEIGHT,
  }));
}

export function seedingMarqueeStrip(): PlacedElement {
  return {
    key: 'marquee',
    x: 0,
    y: STAGE_HEIGHT - SEEDING_MARQUEE_HEIGHT - 40,
    w: STAGE_WIDTH,
    h: SEEDING_MARQUEE_HEIGHT,
  };
}

export const ODOMETER_DIGIT_WIDTH = 24;
export const ODOMETER_DIGIT_HEIGHT = SEEDING_ROW_HEIGHT;

/**
 * Right-aligned digit-slot positions within `column` for an N-digit odometer
 * (SHOW_PLAN.md §9c item 4) -- each slot masks/scrolls a vertical strip of
 * glyphs 0-9, so the component only needs each slot's box, not glyph
 * positions within it.
 */
export function odometerDigitSlots(column: PlacedElement, digits = 2): PlacedElement[] {
  const totalW = ODOMETER_DIGIT_WIDTH * digits;
  const startX = column.x + column.w - totalW;
  return Array.from({ length: digits }, (_, i) => ({
    key: `digit-${i}`,
    x: startX + i * ODOMETER_DIGIT_WIDTH,
    y: column.y,
    w: ODOMETER_DIGIT_WIDTH,
    h: ODOMETER_DIGIT_HEIGHT,
  }));
}

// ---------------------------------------------------------------------------
// Bracket-scene layout (SHOW_PLAN.md §5, §9c items 1/2/3) -- card boxes (2
// name rows each) for the two-sided draw + connector paths between a
// match's card and its next-round destination slot.
// ---------------------------------------------------------------------------

export const BRACKET_CARD_WIDTH = 260;
export const BRACKET_CARD_HEIGHT = 88;
/** Horizontal gap between adjacent round columns: at least MIN (cards shrink below BRACKET_CARD_WIDTH to fit a wide draw), at most MAX (a small draw stays compact and centered instead of stretching to the stage edges). */
export const BRACKET_MIN_ROUND_GAP = 40;
export const BRACKET_MAX_ROUND_GAP = 110;
export const BRACKET_MARGIN_X = 70;
export const BRACKET_AREA_TOP = 210;
export const BRACKET_AREA_HEIGHT = 760;

export interface BracketCardBox extends PlacedElement {
  round: string;
  slot: number;
}

export interface BracketConnector {
  key: string;
  /** The predecessor (source) card's key -- e.g. to find "the connector out of the just-decided card" for the winner-travel animation (SHOW_PLAN.md §9c item 2). */
  fromKey: string;
  /** The successor (destination) card's key, or `'final'`. */
  toKey: string;
  side: 'a' | 'b';
  points: { x: number; y: number }[];
}

export interface BracketSceneLayout {
  cards: BracketCardBox[];
  connectors: BracketConnector[];
  final: BracketCardBox | null;
}

/** `${round}#${slot}` -- matches show.ts's `bracketRevealKey`, duplicated here so this pure module has no dependency on show.ts. */
function cardKey(round: string, slot: number): string {
  return `${round}#${slot}`;
}

function predecessorSlot(slot: number, side: 'a' | 'b'): number {
  return side === 'a' ? slot * 2 : slot * 2 + 1;
}

interface BracketColumns {
  /** Left edge of column `i` (0 = leftmost). */
  x: (i: number) => number;
  cardW: number;
  gap: number;
}

/**
 * Round columns for a draw `count` columns wide: cards as wide as
 * BRACKET_CARD_WIDTH allows once every gap gets BRACKET_MIN_ROUND_GAP, gaps
 * then stretched to fill the stage up to BRACKET_MAX_ROUND_GAP, and the
 * whole tree centered -- so adjacent columns are always exactly one gap
 * apart and every connector spans card edge to card edge.
 */
function bracketColumns(count: number): BracketColumns {
  const available = STAGE_WIDTH - 2 * BRACKET_MARGIN_X;
  const n = Math.max(1, count);
  const cardW = Math.min(BRACKET_CARD_WIDTH, (available - (n - 1) * BRACKET_MIN_ROUND_GAP) / n);
  const gap = n > 1 ? Math.min(BRACKET_MAX_ROUND_GAP, (available - n * cardW) / (n - 1)) : 0;
  const startX = center(n * cardW + (n - 1) * gap, STAGE_WIDTH);
  return { x: (i) => startX + i * (cardW + gap), cardW, gap };
}

/**
 * Lays out one side of the draw: round 0's cards spread evenly across
 * `areaTop..areaTop+areaHeight`; each later round's card is vertically
 * centered on the average y of its (up to two) predecessor cards, found by
 * `predecessorSlot` -- the same matching bracketLayout.ts's `splitBracket`
 * output relies on (slots are NOT re-based to 0 within a half).
 * `columnOf(roundIndex)` picks each round's column; `direction` is +1 for a
 * left-to-right-growing half (left side) or -1 for a right-to-left-growing
 * half (right side).
 */
function layoutHalf(
  rounds: readonly BracketRound[],
  cols: BracketColumns,
  columnOf: (roundIndex: number) => number,
  direction: 1 | -1,
  areaTop: number,
  areaHeight: number,
): { cards: BracketCardBox[]; connectors: BracketConnector[]; lastRoundCenters: Map<number, number> } {
  const cards: BracketCardBox[] = [];
  const connectors: BracketConnector[] = [];
  let prevCenters = new Map<number, number>();
  let prevRoundName: string | null = null;

  rounds.forEach((round, roundIndex) => {
    const x = cols.x(columnOf(roundIndex));
    const nextCenters = new Map<number, number>();

    round.matches.forEach((match, i) => {
      let yCenter: number;
      if (roundIndex === 0) {
        const rowUnit = areaHeight / round.matches.length;
        yCenter = areaTop + rowUnit * (i + 0.5);
      } else {
        const a = prevCenters.get(predecessorSlot(match.slot, 'a'));
        const b = prevCenters.get(predecessorSlot(match.slot, 'b'));
        if (a !== undefined && b !== undefined) yCenter = (a + b) / 2;
        else if (a !== undefined) yCenter = a;
        else if (b !== undefined) yCenter = b;
        else yCenter = areaTop + areaHeight / 2;
      }

      const box: BracketCardBox = {
        key: cardKey(round.round, match.slot),
        round: round.round,
        slot: match.slot,
        x,
        y: yCenter - BRACKET_CARD_HEIGHT / 2,
        w: cols.cardW,
        h: BRACKET_CARD_HEIGHT,
      };
      cards.push(box);
      nextCenters.set(match.slot, yCenter);

      if (roundIndex > 0 && prevRoundName !== null) {
        for (const side of ['a', 'b'] as const) {
          const predSlot = predecessorSlot(match.slot, side);
          const predY = prevCenters.get(predSlot);
          if (predY === undefined) continue;
          connectors.push({
            key: `${cardKey(round.round, match.slot)}-${side}`,
            fromKey: cardKey(prevRoundName, predSlot),
            toKey: cardKey(round.round, match.slot),
            side,
            points: elbow(box, predY, yCenter, direction === 1, cols.gap),
          });
        }
      }
    });

    prevCenters = nextCenters;
    prevRoundName = round.round;
  });

  return { cards, connectors, lastRoundCenters: prevCenters };
}

/**
 * The elbow connector into `dest` from a predecessor card one column over
 * (on the left if `fromLeft`): from the predecessor's facing edge at
 * `fromY`, across to the gap's midpoint, along to `toY`, into `dest`'s edge.
 */
function elbow(dest: PlacedElement, fromY: number, toY: number, fromLeft: boolean, gap: number): { x: number; y: number }[] {
  const destX = fromLeft ? dest.x : dest.x + dest.w;
  const srcX = fromLeft ? destX - gap : destX + gap;
  const midX = (srcX + destX) / 2;
  return [
    { x: srcX, y: fromY },
    { x: midX, y: fromY },
    { x: midX, y: toY },
    { x: destX, y: toY },
  ];
}

/**
 * Computes card boxes + connector paths for the whole two-sided (or
 * one-sided fallback) bracket, in 1920x1080 logical px. `split` comes from
 * bracketLayout.ts's `splitBracket` -- this function only turns that
 * round/slot structure into pixel positions.
 */
export function layoutBracket(split: SplitBracket): BracketSceneLayout {
  const cards: BracketCardBox[] = [];
  const connectors: BracketConnector[] = [];

  // Columns: left half's rounds, the final, then the right half's rounds
  // mirrored -- so a sided draw's final lands in the middle column.
  const halfRounds = split.left.length;
  const finalColumn = halfRounds;
  const columnCount = halfRounds + (split.final ? 1 : 0) + (split.sided ? split.right.length : 0);
  const cols = bracketColumns(columnCount);

  const left = layoutHalf(split.left, cols, (r) => r, 1, BRACKET_AREA_TOP, BRACKET_AREA_HEIGHT);
  cards.push(...left.cards);
  connectors.push(...left.connectors);

  const right = split.sided
    ? layoutHalf(split.right, cols, (r) => columnCount - 1 - r, -1, BRACKET_AREA_TOP, BRACKET_AREA_HEIGHT)
    : { cards: [], connectors: [], lastRoundCenters: new Map<number, number>() };
  cards.push(...right.cards);
  connectors.push(...right.connectors);

  let finalBox: BracketCardBox | null = null;
  if (split.final) {
    const finalMatch = split.final.matches[0];
    const leftLastRound = split.left[split.left.length - 1];
    const rightLastRound = split.sided ? split.right[split.right.length - 1] : undefined;

    // Each final slot's predecessor is found by slot number, checked
    // against BOTH halves' last round -- not just "a" <- left, "b" <-
    // right. A one-sided (unsided) bracket puts every semifinal in
    // `split.left`, so slot b's predecessor lives there too; hard-coding
    // "b" to `rightLastRound` (which is empty/undefined there) would
    // silently skip that connector and make `sideRevealed` treat the
    // slot as having no predecessor at all -- i.e. always revealed,
    // spoiling the result before that semifinal is even played.
    const sources: { side: 'a' | 'b'; round: string; slot: number; y: number; fromLeft: boolean }[] = [];
    if (finalMatch) {
      for (const side of ['a', 'b'] as const) {
        const predSlot = predecessorSlot(finalMatch.slot, side);

        const leftPred = leftLastRound?.matches.find((m) => m.slot === predSlot);
        const leftPredY = leftPred ? left.lastRoundCenters.get(leftPred.slot) : undefined;
        if (leftLastRound && leftPred && leftPredY !== undefined) {
          sources.push({ side, round: leftLastRound.round, slot: predSlot, y: leftPredY, fromLeft: true });
          continue;
        }

        const rightPred = rightLastRound?.matches.find((m) => m.slot === predSlot);
        const rightPredY = rightPred ? right.lastRoundCenters.get(rightPred.slot) : undefined;
        if (rightLastRound && rightPred && rightPredY !== undefined) {
          sources.push({ side, round: rightLastRound.round, slot: predSlot, y: rightPredY, fromLeft: false });
        }
      }
    }

    // Centered between its feeders (both semifinals in a one-sided draw).
    const yCenter = sources.length > 0 ? sources.reduce((sum, src) => sum + src.y, 0) / sources.length : BRACKET_AREA_TOP + BRACKET_AREA_HEIGHT / 2;
    finalBox = {
      key: cardKey(split.final.round, finalMatch?.slot ?? 0),
      round: split.final.round,
      slot: finalMatch?.slot ?? 0,
      x: cols.x(finalColumn),
      y: yCenter - BRACKET_CARD_HEIGHT / 2,
      w: cols.cardW,
      h: BRACKET_CARD_HEIGHT,
    };

    for (const src of sources) {
      connectors.push({
        key: `${finalBox.key}-${src.side}`,
        fromKey: cardKey(src.round, src.slot),
        toKey: finalBox.key,
        side: src.side,
        points: elbow(finalBox, src.y, yCenter, src.fromLeft, cols.gap),
      });
    }
  }

  return { cards, connectors, final: finalBox };
}

/** The top ('a') or bottom ('b') team-name row within a bracket card box. */
export function bracketNameRowBox(card: PlacedElement, row: 'a' | 'b'): PlacedElement {
  const rowH = card.h / 2;
  return { key: `${card.key}-${row}`, x: card.x + 12, y: card.y + (row === 'a' ? 0 : rowH), w: card.w - 24, h: rowH };
}

/**
 * Maps every round-1 team's name to its name-row box within that team's
 * round-1 bracket card -- the destination endpoint of the seeding-table ->
 * bracket "morph" tween (SHOW_PLAN.md §9c item 1): the same name-pill
 * object (keyed by team name, same key `seedingRowsLayout` uses) tweens
 * from its settled seeding-row position into this box. Teams with no
 * round-1 slot (shouldn't happen, but a truncated bracket is possible) are
 * simply absent -- the caller fades those out instead of tweening them.
 */
export function bracketRound1NamePositions(
  split: SplitBracket,
  layout: BracketSceneLayout,
): Map<string, PlacedElement> {
  const positions = new Map<string, PlacedElement>();
  const round1s = split.sided ? [split.left[0], split.right[0]] : [split.left[0]];

  for (const round of round1s) {
    if (!round) continue;
    for (const match of round.matches) {
      const card = layout.cards.find((c) => c.round === round.round && c.slot === match.slot);
      if (!card) continue;
      if (match.team_a) positions.set(match.team_a.name, bracketNameRowBox(card, 'a'));
      if (match.team_b) positions.set(match.team_b.name, bracketNameRowBox(card, 'b'));
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Match-scene layout (SHOW_PLAN.md §6, §9c item 5) -- dual/single board
// rects, clock zones, and the banner zone below the board(s).
// ---------------------------------------------------------------------------

export const MATCH_DUAL_BOARD_SIZE = 620;
export const MATCH_SINGLE_BOARD_SIZE = 760;
export const MATCH_CLOCK_ZONE_HEIGHT = 90;
export const MATCH_BANNER_HEIGHT = 140;
const MATCH_BOARD_GAP = 100;
const MATCH_BOARD_TOP = 190;

export interface MatchClockZone {
  left: PlacedElement;
  right: PlacedElement;
}

export interface MatchBoardLayout {
  board: PlacedElement;
  clocks: MatchClockZone;
}

/** Board + clock-zone rects for the two side-by-side boards of a `dual` phase (games 1 & 2). */
export function dualBoardsLayout(): [MatchBoardLayout, MatchBoardLayout] {
  const size = MATCH_DUAL_BOARD_SIZE;
  const totalW = size * 2 + MATCH_BOARD_GAP;
  const startX = center(totalW, STAGE_WIDTH);
  const boardA: PlacedElement = { key: 'board-a', x: startX, y: MATCH_BOARD_TOP, w: size, h: size };
  const boardB: PlacedElement = { key: 'board-b', x: startX + size + MATCH_BOARD_GAP, y: MATCH_BOARD_TOP, w: size, h: size };
  return [
    { board: boardA, clocks: clockZonesFor(boardA) },
    { board: boardB, clocks: clockZonesFor(boardB) },
  ];
}

/** Board + clock-zone rect for the single centered board (sudden death / a match with one game). */
export function singleBoardLayout(): MatchBoardLayout {
  const size = MATCH_SINGLE_BOARD_SIZE;
  const board: PlacedElement = { key: 'board-single', x: center(size, STAGE_WIDTH), y: MATCH_BOARD_TOP, w: size, h: size };
  return { board, clocks: clockZonesFor(board) };
}

function clockZonesFor(board: PlacedElement): MatchClockZone {
  const y = board.y - MATCH_CLOCK_ZONE_HEIGHT - 16;
  const w = board.w / 2 - 8;
  return {
    left: { key: `${board.key}-clock-left`, x: board.x, y, w, h: MATCH_CLOCK_ZONE_HEIGHT },
    right: { key: `${board.key}-clock-right`, x: board.x + board.w - w, y, w, h: MATCH_CLOCK_ZONE_HEIGHT },
  };
}

/** Chrome zone below the board(s) for the winner banner (SHOW_PLAN.md §6). */
export function matchBannerZone(): PlacedElement {
  return {
    key: 'banner',
    x: center(1400, STAGE_WIDTH),
    y: STAGE_HEIGHT - MATCH_BANNER_HEIGHT - 60,
    w: 1400,
    h: MATCH_BANNER_HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// Champion-scene layout (SHOW_PLAN.md §4 item 4, §9c item 6)
// ---------------------------------------------------------------------------

export interface ChampionLayout {
  hero: PlacedElement;
  eyebrow: PlacedElement;
  scatter: ScatterDot[];
}

export function layoutChampion(): ChampionLayout {
  const heroH = 260;
  const eyebrowH = 44;
  const gap = 24;
  const totalH = eyebrowH + gap + heroH;
  const top = center(totalH, STAGE_HEIGHT);
  return {
    eyebrow: { key: 'eyebrow', x: center(700, STAGE_WIDTH), y: top, w: 700, h: eyebrowH },
    hero: { key: 'hero', x: center(1700, STAGE_WIDTH), y: top + eyebrowH + gap, w: 1700, h: heroH },
    scatter: scatterDots(70, 5),
  };
}
