// Pixi seeding-reveal scene (SHOW_PLAN.md §4.2, §9c items 1/3/4): gray
// alphabetical rows with 0-0 records that, on phase advance, tween (~6s) to
// rank order via the SAME keyed row objects moving between two computed
// layout.ts layouts (the FLIP-equivalent -- no DOM measurement needed,
// unlike the old scenes.tsx version), a masked odometer digit roll for the
// W-L columns, and a top-seed red flash. A results marquee auto-scrolls
// along the bottom the whole time.
//
// Per the Iron Rule (SHOW_PLAN.md §9b): row/digit positions are pure
// timeline.ts tracks, applied every `useTick` via useTimeline.ts's ref
// registry -- `settled` (a prop, changing only at a phase boundary) is the
// only thing that ever triggers a `setTracks()` (inside an effect, not a
// tick callback).
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- the layout/data it renders IS tested (layout.ts,
// seeding.ts, standings.ts).

import '../pixiExtend.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTick } from '@pixi/react';
import type { Graphics as PixiGraphics, Text as PixiText } from 'pixi.js';
import type { StandingsEntry } from '@acm-uga/c4-contract';
import { alphabeticalOrder, finalOrder } from '../../seeding.js';
import {
  ODOMETER_DIGIT_HEIGHT,
  STAGE_WIDTH,
  odometerDigitSlots,
  seedingColumnLayout,
  seedingMarqueeStrip,
  seedingRowsLayout,
  type PlacedElement,
} from '../layout.js';
import { chain, easeInOutCubic, easeOutCubic, track } from '../timeline.js';
import { useTimelineRefs, type TimelineRefs } from '../useTimeline.js';
import { eyebrowTextStyle, headingTextStyle, monoTextStyle, rowTextStyle } from '../textStyles.js';
import { TOKENS } from '@acm-uga/c4-theme/tokens';

type Register = TimelineRefs['register'];

const SEED_SORT_DURATION_MS = 6000;
const ODOMETER_DURATION_MS = 1400;
const FLASH_DURATION_MS = 900;
const HEADER_Y = 266;

const DIGITS = Array.from({ length: 10 }, (_, i) => i);

function toRowMap(rows: readonly PlacedElement[]): Map<string, PlacedElement> {
  return new Map(rows.map((r) => [r.key, r]));
}

/** One masked scrolling digit column, 0-9 stacked -- the timeline moves the strip's y so a `h`-tall window shows the active digit. */
function OdometerDigit({
  registerKey,
  register,
  x,
  w,
  h,
}: {
  registerKey: string;
  register: Register;
  x: number;
  w: number;
  h: number;
}) {
  // A digit strip taller than its `h`-tall window must be clipped by a real
  // Pixi mask (a background rect alone doesn't crop children drawn on top
  // of it) -- the mask Graphics only becomes assignable once its ref has
  // mounted, so this state flip forces the one extra render that picks it
  // up (not a per-frame update; it fires once, on mount).
  const [maskNode, setMaskNode] = useState<PixiGraphics | null>(null);

  return (
    <pixiContainer x={x} y={0}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.rect(0, 0, w, h).fill(TOKENS.card);
        }}
      />
      <pixiGraphics
        ref={(g) => {
          if (g && g !== maskNode) setMaskNode(g);
        }}
        draw={(g) => {
          g.clear();
          g.rect(0, 0, w, h).fill(TOKENS.chalk);
        }}
      />
      <pixiContainer ref={register(registerKey)} y={0} mask={maskNode ?? undefined}>
        {DIGITS.map((d) => (
          <pixiText
            key={d}
            text={String(d)}
            style={monoTextStyle({ fontSize: 24, fill: TOKENS.steel })}
            anchor={{ x: 0.5, y: 0.5 }}
            x={w / 2}
            y={d * h + h / 2}
          />
        ))}
      </pixiContainer>
    </pixiContainer>
  );
}

