// Pixi match-replay scene (SHOW_PLAN.md §6, §9c items 5/6): dual/single
// BoardTexture per matchPhases.ts's `resolveBoardRegion`, ms clocks
// (rAF-interpolated via clock.ts, urgency colors), a pixel thinking
// indicator, restart badges, side-entry dropHand matching the mover's
// board side, a Peggle-"complete miss" coin flip for sudden-death games,
// and the winner banner + win confetti on the result phase.
//
// Per the Iron Rule (SHOW_PLAN.md §9b): every board's replay driver is an
// effect (keyed on the game/renderer identity) that imperatively calls
// board-ui's `BoardRenderer.dropPiece()`/`clearBoard()` and writes into a
// plain ref (`ClockWindow`) at each discrete move boundary -- never
// `setState`. A separate `useTick` per board reads that ref and writes
// straight into Pixi Text nodes every frame. The coin flip's flight path,
// spin, screen-shake, and reveal are all pure per-frame math (timeline.ts
// tracks + `coinSpinScaleX`) applied the same way.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- the logic it renders IS tested (layout.ts, matchPhases.ts,
// clock.ts, replay.ts, particles.ts).

import '../pixiExtend.js';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTick } from '@pixi/react';
import type { Graphics as PixiGraphics, Text as PixiText } from 'pixi.js';
import type { GameRecord, TeamRef } from '@connect-4/contract';
import { BoardRenderer, cellCenter, computeGeometry, type Coord, type HandSide } from '@connect-4/board-ui';
import { emptyBoard } from '@connect-4/engine';
import { BOARD_THEME } from '@connect-4/theme/board';
import { TOKENS } from '@connect-4/theme/tokens';
import type { Scene } from '../../show.js';
import type { MatchPhase } from '../../matchPhases.js';
import { resolveBoardRegion } from '../../matchPhases.js';
import { buildReplay, winningLine } from '../../replay.js';
import {
  buildClockTimeline,
  clockUrgency,
  formatClockMs,
  formatRestartBadge,
  interpolateRemaining,
  seatForTeamSlot,
  STARTING_CLOCK_MS,
  type ClockTick,
} from '../../clock.js';
import { dualBoardsLayout, matchBannerZone, singleBoardLayout, STAGE_HEIGHT, STAGE_WIDTH, type MatchBoardLayout } from '../layout.js';
import { coinSpinScaleX, easeOutBack, easeOutCubic, track } from '../timeline.js';
import { useTimelineRefs } from '../useTimeline.js';
import { useBoardTexture } from '../BoardTexture.js';
import { eyebrowTextStyle, headingTextStyle, monoTextStyle, rowTextStyle } from '../textStyles.js';
import { ParticleField } from '../ParticleField.js';
import { COIN_TRAIL_CONFIG, LANDING_DUST_CONFIG, WIN_CONFETTI_CONFIG, WINNING_FOUR_SPARK_CONFIG } from '../particles.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h || 1;
}

// ---------------------------------------------------------------------------
// Clock window -- the "in-flight" interpolation state written imperatively
// by the replay driver at each move boundary, read by a per-board useTick.
// ---------------------------------------------------------------------------

const CLOCK_ANIMATION_WINDOW_MS = 600;

interface ClockWindow {
  fromP1: number;
  fromP2: number;
  toP1: number;
  toP2: number;
  mover: 1 | 2 | null;
  startedAt: number;
  restart: ClockTick['restart'] | null;
}

