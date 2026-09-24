// Pixi seeding-reveal scene (SHOW_PLAN.md §4.2, §9c items 1/3/4): gray
// alphabetical rows with 0-0 records that, on phase advance, auto-play the
// round robin one match at a time (seeding.ts's `seedingReplay` frames):
// the winner's row flashes, the W-L odometers roll by one, and the SAME
// keyed row objects tween to the re-sorted order (the FLIP-equivalent --
// no DOM measurement needed). The last frame lands on the official ranks,
// fades the rank numbers in, and flashes the top seed. A results marquee
// auto-scrolls along the bottom the whole time.
//
// Per the Iron Rule (SHOW_PLAN.md §9b): the whole replay is precomputed as
// pure timeline.ts tracks, applied every `useTick` via useTimeline.ts's ref
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
import { finalOrder, seedingStepMs, type SeedingFrame } from '../../seeding.js';
import {
  ODOMETER_DIGIT_HEIGHT,
  STAGE_WIDTH,
  odometerDigitSlots,
  seedingColumnLayout,
  seedingMarqueeStrip,
  seedingRowsLayout,
  type PlacedElement,
} from '../layout.js';
import { chain, easeInOutCubic, easeOutCubic, hold, track, type Track } from '../timeline.js';
import { useTimelineRefs, type TimelineRefs } from '../useTimeline.js';
import { eyebrowTextStyle, headingTextStyle, monoTextStyle, rowTextStyle } from '../textStyles.js';
import { TOKENS } from '@acm-uga/c4-theme/tokens';

type Register = TimelineRefs['register'];

/** Share of each replay step spent moving rows / rolling digits; the rest is a beat of stillness before the next result. */
const STEP_MOTION_SHARE = 0.75;
const RANK_FADE_MS = 400;
const FLASH_DURATION_MS = 900;
const STEP_FLASH_ALPHA = 0.35;
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
  cols: ReturnType<typeof seedingColumnLayout>;
  rowBox: PlacedElement;
  register: Register;
}

function SeedingRowNode({ entry, settled, cols, rowBox, register }: SeedingRowProps) {
  const rowX = rowBox.x;
  const name = entry.team.name;
  return (
    <pixiContainer ref={register(`row-${name}`)} x={rowBox.x} y={rowBox.y}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.rect(0, 0, rowBox.w, rowBox.h).fill(TOKENS.card);
          g.rect(0, 0, rowBox.w, rowBox.h).stroke({ width: 1, color: TOKENS.cardEdge });
        }}
      />
      <pixiGraphics
        ref={register(`flash-${name}`)}
        alpha={0}
        draw={(g) => {
          g.clear();
          g.rect(0, 0, rowBox.w, rowBox.h).fill(TOKENS.bulldog);
        }}
      />
      <pixiText
        ref={register(`rankdash-${name}`)}
        text="--"
        style={monoTextStyle({ fontSize: 24, fill: TOKENS.bulldog })}
        anchor={{ x: 0, y: 0.5 }}
        x={cols.rank.x - rowX + 20}
        y={rowBox.h / 2}
      />
      <pixiText
        ref={register(`rank-${name}`)}
        text={String(entry.rank)}
        alpha={0}
        style={monoTextStyle({ fontSize: 24, fill: TOKENS.bulldog })}
        anchor={{ x: 0, y: 0.5 }}
        x={cols.rank.x - rowX + 20}
        y={rowBox.h / 2}
      />
      <pixiText
        text={name}
        style={rowTextStyle({ fontSize: 26, fill: settled ? TOKENS.chalk : TOKENS.steel })}
        anchor={{ x: 0, y: 0.5 }}
        x={cols.name.x - rowX}
        y={rowBox.h / 2}
      />
      <OdometerStat name={name} statKey="wins" col={cols.wins} rowX={rowX} rowH={rowBox.h} register={register} />
      <OdometerStat name={name} statKey="losses" col={cols.losses} rowX={rowX} rowH={rowBox.h} register={register} />
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

/** Tracks rolling one stat's two odometer digits from `from` to `to` over [t0, t1) -- only the digits that actually change get a track. */
function odometerTracks(name: string, statKey: 'wins' | 'losses', from: number, to: number, t0: number, t1: number): Track[] {
  const before = twoDigits(from);
  const after = twoDigits(to);
  const tracks: Track[] = [];
  for (let i = 0; i < 2; i++) {
    if (before[i] === after[i]) continue;
    tracks.push(
      track({ key: `${statKey}-${i}-${name}`, prop: 'y', t0, t1, from: -before[i]! * ODOMETER_DIGIT_HEIGHT, to: -after[i]! * ODOMETER_DIGIT_HEIGHT, ease: easeOutCubic }),
    );
  }
  return tracks;
}