/** The two digit columns (tens/ones) for one W or L stat, right-aligned within `col`. */
function OdometerStat({ name, statKey, col, rowX, rowH, register }: { name: string; statKey: 'wins' | 'losses'; col: PlacedElement; rowX: number; rowH: number; register: Register }) {
  const slots = odometerDigitSlots(col, 2);
  return (
    <>
      {slots.map((slot, i) => (
        <OdometerDigit key={i} registerKey={`${statKey}-${i}-${name}`} register={register} x={slot.x - rowX} w={slot.w} h={rowH} />
      ))}
    </>
  );
}

interface SeedingRowProps {
  entry: StandingsEntry;
  settled: boolean;
  topSeed: boolean;
  cols: ReturnType<typeof seedingColumnLayout>;
  rowBox: PlacedElement;
  register: Register;
}

function SeedingRowNode({ entry, settled, topSeed, cols, rowBox, register }: SeedingRowProps) {
  const rowX = rowBox.x;
  return (
    <pixiContainer ref={register(`row-${entry.team.name}`)} x={rowBox.x} y={rowBox.y}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.rect(0, 0, rowBox.w, rowBox.h).fill(TOKENS.card);
          g.rect(0, 0, rowBox.w, rowBox.h).stroke({ width: 1, color: TOKENS.cardEdge });
        }}
      />
      {topSeed ? (
        <pixiGraphics
          ref={register(`flash-${entry.team.name}`)}
          alpha={0}
          draw={(g) => {
            g.clear();
            g.rect(0, 0, rowBox.w, rowBox.h).fill(TOKENS.bulldog);
          }}
        />
      ) : null}
      <pixiText
        text={settled ? String(entry.rank) : '--'}
        style={monoTextStyle({ fontSize: 24, fill: TOKENS.bulldog })}
        anchor={{ x: 0, y: 0.5 }}
        x={cols.rank.x - rowX + 20}
        y={rowBox.h / 2}
      />
      <pixiText
        text={entry.team.name}
        style={rowTextStyle({ fontSize: 26, fill: settled ? TOKENS.chalk : TOKENS.steel })}
        anchor={{ x: 0, y: 0.5 }}
        x={cols.name.x - rowX}
        y={rowBox.h / 2}
      />
      <OdometerStat name={entry.team.name} statKey="wins" col={cols.wins} rowX={rowX} rowH={rowBox.h} register={register} />
      <OdometerStat name={entry.team.name} statKey="losses" col={cols.losses} rowX={rowX} rowH={rowBox.h} register={register} />
    </pixiContainer>
  );
}

function Marquee({ marquee }: { marquee: string[] }) {
  const strip = seedingMarqueeStrip();
  const textRef = useRef<PixiText | null>(null);
  const xRef = useRef(0);
  const text = marquee.length > 0 ? `${marquee.join('    •    ')}    •    ` : '';

  useTick((ticker) => {
    const t = textRef.current;
    if (!t || marquee.length === 0) return;
    xRef.current -= 60 * (ticker.deltaMS / 1000);
    const loopWidth = t.width / 2;
    if (loopWidth > 0 && xRef.current <= -loopWidth) xRef.current += loopWidth;
    t.x = xRef.current;
  });

  if (marquee.length === 0) return null;

  return (
    <pixiContainer x={strip.x} y={strip.y}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.rect(0, -12, strip.w, strip.h + 12).fill(TOKENS.ink);
          g.moveTo(0, -12).lineTo(strip.w, -12).stroke({ width: 1, color: TOKENS.cardEdge });
        }}
      />
      <pixiText
        ref={textRef}
        text={text + text}
        style={monoTextStyle({ fontSize: 20, fill: TOKENS.steel })}
        anchor={{ x: 0, y: 0 }}
        y={strip.h / 2 - 12}
      />
    </pixiContainer>
  );
}

/** Zero-padded 2-digit tens/ones for an odometer stat value (clamped so a >99 value doesn't overflow the two slots -- shouldn't happen for a round-robin record, but keeps the strip well-defined). */
function twoDigits(value: number): [number, number] {
  const clamped = Math.max(0, Math.min(99, Math.round(value)));
  return [Math.floor(clamped / 10), clamped % 10];
}

