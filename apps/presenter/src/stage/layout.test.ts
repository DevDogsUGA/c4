import { describe, expect, it } from 'vitest';
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  bracketNameRowBox,
  bracketRound1NamePositions,
  center,
  centerBox,
  columns,
  computeRendererResolution,
  computeStageOffset,
  computeStageScale,
  cornerFrameBox,
  dualBoardsLayout,
  layoutAgendaSlide,
  layoutBracket,
  layoutChampion,
  layoutContentSlide,
  layoutSlide,
  layoutTitleSlide,
  odometerDigitSlots,
  scatterDots,
  seedingColumnLayout,
  seedingMarqueeStrip,
  seedingRowsLayout,
  singleBoardLayout,
  verticalStack,
} from './layout.js';
import type { AgendaSlide, ContentSlide, TitleSlide } from '../slides.js';
import type { BracketMatch } from '@connect-4/contract';
import type { BracketRound } from '../bracket.js';
import { splitBracket } from '../bracketLayout.js';

describe('computeStageScale', () => {
  it('letterboxes a wide window (scale limited by height)', () => {
    expect(computeStageScale(2560, 1080)).toBeCloseTo(1080 / STAGE_HEIGHT);
  });

  it('pillarboxes a tall window (scale limited by width)', () => {
    expect(computeStageScale(1024, 768)).toBeCloseTo(1024 / STAGE_WIDTH);
  });

  it('is exactly 1 for a window matching the logical space', () => {
    expect(computeStageScale(1920, 1080)).toBeCloseTo(1);
  });

  it('degrades to 1 for degenerate window sizes', () => {
    expect(computeStageScale(0, 1080)).toBe(1);
    expect(computeStageScale(1920, 0)).toBe(1);
  });
});

describe('computeStageOffset', () => {
  it('leaves bars above/below (offset.x = 0) when the window is narrower than 16:9 (scale limited by width)', () => {
    const scale = computeStageScale(1024, 768);
    const offset = computeStageOffset(1024, 768, scale);
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeGreaterThan(0);
    expect(offset.y * 2 + STAGE_HEIGHT * scale).toBeCloseTo(768);
  });

  it('leaves bars left/right (offset.y = 0) when the window is wider than 16:9 (scale limited by height)', () => {
    const scale = computeStageScale(2560, 1080);
    const offset = computeStageOffset(2560, 1080, scale);
    expect(offset.y).toBeCloseTo(0);
    expect(offset.x).toBeGreaterThan(0);
    expect(offset.x * 2 + STAGE_WIDTH * scale).toBeCloseTo(2560);
  });
});

describe('computeRendererResolution', () => {
  it('uses devicePixelRatio directly when comfortably under the physical cap', () => {
    expect(computeRendererResolution(1280, 800, 1)).toBeCloseTo(1);
  });

  it('caps resolution so winW*resolution / winH*resolution never exceed 2x 1080p', () => {
    const resolution = computeRendererResolution(1920, 1080, 3);
    expect(1920 * resolution).toBeLessThanOrEqual(STAGE_WIDTH * 2 + 1e-6);
    expect(1080 * resolution).toBeLessThanOrEqual(STAGE_HEIGHT * 2 + 1e-6);
  });

  it('caps a small, high-DPR window by whichever dimension binds tighter', () => {
    // 1024x768 at dpr 3 would be 3072x2304 physical -- over the 3840x2160 cap on height.
    const resolution = computeRendererResolution(1024, 768, 3);
    expect(resolution).toBeLessThan(3);
    expect(768 * resolution).toBeLessThanOrEqual(STAGE_HEIGHT * 2 + 1e-6);
  });

  it('never returns something absurdly small for a degenerate window', () => {
    expect(computeRendererResolution(0, 0, 2)).toBe(2);
  });
});

describe('center / centerBox', () => {
  it('centers a span within a container', () => {
    expect(center(400, 1920)).toBeCloseTo(760);
  });

  it('centers a box on both axes', () => {
    expect(centerBox(400, 200, 1920, 1080)).toEqual({ x: 760, y: 440 });
  });
});

