import { z } from 'zod';
import { TEMPLATE_NAMES } from './templates.js';

/** What a sample's presence should cause to happen when the tournament runs it. */
export const ExpectKindSchema = z.enum([
  'normal',
  'match_forfeit',
  'game_forfeit',
  'restarts',
  'draw',
  'build_failed',
  'checkout_failed',
]);
export type ExpectKind = z.infer<typeof ExpectKindSchema>;

export const ExpectSchema = z.object({
  kind: ExpectKindSchema,
  /** A ForfeitReason (game) or MatchForfeitReason (match), when relevant. */
  reason: z.string().optional(),
  notes: z.string().optional(),
});
export type Expect = z.infer<typeof ExpectSchema>;

export const SampleJsonSchema = z.object({
  name: z.string().min(1),
  template: z.enum(TEMPLATE_NAMES as [string, ...string[]]),
  members: z.array(z.string().min(1)).optional(),
  expect: ExpectSchema,
  /** Stress bots simulating a rewritten server. Default false. */
  allowPlumbing: z.boolean().optional(),
  /** Rough relative playing strength, for seeding a spread. Higher = stronger. */
  strength: z.number().optional(),
  /**
   * Marks tier-3 resource-abuse samples that must NOT run outside the
   * hardened engine containers (PidsLimit, per-match networks, etc). The
   * runner builds these but refuses to execute them until the engine
   * hardening lands.
   */
  requiresHardenedEngine: z.boolean().optional(),
});
export type SampleJson = z.infer<typeof SampleJsonSchema>;
