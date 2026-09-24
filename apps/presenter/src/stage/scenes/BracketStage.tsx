// Pixi bracket scene (SHOW_PLAN.md §5, §9c items 1/2/3): the two-sided tree
// with drawn connector lines, reveal semantics preserved (no spoilers -- a
// slot's team names only render once its predecessor match is in
// `revealedThrough`). On entry:
//   - the very first bracket scene (right after seeding) plays the
//     table->bracket MORPH: round-1 name pills tween in from their settled
//     seeding-row position (`morphFrom`) into their round-1 card slot.
//   - a scene with `justAdvanced`/`justEliminated` plays the winner-travel
//     (source card's name pill tweens along the connector into its next
//     slot, landing with a flash + spark burst) and loser-tumble (rotates,
//     falls, sheds debris) cues.
// Every other slot renders statically at its settled position -- no replay
// of a historical animation on a fresh mount (this component fully
// remounts every scene change, per StageView's `key={sceneIndex}`).
//
// Per the Iron Rule (SHOW_PLAN.md §9b): every animated slot's position
// comes from a timeline.ts track, applied via useTimeline.ts's ref
// registry inside one effect keyed on the scene's identity -- never a
// tick-driven `setState`.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- the layout/reveal logic it renders IS tested (layout.ts,
// bracketLayout.ts, show.ts).

import '../pixiExtend.js';
import { useEffect, useMemo } from 'react';
import type { BracketMatch } from '@connect-4/contract';
import type { Scene } from '../../show.js';
import { bracketRevealKey } from '../../show.js';
import { finalOrder } from '../../seeding.js';
import {
  bracketNameRowBox,
  bracketRound1NamePositions,
  layoutBracket,
  seedingRowsLayout,
  STAGE_WIDTH,
  type BracketCardBox,
  type BracketConnector,
  type BracketSceneLayout,
} from '../layout.js';
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, chain, track, type Track } from '../timeline.js';
import { useTimelineRefs, type TimelineRefs } from '../useTimeline.js';
import { eyebrowTextStyle, rowTextStyle } from '../textStyles.js';
import { ParticleField } from '../ParticleField.js';
import { ELIMINATION_DEBRIS_CONFIG, WINNING_FOUR_SPARK_CONFIG } from '../particles.js';
import { TOKENS } from '@connect-4/theme/tokens';

type Register = TimelineRefs['register'];
type BracketSceneT = Extract<Scene, { type: 'bracket' }>;

const MORPH_DURATION_MS = 800;
const MORPH_STAGGER_MS = 40;
const TRAVEL_DURATION_MS = 700;
const TUMBLE_DURATION_MS = 900;

function matchesOf(split: BracketSceneT['layout']): BracketMatch[] {
  const all: BracketMatch[] = [];
  for (const round of split.left) all.push(...round.matches);
  for (const round of split.right) all.push(...round.matches);
  if (split.final) all.push(...split.final.matches);
  return all;
}

function findConnector(connectors: readonly BracketConnector[], toKey: string, side: 'a' | 'b'): BracketConnector | undefined {
  return connectors.find((c) => c.toKey === toKey && c.side === side);
}

interface NameSlotProps {
  registerKey: string;
  register: Register;
  x: number;
  y: number;
  w: number;
  text: string;
  color: string;
  bold?: boolean;
}

function NameSlot({ registerKey, register, x, y, w, text, color, bold }: NameSlotProps) {
  return (
    <pixiContainer ref={register(registerKey)} x={x} y={y}>
      <pixiText
        text={text}
        style={rowTextStyle({ fontSize: bold ? 22 : 20, fill: color, wordWrap: true, wordWrapWidth: w })}
        anchor={{ x: 0, y: 0.5 }}
      />
    </pixiContainer>
  );
}

function CardChrome({ card }: { card: BracketCardBox }) {
  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        g.roundRect(card.x, card.y, card.w, card.h, 8).fill(TOKENS.card).stroke({ width: 1, color: TOKENS.cardEdge });
        g.moveTo(card.x, card.y + card.h / 2).lineTo(card.x + card.w, card.y + card.h / 2).stroke({ width: 1, color: TOKENS.cardEdge });
      }}
    />
  );
}