export function SeedingStage({
  standings,
  marquee,
  phaseIndex,
}: {
  standings: StandingsEntry[];
  marquee: string[];
  phaseIndex: number;
}) {
  const settled = phaseIndex >= 1;
  const cols = useMemo(() => seedingColumnLayout(), []);

  const alphaEntries = useMemo(() => alphabeticalOrder(standings), [standings]);
  const finalEntries = useMemo(() => finalOrder(standings), [standings]);
  const alphaNames = useMemo(() => alphaEntries.map((e) => e.team.name), [alphaEntries]);
  const finalNames = useMemo(() => finalEntries.map((e) => e.team.name), [finalEntries]);

  const alphaLayout = useMemo(() => toRowMap(seedingRowsLayout(alphaNames)), [alphaNames]);
  const finalLayout = useMemo(() => toRowMap(seedingRowsLayout(finalNames)), [finalNames]);

  const timeline = useTimelineRefs();

  useEffect(() => {
    const tracks = [];
    for (const name of alphaNames) {
      const from = alphaLayout.get(name)!;
      const to = settled ? finalLayout.get(name)! : from;
      tracks.push(track({ key: `row-${name}`, prop: 'y', t0: 0, t1: settled ? SEED_SORT_DURATION_MS : 0, from: from.y, to: to.y, ease: easeInOutCubic }));
    }

    for (const entry of finalEntries) {
      const [winsTens, winsOnes] = twoDigits(entry.match_wins);
      const [lossesTens, lossesOnes] = twoDigits(entry.match_losses);
      const digitTracks: [string, number][] = [
        [`wins-0-${entry.team.name}`, winsTens],
        [`wins-1-${entry.team.name}`, winsOnes],
        [`losses-0-${entry.team.name}`, lossesTens],
        [`losses-1-${entry.team.name}`, lossesOnes],
      ];
      for (const [key, digit] of digitTracks) {
        const target = -digit * ODOMETER_DIGIT_HEIGHT;
        tracks.push(track({ key, prop: 'y', t0: 0, t1: settled ? ODOMETER_DURATION_MS : 0, from: 0, to: settled ? target : 0, ease: easeOutCubic }));
      }
      if (settled && entry.rank === 1) {
        tracks.push(
          ...chain({
            key: `flash-${entry.team.name}`,
            prop: 'alpha',
            from: 0,
            segments: [
              { to: 0.6, duration: 60 },
              { to: 0, duration: FLASH_DURATION_MS, ease: easeOutCubic },
            ],
          }),
        );
      }
    }

    timeline.setTracks(tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, alphaNames, finalNames]);

  return (
    <pixiContainer>
      <pixiText text="ROUND ROBIN RESULTS" style={eyebrowTextStyle({ fontSize: 22 })} anchor={{ x: 0.5, y: 0 }} x={STAGE_WIDTH / 2} y={140} />
      <pixiText text="SEEDING" style={headingTextStyle({ fontSize: 56 })} anchor={{ x: 0.5, y: 0 }} x={STAGE_WIDTH / 2} y={186} />

      <pixiText text="#" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 0, y: 0 }} x={cols.rank.x + 20} y={HEADER_Y} />
      <pixiText text="TEAM" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 0, y: 0 }} x={cols.name.x} y={HEADER_Y} />
      <pixiText text="W" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 1, y: 0 }} x={cols.wins.x + cols.wins.w} y={HEADER_Y} />
      <pixiText text="L" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 1, y: 0 }} x={cols.losses.x + cols.losses.w} y={HEADER_Y} />

      {alphaEntries.map((entry) => {
        const rowBox = alphaLayout.get(entry.team.name)!;
        const finalEntry = finalEntries.find((e) => e.team.name === entry.team.name)!;
        return (
          <SeedingRowNode
            key={entry.team.name}
            entry={settled ? finalEntry : entry}
            settled={settled}
            topSeed={settled && finalEntry.rank === 1}
            cols={cols}
            rowBox={rowBox}
            register={timeline.register}
          />
        );
      })}

      <Marquee marquee={marquee} />
    </pixiContainer>
  );
}