describe('columns', () => {
  it('splits the container width evenly with gaps between (not around) columns', () => {
    const cols = columns(3, { containerWidth: 900, gap: 30 });
    expect(cols).toHaveLength(3);
    expect(cols[0]!.x).toBe(0);
    expect(cols.every((c) => c.w === 280)).toBe(true);
    const last = cols[2]!;
    expect(last.x + last.w).toBeCloseTo(900);
  });

  it('respects startX', () => {
    const cols = columns(2, { containerWidth: 400, gap: 0, startX: 100 });
    expect(cols[0]!.x).toBe(100);
    expect(cols[1]!.x).toBe(300);
  });

  it('returns an empty array for a non-positive count', () => {
    expect(columns(0)).toEqual([]);
  });
});

describe('verticalStack', () => {
  it('stacks items top to bottom with the given gap, sharing x/w', () => {
    const placed = verticalStack(
      [
        { key: 'a', h: 50 },
        { key: 'b', h: 30 },
        { key: 'c', h: 70 },
      ],
      { x: 10, startY: 100, w: 500, gap: 20 },
    );
    expect(placed).toEqual([
      { key: 'a', x: 10, y: 100, w: 500, h: 50 },
      { key: 'b', x: 10, y: 170, w: 500, h: 30 },
      { key: 'c', x: 10, y: 220, w: 500, h: 70 },
    ]);
  });

  it('returns an empty array for no items', () => {
    expect(verticalStack([], { x: 0, startY: 0, w: 10, gap: 0 })).toEqual([]);
  });
});

describe('scatterDots', () => {
  it('is deterministic for a given seed', () => {
    expect(scatterDots(20, 42)).toEqual(scatterDots(20, 42));
  });

  it('differs across seeds', () => {
    const a = scatterDots(20, 1);
    const b = scatterDots(20, 2);
    expect(a).not.toEqual(b);
  });

  it('produces `count` dots, each within the given bounds', () => {
    const dots = scatterDots(50, 7, 800, 600);
    expect(dots).toHaveLength(50);
    for (const dot of dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThan(800);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThan(600);
    }
  });

  it('assigns each dot a stable, unique key', () => {
    const dots = scatterDots(5, 3);
    expect(new Set(dots.map((d) => d.key)).size).toBe(5);
  });
});

describe('cornerFrameBox', () => {
  it('is inset symmetrically from the stage edges', () => {
    const box = cornerFrameBox();
    expect(box.x).toBe(box.y);
    expect(box.x + box.w + box.x).toBeCloseTo(STAGE_WIDTH);
    expect(box.y + box.h + box.y).toBeCloseTo(STAGE_HEIGHT);
  });
});

describe('layoutTitleSlide', () => {
  const slide: TitleSlide = { kind: 'title', eyebrow: 'ACM @ UGA', heading: 'CONNECT FOUR SHOWDOWN', image: 'x.png' };

  it('horizontally centers the eyebrow, heading, and image', () => {
    const layout = layoutTitleSlide(slide);
    expect(layout.eyebrow!.x + layout.eyebrow!.w / 2).toBeCloseTo(STAGE_WIDTH / 2);
    expect(layout.heading.x + layout.heading.w / 2).toBeCloseTo(STAGE_WIDTH / 2);
    expect(layout.image!.x + layout.image!.w / 2).toBeCloseTo(STAGE_WIDTH / 2);
  });

  it('stacks eyebrow above heading above image, top to bottom', () => {
    const layout = layoutTitleSlide(slide);
    expect(layout.eyebrow!.y).toBeLessThan(layout.heading.y);
    expect(layout.heading.y).toBeLessThan(layout.image!.y);
  });

  it('omits the eyebrow/image/footnote boxes when the slide has none', () => {
    const layout = layoutTitleSlide({ kind: 'title', heading: 'SEE YOU NEXT TIME' });
    expect(layout.eyebrow).toBeNull();
    expect(layout.image).toBeNull();
    expect(layout.footnote).toBeNull();
  });

  it('always provides a glow region, scatter dots, and a corner frame', () => {
    const layout = layoutTitleSlide(slide);
    expect(layout.glow.w).toBeGreaterThan(0);
    expect(layout.scatter.length).toBeGreaterThan(0);
    expect(layout.cornerFrame).toEqual(cornerFrameBox());
  });
});

