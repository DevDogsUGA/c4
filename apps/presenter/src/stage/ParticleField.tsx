// Generic GPU-batched (single Graphics draw call) particle burst -- the
// Pixi-side consumer of particles.ts's pure spawn/step/expire model
// (SHOW_PLAN.md §9c item 7). Used for every burst-style effect EXCEPT the
// champion scene's dense confetti, which needs a true `ParticleContainer`
// (see ChampionConfetti.tsx) at ~1500 particles.
//
// Iron Rule compliance (SHOW_PLAN.md §9b): the particle array lives in a
// ref, mutated every `useTick` frame; nothing here ever calls `setState`
// per frame. Respawning (a new burst) is the only thing driven by a React
// prop change (`seed`/`active`), which happens at scene/phase boundaries,
// not per frame.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- particles.ts's spawn/step/expire/alpha math IS tested.

import './pixiExtend.js';
import { useEffect, useRef } from 'react';
import { useTick } from '@pixi/react';
import type { Graphics } from 'pixi.js';
import { isExpired, particleAlpha, spawnParticles, stepParticle, type Particle, type ParticleConfig } from './particles.js';

export interface ParticleFieldProps {
  config: ParticleConfig;
  /** Determinism seed (SHOW_PLAN.md §9c item 7's "deterministic option"). */
  seed: number;
  /** Arms the burst whenever this flips true; renders nothing while false. */
  active: boolean;
  originX?: number;
  originY?: number;
  /** Delays the actual spawn until `delayMs` after `active` goes true -- e.g. firing a landing spark burst partway through a longer travel animation, without any per-frame `setState`. */
  delayMs?: number;
}

export function ParticleField({ config, seed, active, originX = 0, originY = 0, delayMs = 0 }: ParticleFieldProps) {
  const particlesRef = useRef<Particle[]>([]);
  const graphicsRef = useRef<Graphics | null>(null);
  const armedAtRef = useRef<number | null>(null);
  const spawnedRef = useRef(false);

  useEffect(() => {
    particlesRef.current = [];
    spawnedRef.current = false;
    armedAtRef.current = active ? performance.now() : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seed]);

  useTick((ticker) => {
    const g = graphicsRef.current;
    if (!g) return;

    if (!spawnedRef.current && armedAtRef.current !== null && performance.now() - armedAtRef.current >= delayMs) {
      particlesRef.current = spawnParticles(config, seed);
      spawnedRef.current = true;
    }

    const dtMs = ticker.deltaMS;
    if (particlesRef.current.length > 0) {
      particlesRef.current = particlesRef.current
        .map((p) => stepParticle(p, dtMs, config.gravity))
        .filter((p) => !isExpired(p));
    }
    g.clear();
    for (const p of particlesRef.current) {
      const alpha = particleAlpha(p);
      if (alpha <= 0) continue;
      g.rect(originX + p.x - p.size / 2, originY + p.y - p.size / 2, p.size, p.size);
      g.fill({ color: p.color, alpha });
    }
  });

  return <pixiGraphics ref={graphicsRef} draw={() => {}} />;
}
