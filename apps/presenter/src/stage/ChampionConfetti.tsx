// Champion-scene confetti (SHOW_PLAN.md §9c item 7): ~1500 particles via a
// real Pixi `ParticleContainer` (GPU-batched, unlike ParticleField.tsx's
// single-Graphics-draw approach) -- the scale this scene calls for is
// exactly what ParticleContainer exists for. Particles are plain white
// `Texture.WHITE` quads, tinted per-particle; position/rotation/alpha are
// mutated in place on each `Particle` instance every tick and pushed to the
// GPU via `container.update()` -- never through React state (Iron Rule,
// SHOW_PLAN.md §9b).
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention -- particles.ts's spawn/step/expire/alpha math IS tested.

import './pixiExtend.js';
import { useEffect, useRef } from 'react';
import { useTick } from '@pixi/react';
import { Particle, ParticleContainer, Texture } from 'pixi.js';
import { CHAMPION_CONFETTI_CONFIG, isExpired, particleAlpha, spawnParticles, stepParticle, type Particle as ParticleData } from './particles.js';

export interface ChampionConfettiProps {
  seed: number;
  active: boolean;
}

export function ChampionConfetti({ seed, active }: ChampionConfettiProps) {
  const containerRef = useRef<ParticleContainer | null>(null);
  const dataRef = useRef<ParticleData[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.removeParticles();
    dataRef.current = active ? spawnParticles(CHAMPION_CONFETTI_CONFIG, seed) : [];
    for (const p of dataRef.current) {
      const particle = new Particle({
        texture: Texture.WHITE,
        x: p.x,
        y: p.y,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: p.rotation,
        tint: p.color,
        alpha: 1,
      });
      container.addParticle(particle);
    }
    container.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seed]);

  useTick((ticker) => {
    const container = containerRef.current;
    if (!container || dataRef.current.length === 0) return;
    const dtMs = ticker.deltaMS;
    const nextData: ParticleData[] = [];
    const kept: Particle[] = [];
    dataRef.current.forEach((p, i) => {
      const next = stepParticle(p, dtMs, CHAMPION_CONFETTI_CONFIG.gravity);
      if (isExpired(next)) return;
      // Every particleChildren entry was constructed as `new Particle(...)`
      // below (the container's `T` defaults to the narrower `IParticle`
      // interface, which lacks the `alpha`/`tint` convenience accessors the
      // concrete Particle class adds) -- this cast is safe given that.
      const sprite = container.particleChildren[i] as Particle | undefined;
      if (!sprite) return;
      sprite.x = next.x;
      sprite.y = next.y;
      sprite.rotation = next.rotation;
      sprite.alpha = particleAlpha(next);
      nextData.push(next);
      kept.push(sprite);
    });
    dataRef.current = nextData;
    if (kept.length !== container.particleChildren.length) {
      container.removeParticles();
      for (const sprite of kept) container.addParticle(sprite);
    }
    container.update();
  });

  return (
    <pixiParticleContainer
      ref={containerRef}
      dynamicProperties={{ position: true, rotation: true, color: true }}
    />
  );
}