describe('layoutAgendaSlide', () => {
  const slide: AgendaSlide = { kind: 'agenda', eyebrow: 'TONIGHT', heading: 'AGENDA', rows: ['01 Seeding', '02 The Bracket', '03 The Final'] };

  it('produces one row per agenda entry, in order, non-overlapping', () => {
    const layout = layoutAgendaSlide(slide);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.map((r) => r.key)).toEqual(['row-0', 'row-1', 'row-2']);
    for (let i = 1; i < layout.rows.length; i++) {
      expect(layout.rows[i]!.y).toBeGreaterThanOrEqual(layout.rows[i - 1]!.y + layout.rows[i - 1]!.h);
    }
  });

  it('handles zero rows', () => {
    const layout = layoutAgendaSlide({ ...slide, rows: [] });
    expect(layout.rows).toEqual([]);
  });
});

describe('layoutContentSlide', () => {
  const slide: ContentSlide = {
    kind: 'content',
    eyebrow: 'WHO WE ARE',
    heading: 'WHAT IS ACM?',
    bullets: ['One.', 'Two.', 'Three.'],
  };

  it('produces one bullet box per bullet, stacked top to bottom', () => {
    const layout = layoutContentSlide(slide);
    expect(layout.bullets).toHaveLength(3);
    for (let i = 1; i < layout.bullets.length; i++) {
      expect(layout.bullets[i]!.y).toBeGreaterThan(layout.bullets[i - 1]!.y);
    }
  });

  it('places the optional image below the bullets when present', () => {
    const layout = layoutContentSlide({ ...slide, image: 'x.png' });
    const lastBullet = layout.bullets[layout.bullets.length - 1]!;
    expect(layout.image).not.toBeNull();
    expect(layout.image!.y).toBeGreaterThan(lastBullet.y);
  });

  it('only frames slides whose heading matches the "thanks" card', () => {
    expect(layoutContentSlide(slide).cornerFrame).toBeNull();
    expect(layoutContentSlide({ ...slide, heading: 'THANKS FOR COMING!' }).cornerFrame).not.toBeNull();
  });
});

describe('layoutSlide', () => {
  it('dispatches to the matching per-kind layout function', () => {
    const title: TitleSlide = { kind: 'title', heading: 'X' };
    const agenda: AgendaSlide = { kind: 'agenda', heading: 'X', rows: [] };
    const content: ContentSlide = { kind: 'content', heading: 'X', bullets: [] };
    expect(layoutSlide(title)).toEqual(layoutTitleSlide(title));
    expect(layoutSlide(agenda)).toEqual(layoutAgendaSlide(agenda));
    expect(layoutSlide(content)).toEqual(layoutContentSlide(content));
  });
});

// ---------------------------------------------------------------------------
// Seeding-scene layout
// ---------------------------------------------------------------------------

describe('seedingColumnLayout', () => {
  it('lays out rank / name / wins / losses left to right, non-overlapping', () => {
    const cols = seedingColumnLayout();
    expect(cols.rank.x).toBeLessThan(cols.name.x);
    expect(cols.name.x + cols.name.w).toBeCloseTo(cols.wins.x);
    expect(cols.wins.x + cols.wins.w).toBeCloseTo(cols.losses.x);
  });
});