function useBoardReplay(params: {
  game: GameRecord;
  renderer: BoardRenderer | null;
  seatA: 1 | 2;
  clockWindowRef: MutableRefObject<ClockWindow | null>;
  onWinLine: (line: Coord[]) => void;
  onFinished: () => void;
}): void {
  const { game, renderer, seatA, clockWindowRef, onWinLine, onFinished } = params;
  const prevGameNumberRef = useRef<number | null>(null);

  useEffect(() => {
    if (!renderer) return;
    let cancelled = false;

    void (async () => {
      const advancing = prevGameNumberRef.current !== null && game.game_number > prevGameNumberRef.current;
      prevGameNumberRef.current = game.game_number;

      if (advancing) await renderer.clearBoard();
      else renderer.setBoard(emptyBoard());
      if (cancelled) return;

      clockWindowRef.current = null;
      const steps = buildReplay(game);
      const ticks = buildClockTimeline(game);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const handSide: HandSide = step.move.player === seatA ? 'left' : 'right';
        await renderer.dropPiece(step.move.column, step.row, step.move.player, { handSide });
        if (cancelled) return;

        const prevTick = i > 0 ? ticks[i - 1]! : null;
        const nextTick = ticks[i]!;
        clockWindowRef.current = {
          fromP1: prevTick ? prevTick.player1RemainingMs : STARTING_CLOCK_MS,
          fromP2: prevTick ? prevTick.player2RemainingMs : STARTING_CLOCK_MS,
          toP1: nextTick.player1RemainingMs,
          toP2: nextTick.player2RemainingMs,
          mover: step.move.player,
          startedAt: performance.now(),
          restart: nextTick.restart,
        };
        await delay(150);
      }
      if (cancelled) return;

      const line = winningLine(game, steps);
      if (line) {
        renderer.highlightWin(line);
        onWinLine(line);
      }
      onFinished();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, renderer]);
}

function urgencyColor(remainingMs: number): string {
  const urgency = clockUrgency(remainingMs);
  return urgency === 'critical' ? TOKENS.bulldog : urgency === 'warn' ? TOKENS.chalk : TOKENS.steel;
}

// ---------------------------------------------------------------------------
// One board + its chrome (clocks, thinking indicator, restart badge).
// ---------------------------------------------------------------------------

function ThinkingIndicator({ x, y, activeRef }: { x: number; y: number; activeRef: MutableRefObject<boolean> }) {
  const ref = useRef<PixiGraphics | null>(null);
  useTick(() => {
    const g = ref.current;
    if (!g) return;
    g.clear();
    if (!activeRef.current) return;
    const t = performance.now() / 350;
    for (let i = 0; i < 3; i++) {
      const phase = (t + i * 0.33) % 1;
      const alpha = phase < 0.5 ? 1 : 0.15;
      g.rect(i * 10, 0, 6, 6).fill({ color: TOKENS.bulldog, alpha });
    }
  });
  return <pixiGraphics ref={ref} x={x} y={y} draw={() => {}} />;
}

interface BoardPanelProps {
  game: GameRecord;
  board: MatchBoardLayout;
  teamAName: string;
  teamBName: string;
  seatA: 1 | 2;
  seatB: 1 | 2;
  onWinCentroid: (x: number, y: number) => void;
  onFinished: () => void;
}

function BoardPanel({ game, board, teamAName, teamBName, seatA, seatB, onWinCentroid, onFinished }: BoardPanelProps) {
  const handle = useBoardTexture({ size: board.board.w, resolutionScale: 2, dropHand: true, theme: BOARD_THEME });
  const clockWindowRef = useRef<ClockWindow | null>(null);
  const movingA = useRef(false);
  const movingB = useRef(false);

  useBoardReplay({
    game,
    renderer: handle?.renderer ?? null,
    seatA,
    clockWindowRef,
    onWinLine: (line) => {
      const geometry = computeGeometry(8, 8, board.board.w, board.board.h);
      const centroid = line.reduce(
        (acc, c) => {
          const p = cellCenter(c.col, c.row, geometry);
          return { x: acc.x + p.x / line.length, y: acc.y + p.y / line.length };
        },
        { x: 0, y: 0 },
      );
      onWinCentroid(board.board.x + centroid.x, board.board.y + centroid.y);
    },
    onFinished,
  });

  const clockARef = useRef<PixiText | null>(null);
  const clockBRef = useRef<PixiText | null>(null);
  const restartRef = useRef<PixiText | null>(null);

  useTick(() => {
    const win = clockWindowRef.current;
    const elapsed = win ? performance.now() - win.startedAt : Infinity;
    const t = elapsed / CLOCK_ANIMATION_WINDOW_MS;
    const p1 = win ? interpolateRemaining(win.fromP1, win.toP1, t) : STARTING_CLOCK_MS;
    const p2 = win ? interpolateRemaining(win.fromP2, win.toP2, t) : STARTING_CLOCK_MS;
    const withinWindow = win !== null && elapsed < CLOCK_ANIMATION_WINDOW_MS;
    const mover = withinWindow ? win!.mover : null;

    const pA = seatA === 1 ? p1 : p2;
    const pB = seatB === 1 ? p1 : p2;
    movingA.current = mover === seatA;
    movingB.current = mover === seatB;

    if (clockARef.current) {
      clockARef.current.text = formatClockMs(pA);
      clockARef.current.style.fill = urgencyColor(pA);
    }
    if (clockBRef.current) {
      clockBRef.current.text = formatClockMs(pB);
      clockBRef.current.style.fill = urgencyColor(pB);
    }
    if (restartRef.current) {
      const restart = win?.restart && withinWindow ? win.restart : null;
      restartRef.current.text = restart ? formatRestartBadge(restart.billedMs) : '';
    }
  });

  return (
    <pixiContainer>
      {handle ? <pixiSprite texture={handle.texture} x={board.board.x} y={board.board.y} width={board.board.w} height={board.board.h} /> : null}

      <pixiText
        text={teamAName}
        style={rowTextStyle({ fontSize: 22, fill: TOKENS.chalk, wordWrap: true, wordWrapWidth: board.clocks.left.w })}
        anchor={{ x: 0, y: 0 }}
        x={board.clocks.left.x}
        y={board.clocks.left.y}
      />
      <ThinkingIndicator x={board.clocks.left.x} y={board.clocks.left.y + 24} activeRef={movingA} />
      <pixiText ref={clockARef} text="10.000" style={monoTextStyle({ fontSize: 26, fill: TOKENS.steel })} anchor={{ x: 0, y: 0 }} x={board.clocks.left.x} y={board.clocks.left.y + 36} />

      <pixiText
        text={teamBName}
        style={rowTextStyle({ fontSize: 22, fill: TOKENS.chalk, wordWrap: true, wordWrapWidth: board.clocks.right.w })}
        anchor={{ x: 1, y: 0 }}
        x={board.clocks.right.x + board.clocks.right.w}
        y={board.clocks.right.y}
      />
      <ThinkingIndicator x={board.clocks.right.x + board.clocks.right.w - 28} y={board.clocks.right.y + 24} activeRef={movingB} />
      <pixiText
        ref={clockBRef}
        text="10.000"
        style={monoTextStyle({ fontSize: 26, fill: TOKENS.steel })}
        anchor={{ x: 1, y: 0 }}
        x={board.clocks.right.x + board.clocks.right.w}
        y={board.clocks.right.y + 36}
      />

      <pixiText ref={restartRef} text="" style={monoTextStyle({ fontSize: 16, fill: TOKENS.bulldog })} anchor={{ x: 0.5, y: 0 }} x={board.board.x + board.board.w / 2} y={board.board.y + board.board.h + 12} />
    </pixiContainer>
  );
}

// ---------------------------------------------------------------------------
// Coin-flip theater (SHOW_PLAN.md §9c item 5)
// ---------------------------------------------------------------------------

const COIN_FLIGHT_MS = 1800;
const COIN_BOUNCE_MS = 500;
const COIN_LANDING_MS = COIN_FLIGHT_MS + COIN_BOUNCE_MS;

function CoinFlipTheater({ teamName, moverSeat }: { teamName: string; moverSeat: 1 | 2 }) {
  const coinRef = useRef<PixiGraphics | null>(null);
  const shakeRef = useRef<import('pixi.js').Container | null>(null);
  const startRef = useRef(performance.now());
  const timeline = useTimelineRefs();

  useEffect(() => {
    startRef.current = performance.now();
    const landingX = STAGE_WIDTH / 2;
    const overshootX = STAGE_WIDTH - 120;
    const y = STAGE_HEIGHT / 2 - 140;
    timeline.setTracks([
      track({ key: 'coin', prop: 'x', t0: 0, t1: COIN_FLIGHT_MS, from: 120, to: overshootX, ease: easeOutCubic }),
      track({ key: 'coin', prop: 'x', t0: COIN_FLIGHT_MS, t1: COIN_LANDING_MS, from: overshootX, to: landingX, ease: easeOutBack }),
      track({ key: 'coin', prop: 'y', t0: 0, t1: COIN_FLIGHT_MS / 2, from: y, to: y - 220, ease: easeOutCubic }),
      track({ key: 'coin', prop: 'y', t0: COIN_FLIGHT_MS / 2, t1: COIN_FLIGHT_MS, from: y - 220, to: y, ease: easeOutCubic }),
      track({ key: 'result', prop: 'alpha', t0: COIN_LANDING_MS, t1: COIN_LANDING_MS + 150, from: 0, to: 1 }),
      track({ key: 'result', prop: 'scaleX', t0: COIN_LANDING_MS, t1: COIN_LANDING_MS + 350, from: 0.5, to: 1, ease: easeOutBack }),
      track({ key: 'result', prop: 'scaleY', t0: COIN_LANDING_MS, t1: COIN_LANDING_MS + 350, from: 0.5, to: 1, ease: easeOutBack }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamName, moverSeat]);

  useTick(() => {
    const elapsed = performance.now() - startRef.current;
    const g = coinRef.current;
    if (g) {
      const scaleX = elapsed < COIN_LANDING_MS ? coinSpinScaleX(elapsed, 5) : 1;
      g.scale.x = scaleX;
      g.clear();
      g.circle(0, 0, 52)
        .fill(moverSeat === 1 ? TOKENS.bulldog : TOKENS.chalk)
        .stroke({ width: 4, color: TOKENS.cardEdge });
    }
    const shake = shakeRef.current;
    if (shake) {
      const sinceLanding = elapsed - COIN_LANDING_MS;
      if (sinceLanding >= 0 && sinceLanding < 220) {
        const decay = 1 - sinceLanding / 220;
        shake.x = (Math.random() - 0.5) * 14 * decay;
        shake.y = (Math.random() - 0.5) * 14 * decay;
      } else {
        shake.x = 0;
        shake.y = 0;
      }
    }
  });

  return (
    <pixiContainer ref={shakeRef}>
      <pixiGraphics draw={(g) => g.clear().rect(0, 0, STAGE_WIDTH, STAGE_HEIGHT).fill({ color: TOKENS.ink, alpha: 0.72 })} />

      <ParticleField config={COIN_TRAIL_CONFIG} seed={1} active originX={300} originY={STAGE_HEIGHT / 2 - 300} />
      <ParticleField config={COIN_TRAIL_CONFIG} seed={2} active originX={900} originY={STAGE_HEIGHT / 2 - 340} delayMs={550} />
      <ParticleField config={COIN_TRAIL_CONFIG} seed={3} active originX={1500} originY={STAGE_HEIGHT / 2 - 200} delayMs={1100} />
      <ParticleField config={LANDING_DUST_CONFIG} seed={4} active originX={STAGE_WIDTH / 2} originY={STAGE_HEIGHT / 2 - 140} delayMs={COIN_LANDING_MS} />

      <pixiContainer ref={timeline.register('coin')}>
        <pixiGraphics ref={coinRef} draw={() => {}} />
      </pixiContainer>

      <pixiContainer ref={timeline.register('result')} x={STAGE_WIDTH / 2} y={STAGE_HEIGHT / 2 + 120} alpha={0}>
        <pixiText text={`${teamName.toUpperCase()} MOVES FIRST`} style={headingTextStyle({ fontSize: 48, fill: TOKENS.bulldog })} anchor={{ x: 0.5, y: 0.5 }} />
      </pixiContainer>
    </pixiContainer>
  );
}

// ---------------------------------------------------------------------------
// Top-level match scene
// ---------------------------------------------------------------------------

export function MatchStage({ scene, phaseIndex }: { scene: Extract<Scene, { type: 'match' }>; phaseIndex: number }) {
  const { match, phases, bracketContext } = scene;
  const [teamA, teamB] = match.teams;
  const phase: MatchPhase = phases[phaseIndex] ?? phases[phases.length - 1]!;
  const region = resolveBoardRegion(phases, phaseIndex);
  const isResult = phase.kind === 'result';
  const isCoinflip = phase.kind === 'coinflip';
  const winnerTeam: TeamRef = match.teams[match.result.winner_team]!;

  const [sparkPoint, setSparkPoint] = useState<{ x: number; y: number; seed: number } | null>(null);

  function handleWinCentroid(x: number, y: number): void {
    setSparkPoint({ x, y, seed: Math.round(x + y) });
  }

  const banner = matchBannerZone();

  return (
    <pixiContainer>
      <pixiText
        text={`${(bracketContext.round ?? 'MATCH').toUpperCase()} — ${teamA!.name} vs ${teamB!.name}`}
        style={eyebrowTextStyle({ fontSize: 20 })}
        anchor={{ x: 0.5, y: 0 }}
        x={STAGE_WIDTH / 2}
        y={40}
      />

      {region.kind === 'walkover' ? (
        <pixiText
          text={`WALKOVER — ${winnerTeam.name} advances without a game played (forfeit).`}
          style={rowTextStyle({ fontSize: 28, fill: TOKENS.steel })}
          anchor={{ x: 0.5, y: 0.5 }}
          x={STAGE_WIDTH / 2}
          y={STAGE_HEIGHT / 2}
        />
      ) : region.kind === 'dual' ? (
        <DualBoards match_id={match.match_id} games={region.games} teamAName={teamA!.name} teamBName={teamB!.name} onWinCentroid={handleWinCentroid} />
      ) : (
        <BoardPanel
          key={`${match.match_id}-single`}
          game={region.game}
          board={singleBoardLayout()}
          teamAName={teamA!.name}
          teamBName={teamB!.name}
          seatA={seatForTeamSlot(region.game, 0)}
          seatB={seatForTeamSlot(region.game, 1)}
          onWinCentroid={handleWinCentroid}
          onFinished={() => {}}
        />
      )}

      {sparkPoint ? <ParticleField config={WINNING_FOUR_SPARK_CONFIG} seed={sparkPoint.seed} active originX={sparkPoint.x} originY={sparkPoint.y} /> : null}

      {isCoinflip && phase.kind === 'coinflip' ? (
        <CoinFlipTheater teamName={match.teams[phase.game.first_player_team]!.name} moverSeat={phase.game.first_player} />
      ) : null}

      {isResult ? (
        <>
          <pixiContainer x={banner.x} y={banner.y}>
            <pixiText text={`${winnerTeam.name.toUpperCase()} WINS`} style={headingTextStyle({ fontSize: 56, fill: TOKENS.bulldog })} anchor={{ x: 0.5, y: 0 }} x={banner.w / 2} y={0} />
            <pixiText
              text={`${match.result.games_won[0]}-${match.result.games_won[1]}`}
              style={monoTextStyle({ fontSize: 20, fill: TOKENS.steel })}
              anchor={{ x: 0.5, y: 0 }}
              x={banner.w / 2}
              y={78}
            />
          </pixiContainer>
          <ParticleField config={WIN_CONFETTI_CONFIG} seed={hashSeed(match.match_id)} active />
        </>
      ) : null}
    </pixiContainer>
  );
}

/** The two side-by-side game-1/game-2 boards (SHOW_PLAN.md §6 item 1). */
function DualBoards({
  match_id,
  games,
  teamAName,
  teamBName,
  onWinCentroid,
}: {
  match_id: string;
  games: [GameRecord, GameRecord];
  teamAName: string;
  teamBName: string;
  onWinCentroid: (x: number, y: number) => void;
}) {
  const [boardA, boardB] = dualBoardsLayout();
  return (
    <>
      <BoardPanel
        key={`${match_id}-dual-0`}
        game={games[0]}
        board={boardA}
        teamAName={teamAName}
        teamBName={teamBName}
        seatA={seatForTeamSlot(games[0], 0)}
        seatB={seatForTeamSlot(games[0], 1)}
        onWinCentroid={onWinCentroid}
        onFinished={() => {}}
      />
      <BoardPanel
        key={`${match_id}-dual-1`}
        game={games[1]}
        board={boardB}
        teamAName={teamAName}
        teamBName={teamBName}
        seatA={seatForTeamSlot(games[1], 0)}
        seatB={seatForTeamSlot(games[1], 1)}
        onWinCentroid={onWinCentroid}
        onFinished={() => {}}
      />
    </>
  );
}