/** The whole replay as one track list: frame i's motion starts at (i - 1) * stepMs. */
function replayTracks(replay: readonly SeedingFrame[], standings: readonly StandingsEntry[]): Track[] {
  const tracks: Track[] = [];
  const stepMs = seedingStepMs(replay.length - 1);
  const motionMs = stepMs * STEP_MOTION_SHARE;
  const rowY = replay.map((frame) => toRowMap(seedingRowsLayout(frame.rows.map((r) => r.name))));

  for (let i = 1; i < replay.length; i++) {
    const t0 = (i - 1) * stepMs;
    const t1 = t0 + motionMs;
    const prev = new Map(replay[i - 1]!.rows.map((r) => [r.name, r]));

    for (const row of replay[i]!.rows) {
      const before = prev.get(row.name);
      if (!before) continue;
      const fromY = rowY[i - 1]!.get(row.name)!.y;
      const toY = rowY[i]!.get(row.name)!.y;
      if (fromY !== toY) tracks.push(track({ key: `row-${row.name}`, prop: 'y', t0, t1, from: fromY, to: toY, ease: easeInOutCubic }));
      tracks.push(...odometerTracks(row.name, 'wins', before.wins, row.wins, t0, t1));
      tracks.push(...odometerTracks(row.name, 'losses', before.losses, row.losses, t0, t1));
    }

    const winner = replay[i]!.winner;
    if (winner) {
      tracks.push(
        ...chain({
          key: `flash-${winner}`,
          prop: 'alpha',
          from: 0,
          startAt: t0,
          segments: [
            { to: STEP_FLASH_ALPHA, duration: 60 },
            { to: 0, duration: motionMs, ease: easeOutCubic },
          ],
        }),
      );
    }
  }

  // Closing beat, on the last (official) frame: ranks fade in, #1 flashes.
  const finalAt = (replay.length - 2) * stepMs;
  for (const entry of standings) {
    const name = entry.team.name;
    tracks.push(track({ key: `rankdash-${name}`, prop: 'alpha', t0: finalAt, t1: finalAt + RANK_FADE_MS, from: 1, to: 0 }));
    tracks.push(track({ key: `rank-${name}`, prop: 'alpha', t0: finalAt, t1: finalAt + RANK_FADE_MS, from: 0, to: 1 }));
    if (entry.rank === 1) {
      tracks.push(
        ...chain({
          key: `flash-${name}`,
          prop: 'alpha',
          from: 0,
          startAt: finalAt,
          segments: [
            { to: 0.6, duration: 60 },
            { to: 0, duration: FLASH_DURATION_MS, ease: easeOutCubic },
          ],
        }),
      );
    }
  }
  return tracks;
}

/** Holds every row/digit/rank at the opening frame (alphabetical, 0-0, no ranks) -- phase 0, and the reset when stepping back into it. */
function openingTracks(replay: readonly SeedingFrame[]): Track[] {
  const opening = replay[0];
  if (!opening) return [];
  const rows = seedingRowsLayout(opening.rows.map((r) => r.name));
  const tracks: Track[] = [];
  opening.rows.forEach((row, i) => {
    const name = row.name;
    tracks.push(hold(`row-${name}`, 'y', rows[i]!.y, 0, 0));
    for (const statKey of ['wins', 'losses'] as const) {
      for (let d = 0; d < 2; d++) tracks.push(hold(`${statKey}-${d}-${name}`, 'y', 0, 0, 0));
    }
    tracks.push(hold(`flash-${name}`, 'alpha', 0, 0, 0));
    tracks.push(hold(`rankdash-${name}`, 'alpha', 1, 0, 0));
    tracks.push(hold(`rank-${name}`, 'alpha', 0, 0, 0));
  });
  return tracks;
}

export function SeedingStage({
  standings,
  replay,
  marquee,
  phaseIndex,
}: {
  standings: StandingsEntry[];
  replay: SeedingFrame[];
  marquee: string[];
  phaseIndex: number;
}) {
  const settled = phaseIndex >= 1;
  const cols = useMemo(() => seedingColumnLayout(), []);

  const entriesByName = useMemo(() => new Map(finalOrder(standings).map((e) => [e.team.name, e])), [standings]);
  const openingNames = useMemo(() => (replay[0]?.rows ?? []).map((r) => r.name), [replay]);
  const openingLayout = useMemo(() => toRowMap(seedingRowsLayout(openingNames)), [openingNames]);

  const timeline = useTimelineRefs();

  useEffect(() => {
    timeline.setTracks([...openingTracks(replay), ...(settled ? replayTracks(replay, standings) : [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, replay, standings]);

  return (
    <pixiContainer>
      <pixiText text="ROUND ROBIN RESULTS" style={eyebrowTextStyle({ fontSize: 22 })} anchor={{ x: 0.5, y: 0 }} x={STAGE_WIDTH / 2} y={140} />
      <pixiText text="SEEDING" style={headingTextStyle({ fontSize: 56 })} anchor={{ x: 0.5, y: 0 }} x={STAGE_WIDTH / 2} y={186} />

      <pixiText text="#" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 0, y: 0 }} x={cols.rank.x + 20} y={HEADER_Y} />
      <pixiText text="TEAM" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 0, y: 0 }} x={cols.name.x} y={HEADER_Y} />
      <pixiText text="W" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 1, y: 0 }} x={cols.wins.x + cols.wins.w} y={HEADER_Y} />
      <pixiText text="L" style={monoTextStyle({ fontSize: 16, fill: TOKENS.steel })} anchor={{ x: 1, y: 0 }} x={cols.losses.x + cols.losses.w} y={HEADER_Y} />

      {openingNames.map((name) => {
        const entry = entriesByName.get(name);
        if (!entry) return null;
        return <SeedingRowNode key={name} entry={entry} settled={settled} cols={cols} rowBox={openingLayout.get(name)!} register={timeline.register} />;
      })}

      <Marquee marquee={marquee} />
    </pixiContainer>
  );
}