describe('seedingRowsLayout', () => {
  it('stacks one row per name, keyed by name, top to bottom', () => {
    const rows = seedingRowsLayout(['Alpha', 'Bravo', 'Charlie']);
    expect(rows.map((r) => r.key)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(rows[0]!.y).toBeLessThan(rows[1]!.y);
    expect(rows[1]!.y).toBeLessThan(rows[2]!.y);
  });

  it('gives the same x/w across every row (only y differs)', () => {
    const rows = seedingRowsLayout(['A', 'B', 'C']);
    expect(new Set(rows.map((r) => r.x)).size).toBe(1);
    expect(new Set(rows.map((r) => r.w)).size).toBe(1);
  });

  it('reordering names reuses the same y slots (drives the FLIP tween)', () => {
    const alpha = seedingRowsLayout(['A', 'B', 'C']);
    const settled = seedingRowsLayout(['C', 'A', 'B']);
    const ys = alpha.map((r) => r.y);
    expect(settled.map((r) => r.y)).toEqual(ys);
    expect(settled[0]!.key).toBe('C');
  });
});

describe('seedingMarqueeStrip', () => {
  it('spans the full stage width near the bottom', () => {
    const strip = seedingMarqueeStrip();
    expect(strip.x).toBe(0);
    expect(strip.w).toBe(STAGE_WIDTH);
    expect(strip.y + strip.h).toBeLessThan(STAGE_HEIGHT);
  });
});

describe('odometerDigitSlots', () => {
  it('right-aligns N digit slots within a column box', () => {
    const cols = seedingColumnLayout();
    const slots = odometerDigitSlots(cols.wins, 2);
    expect(slots).toHaveLength(2);
    const last = slots[slots.length - 1]!;
    expect(last.x + last.w).toBeCloseTo(cols.wins.x + cols.wins.w);
    expect(slots[0]!.x).toBeLessThan(slots[1]!.x);
  });
});

// ---------------------------------------------------------------------------
// Bracket-scene layout
// ---------------------------------------------------------------------------

function bracketMatch(round: string, slot: number, overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    match_id: `${round}-${slot}`,
    round,
    slot,
    team_a: { name: `${round}-${slot}-A`, repo_url: 'x' },
    team_b: { name: `${round}-${slot}-B`, repo_url: 'x' },
    winner: null,
    bye: false,
    ...overrides,
  };
}

/** An 8-team single-elim bracket: Round 1 (4), Round 2 (2), Final (1). */
function eightTeamRounds(): BracketRound[] {
  return [
    {
      round: 'Round 1',
      matches: [0, 1, 2, 3].map((slot) => bracketMatch('Round 1', slot)),
    },
    {
      round: 'Round 2',
      matches: [0, 1].map((slot) => bracketMatch('Round 2', slot)),
    },
    {
      round: 'Final',
      matches: [bracketMatch('Final', 0)],
    },
  ];
}

describe('layoutBracket', () => {
  it('lays out a two-sided draw with cards for every round and a centered final', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    // 4 Round-1 + 2 Round-2 cards, split across both sides = same totals as input.
    expect(layout.cards.filter((c) => c.round === 'Round 1')).toHaveLength(4);
    expect(layout.cards.filter((c) => c.round === 'Round 2')).toHaveLength(2);
    expect(layout.final).not.toBeNull();
    expect(layout.final!.x + layout.final!.w / 2).toBeCloseTo(STAGE_WIDTH / 2, 0);
  });

  it('keys the final card in the same `${round}#${slot}` format as every other card (matches show.ts bracketRevealKey)', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    expect(layout.final!.key).toBe('Final#0');
    expect(layout.final!.round).toBe('Final');
    expect(layout.final!.slot).toBe(0);
  });

  it('grows the left half rightward and the right half leftward, meeting in the middle', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    const round1 = layout.cards.filter((c) => c.round === 'Round 1');
    const leftCards = round1.filter((c) => c.x < STAGE_WIDTH / 2);
    const rightCards = round1.filter((c) => c.x > STAGE_WIDTH / 2);
    expect(leftCards.length).toBeGreaterThan(0);
    expect(rightCards.length).toBeGreaterThan(0);
    const round2 = layout.cards.filter((c) => c.round === 'Round 2');
    const leftR2 = round2.find((c) => c.x < STAGE_WIDTH / 2);
    const leftR1 = leftCards[0]!;
    expect(leftR2!.x).toBeGreaterThan(leftR1.x);
  });

  it('produces connector paths from every non-round-1 card back to a predecessor', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    const round2Card = layout.cards.find((c) => c.round === 'Round 2')!;
    const connectorsIntoRound2 = layout.connectors.filter((c) => c.toKey === round2Card.key);
    expect(connectorsIntoRound2.length).toBe(2); // one per predecessor (slot*2, slot*2+1)
    for (const connector of connectorsIntoRound2) {
      expect(connector.points.length).toBeGreaterThanOrEqual(2);
      expect(layout.cards.some((c) => c.key === connector.fromKey)).toBe(true);
    }
  });

  it('connects the last round of each side into the final card', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    const intoFinal = layout.connectors.filter((c) => c.toKey === layout.final!.key);
    expect(intoFinal).toHaveLength(2);
    expect(intoFinal.map((c) => c.side).sort()).toEqual(['a', 'b']);
  });

  it('falls back to a one-sided layout for a small (< 4 first-round matches) bracket', () => {
    const rounds: BracketRound[] = [
      { round: 'Semifinal', matches: [bracketMatch('Semifinal', 0), bracketMatch('Semifinal', 1)] },
      { round: 'Final', matches: [bracketMatch('Final', 0)] },
    ];
    const split = splitBracket(rounds);
    const layout = layoutBracket(split);
    expect(layout.cards.filter((c) => c.round === 'Semifinal')).toHaveLength(2);
    expect(layout.final).not.toBeNull();
  });

  it('links BOTH of the final\'s predecessor slots even in a one-sided (unsided) bracket, where both semifinals live in `split.left`', () => {
    // Regression test: a naive "side a <- left, side b <- right" final
    // connector would silently skip slot b's connector here (`right` is
    // empty in the unsided fallback), making `sideRevealed` treat the
    // second semifinal's winner as having no predecessor -- i.e. always
    // revealed, spoiling the final before that semifinal is even played.
    const rounds: BracketRound[] = [
      { round: 'Semifinal', matches: [bracketMatch('Semifinal', 0), bracketMatch('Semifinal', 1)] },
      { round: 'Final', matches: [bracketMatch('Final', 0)] },
    ];
    const split = splitBracket(rounds);
    expect(split.sided).toBe(false);
    const layout = layoutBracket(split);

    const intoFinal = layout.connectors.filter((c) => c.toKey === layout.final!.key);
    expect(intoFinal).toHaveLength(2);
    expect(intoFinal.map((c) => c.side).sort()).toEqual(['a', 'b']);
    expect(intoFinal.map((c) => c.fromKey).sort()).toEqual(['Semifinal#0', 'Semifinal#1']);
  });
});

