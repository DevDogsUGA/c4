// The chess clock: 10s of total think time per bot per game, per DESIGN.md
// "Time control & failure rules". One instance per game; each player has an
// independent budget that only ever decreases.

import type { Player } from '@acm-uga/c4-engine';

export class ChessClock {
  private remainingMs: Record<Player, number>;

  constructor(initialMs: number) {
    this.remainingMs = { 1: initialMs, 2: initialMs };
  }

  remaining(player: Player): number {
    return this.remainingMs[player];
  }

  /** Deducts `ms` from `player`'s remaining budget, floored at 0. */
  bill(player: Player, ms: number): void {
    this.remainingMs[player] = Math.max(0, this.remainingMs[player] - ms);
  }

  expired(player: Player): boolean {
    return this.remainingMs[player] <= 0;
  }
}