function Connectors({ connectors }: { connectors: readonly BracketConnector[] }) {
  return (
    <pixiGraphics
      draw={(g) => {
        g.clear();
        for (const connector of connectors) {
          const [first, ...rest] = connector.points;
          if (!first) continue;
          g.moveTo(first.x, first.y);
          for (const p of rest) g.lineTo(p.x, p.y);
          g.stroke({ width: 2, color: TOKENS.cardEdge });
        }
      }}
    />
  );
}

export function BracketStage({
  scene,
  prevRevealedThrough,
  morphFromStandings,
}: {
  scene: BracketSceneT;
  /** The immediately-preceding scene's `revealedThrough`, if it was also a bracket scene -- diffed against this scene's to find "the just-decided card" (winner-travel/loser-tumble source). `null` for the very first bracket scene (only byes are pre-revealed; nothing "just" happened). */
  prevRevealedThrough: ReadonlySet<string> | null;
  /** Standings to morph FROM (SHOW_PLAN.md §9c item 1) -- set only on the very first bracket scene, right after the seeding reveal. */
  morphFromStandings: import('@connect-4/contract').StandingsEntry[] | null;
}) {
  const { layout: split, revealedThrough, justAdvanced, justEliminated } = scene;

  const bracketLayout: BracketSceneLayout = useMemo(() => layoutBracket(split), [split]);
  const matchByKey = useMemo(() => {
    const map = new Map<string, BracketMatch>();
    for (const m of matchesOf(split)) map.set(bracketRevealKey(m), m);
    return map;
  }, [split]);

  const timeline = useTimelineRefs();

  const decidedKey = useMemo(() => {
    if (!prevRevealedThrough) return null;
    for (const key of revealedThrough) {
      if (!prevRevealedThrough.has(key)) return key;
    }
    return null;
  }, [revealedThrough, prevRevealedThrough]);
  const decidedMatch = decidedKey ? matchByKey.get(decidedKey) : undefined;
  const outgoingConnector = decidedKey ? bracketLayout.connectors.find((c) => c.fromKey === decidedKey) : undefined;
  const decidedCard = decidedKey ? (bracketLayout.cards.find((c) => c.key === decidedKey) ?? (bracketLayout.final?.key === decidedKey ? bracketLayout.final : undefined)) : undefined;
  const destinationCard = outgoingConnector
    ? (bracketLayout.cards.find((c) => c.key === outgoingConnector.toKey) ?? (bracketLayout.final?.key === outgoingConnector.toKey ? bracketLayout.final : undefined))
    : undefined;
  const winnerSide: 'a' | 'b' | undefined = decidedMatch ? (decidedMatch.team_a?.name === justAdvanced?.name ? 'a' : 'b') : undefined;
  const loserSide: 'a' | 'b' | undefined = winnerSide ? (winnerSide === 'a' ? 'b' : 'a') : undefined;

  function sideRevealed(cardKey: string, side: 'a' | 'b'): boolean {
    const connector = findConnector(bracketLayout.connectors, cardKey, side);
    if (!connector) return true; // round-1: seeded directly, no predecessor suspense
    return revealedThrough.has(connector.fromKey);
  }

  useEffect(() => {
    const tracks: Track[] = [];

    // --- Item 1: table -> bracket morph (first bracket scene only). ---
    if (morphFromStandings) {
      const settledNames = finalOrder(morphFromStandings).map((e) => e.team.name);
      const seedingPositions = new Map(seedingRowsLayout(settledNames).map((r) => [r.key, r]));
      const destinations = bracketRound1NamePositions(split, bracketLayout);
      settledNames.forEach((name, i) => {
        const from = seedingPositions.get(name);
        const to = destinations.get(name);
        const t0 = i * MORPH_STAGGER_MS;
        if (from && to) {
          tracks.push(track({ key: `morph-${name}`, prop: 'x', t0, t1: t0 + MORPH_DURATION_MS, from: from.x, to: to.x, ease: easeOutCubic }));
          tracks.push(track({ key: `morph-${name}`, prop: 'y', t0, t1: t0 + MORPH_DURATION_MS, from: from.y, to: to.y, ease: easeOutCubic }));
        } else if (from) {
          // Non-qualifier: fade out in place.
          tracks.push(track({ key: `morph-${name}`, prop: 'x', t0: 0, t1: 0, from: from.x, to: from.x }));
          tracks.push(track({ key: `morph-${name}`, prop: 'y', t0: 0, t1: 0, from: from.y, to: from.y }));
          tracks.push(track({ key: `morph-${name}`, prop: 'alpha', t0, t1: t0 + MORPH_DURATION_MS, from: 1, to: 0, ease: easeOutCubic }));
        }
      });
    }

    // --- Items 2/3: winner travel + loser tumble (the just-decided card). ---
    if (decidedCard && loserSide && justEliminated) {
      const box = bracketNameRowBox(decidedCard, loserSide);
      tracks.push(track({ key: `slot-${decidedCard.key}-${loserSide}`, prop: 'y', t0: 0, t1: TUMBLE_DURATION_MS, from: box.y, to: box.y + 220, ease: easeInCubic }));
      tracks.push(track({ key: `slot-${decidedCard.key}-${loserSide}`, prop: 'rotation', t0: 0, t1: TUMBLE_DURATION_MS, from: 0, to: 0.35, ease: easeInCubic }));
      tracks.push(track({ key: `slot-${decidedCard.key}-${loserSide}`, prop: 'alpha', t0: 150, t1: TUMBLE_DURATION_MS, from: 1, to: 0, ease: easeInCubic }));
    }

    if (decidedCard && winnerSide && outgoingConnector && destinationCard) {
      const from = bracketNameRowBox(decidedCard, winnerSide);
      const to = bracketNameRowBox(destinationCard, outgoingConnector.side);
      const slotKey = `slot-${outgoingConnector.toKey}-${outgoingConnector.side}`;
      tracks.push(track({ key: slotKey, prop: 'x', t0: 0, t1: TRAVEL_DURATION_MS, from: from.x, to: to.x, ease: easeInOutCubic }));
      tracks.push(track({ key: slotKey, prop: 'y', t0: 0, t1: TRAVEL_DURATION_MS, from: from.y, to: to.y, ease: easeOutBack }));
      tracks.push(
        ...chain({
          key: `flash-${slotKey}`,
          prop: 'alpha',
          from: 0,
          startAt: TRAVEL_DURATION_MS,
          segments: [
            { to: 0.85, duration: 60 },
            { to: 0, duration: 500, ease: easeOutCubic },
          ],
        }),
      );
    }

    timeline.setTracks(tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  function renderSlot(card: BracketCardBox, side: 'a' | 'b', match: BracketMatch | undefined) {
    const box = bracketNameRowBox(card, side);
    const revealed = sideRevealed(card.key, side);
    const isBye = match?.bye && side === 'b';
    const team = side === 'a' ? match?.team_a : match?.team_b;
    const winnerRevealed = revealedThrough.has(card.key);
    const isWinner = winnerRevealed && match?.winner && team && match.winner.name === team.name;
    const isDecidedCard = card.key === decidedKey;
    const dim = winnerRevealed && !isWinner && !isDecidedCard;

    const label = isBye ? 'BYE' : revealed ? (team?.name ?? 'TBD') : 'TBD';
    const color = !revealed || isBye ? TOKENS.steel : dim ? TOKENS.graphite : isWinner ? TOKENS.chalk : TOKENS.chalk;

    // Round-1 morph pill (first bracket scene) or winner-travel pill (just-decided transition) render via the timeline registry at a *different* key than their settled slot key, so the static render below is skipped for them (avoids a duplicate).
    const isMorphing = morphFromStandings !== null && card.round === split.left[0]?.round && !isBye;
    const isRound1Right = morphFromStandings !== null && split.sided && card.round === split.right[0]?.round;
    const isTravelDestination =
      decidedKey !== null && outgoingConnector !== undefined && outgoingConnector.toKey === card.key && outgoingConnector.side === side;

    if (revealed && (isMorphing || isRound1Right) && team) {
      return <NameSlot key={`${card.key}-${side}`} registerKey={`morph-${team.name}`} register={timeline.register} x={0} y={0} w={box.w} text={label} color={color} bold={Boolean(isWinner)} />;
    }

    if (revealed && isTravelDestination && team) {
      const slotKey = `slot-${card.key}-${side}`;
      return (
        <pixiContainer key={`${card.key}-${side}`}>
          <pixiGraphics
            ref={timeline.register(`flash-${slotKey}`)}
            alpha={0}
            draw={(g) => {
              g.clear();
              g.rect(box.x - 4, box.y, box.w + 8, box.h).fill(TOKENS.bulldog);
            }}
          />
          <NameSlot registerKey={slotKey} register={timeline.register} x={box.x} y={box.y + box.h / 2} w={box.w} text={label} color={color} bold={Boolean(isWinner)} />
        </pixiContainer>
      );
    }

    if (isDecidedCard && side === loserSide && justEliminated) {
      // The tumbling loser -- animated via the timeline (registered), static text content.
      return <NameSlot key={`${card.key}-${side}`} registerKey={`slot-${card.key}-${side}`} register={timeline.register} x={box.x} y={box.y + box.h / 2} w={box.w} text={label} color={TOKENS.chalk} />;
    }

    // Static, unanimated slot -- no registration needed.
    return (
      <pixiText
        key={`${card.key}-${side}`}
        text={label}
        style={rowTextStyle({ fontSize: 20, fill: color, wordWrap: true, wordWrapWidth: box.w })}
        anchor={{ x: 0, y: 0.5 }}
        x={box.x}
        y={box.y + box.h / 2}
      />
    );
  }

  const allCards = bracketLayout.final ? [...bracketLayout.cards, bracketLayout.final] : bracketLayout.cards;

  // Non-qualifier seeding rows that fade out during the morph (teams not seeded into any round-1 slot).
  const morphOnly = morphFromStandings
    ? finalOrder(morphFromStandings)
        .map((e) => e.team.name)
        .filter((name) => !bracketRound1NamePositions(split, bracketLayout).has(name))
    : [];
  const morphSeedingPositions = morphFromStandings ? seedingRowsLayout(finalOrder(morphFromStandings).map((e) => e.team.name)) : [];
  const morphSeedingByName = new Map(morphSeedingPositions.map((r) => [r.key, r]));

  return (
    <pixiContainer>
      <pixiText text="TOURNAMENT BRACKET" style={eyebrowTextStyle({ fontSize: 22 })} anchor={{ x: 0.5, y: 0 }} x={STAGE_WIDTH / 2} y={110} />

      <Connectors connectors={bracketLayout.connectors} />

      {allCards.map((card) => {
        const match = matchByKey.get(card.key);
        return (
          <pixiContainer key={card.key}>
            <CardChrome card={card} />
            {renderSlot(card, 'a', match)}
            {renderSlot(card, 'b', match)}
          </pixiContainer>
        );
      })}

      {morphOnly.map((name) => {
        const box = morphSeedingByName.get(name);
        if (!box) return null;
        return <NameSlot key={`fade-${name}`} registerKey={`morph-${name}`} register={timeline.register} x={0} y={0} w={box.w} text={name} color={TOKENS.graphite} />;
      })}

      {bracketLayout.final ? (
        <pixiText text="FINAL" style={eyebrowTextStyle({ fontSize: 16 })} anchor={{ x: 0.5, y: 1 }} x={bracketLayout.final.x + bracketLayout.final.w / 2} y={bracketLayout.final.y - 10} />
      ) : null}

      {decidedCard && loserSide && justEliminated ? (
        <ParticleField
          config={ELIMINATION_DEBRIS_CONFIG}
          seed={hashKey(decidedCard.key)}
          active
          originX={bracketNameRowBox(decidedCard, loserSide).x}
          originY={bracketNameRowBox(decidedCard, loserSide).y}
        />
      ) : null}

      {destinationCard && outgoingConnector ? (
        <ParticleField
          config={WINNING_FOUR_SPARK_CONFIG}
          seed={hashKey(destinationCard.key) + 1}
          active
          delayMs={TRAVEL_DURATION_MS}
          originX={destinationCard.x + destinationCard.w / 2}
          originY={bracketNameRowBox(destinationCard, outgoingConnector.side).y}
        />
      ) : null}
    </pixiContainer>
  );
}

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h || 1;
}