describe('bracketRound1NamePositions', () => {
  it('maps every round-1 team name to a box inside its round-1 card', () => {
    const split = splitBracket(eightTeamRounds());
    const layout = layoutBracket(split);
    const positions = bracketRound1NamePositions(split, layout);
    expect(positions.size).toBe(8);
    const card = layout.cards.find((c) => c.round === 'Round 1' && c.slot === 0)!;
    expect(positions.get('Round 1-0-A')).toEqual(bracketNameRowBox(card, 'a'));
    expect(positions.get('Round 1-0-B')).toEqual(bracketNameRowBox(card, 'b'));
  });
});

describe('bracketNameRowBox', () => {
  it('splits a card into a top (a) and bottom (b) row, non-overlapping', () => {
    const card = { key: 'card', x: 0, y: 0, w: 260, h: 88 };
    const a = bracketNameRowBox(card, 'a');
    const b = bracketNameRowBox(card, 'b');
    expect(a.y).toBeLessThan(b.y);
    expect(a.y + a.h).toBeCloseTo(b.y);
  });
});

// ---------------------------------------------------------------------------
// Match-scene layout
// ---------------------------------------------------------------------------

describe('dualBoardsLayout', () => {
  it('places two equal, non-overlapping square boards side by side', () => {
    const [a, b] = dualBoardsLayout();
    expect(a.board.w).toBe(a.board.h);
    expect(a.board.w).toBe(b.board.w);
    expect(a.board.x + a.board.w).toBeLessThanOrEqual(b.board.x);
  });

  it('gives each board a left/right clock zone above it', () => {
    const [a] = dualBoardsLayout();
    expect(a.clocks.left.y).toBeLessThan(a.board.y);
    expect(a.clocks.left.x).toBeLessThan(a.clocks.right.x);
  });
});

describe('singleBoardLayout', () => {
  it('centers a single square board on the stage', () => {
    const { board } = singleBoardLayout();
    expect(board.w).toBe(board.h);
    expect(board.x + board.w / 2).toBeCloseTo(STAGE_WIDTH / 2);
  });
});

// ---------------------------------------------------------------------------
// Champion-scene layout
// ---------------------------------------------------------------------------

describe('layoutChampion', () => {
  it('centers the hero text and provides a dense scatter', () => {
    const layout = layoutChampion();
    expect(layout.hero.x + layout.hero.w / 2).toBeCloseTo(STAGE_WIDTH / 2);
    expect(layout.eyebrow.y).toBeLessThan(layout.hero.y);
    expect(layout.scatter.length).toBeGreaterThan(0);
  });
});
