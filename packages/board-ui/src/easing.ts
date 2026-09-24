// Pure animation math for the piece-drop animation. No DOM -- kept separate
// from renderer.ts so it can be unit tested directly.

/** Standard "accelerate then stop" cubic ease-in, 0..1 -> 0..1. */
export function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * Drop animation curve: gravity-accelerated fall for the first 70% of the
 * duration (0 -> 1 over the drop distance), then a small decaying bounce
 * settle for the remaining 30%. Input `t` is elapsed/duration, clamped to
 * [0, 1]. Output is "fraction of drop distance traveled" and can briefly
 * exceed 1 during the bounce overshoot before settling back to exactly 1.
 */
export function dropEasing(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const fallPortion = 0.7;

  if (clamped >= 1) return 1;

  if (clamped < fallPortion) {
    return easeInCubic(clamped / fallPortion);
  }

  const local = (clamped - fallPortion) / (1 - fallPortion);
  const decayingBounce = 0.08 * (1 - local) * Math.sin(local * Math.PI * 3);
  return 1 + decayingBounce;
}
