// Shared design tokens as plain JS constants — the same source of truth as
// theme.css's `@theme` block, but consumable outside CSS (e.g. Pixi
// TextStyles/fills, which can't be styled with Tailwind classes).
// See SHOW_PLAN.md §1 and §9b.

export const TOKENS = {
  ink: '#000000',
  chalk: '#FFFFFF',
  silver: '#EFEFEF',
  steel: '#B7B7B7',
  concrete: '#CCCCCC',
  graphite: '#666666',
  bulldog: '#BA0C2F',
  card: '#141414',
  cardEdge: '#2E2E2E',
} as const;

export type TokenName = keyof typeof TOKENS;

// Mirrors theme.css's --font-display/--font-body/--font-mono font stacks.
export const FONT_FAMILIES = {
  display: "'Spline Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  body: "'Spline Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Spline Sans Mono', 'Cascadia Mono', 'Segoe UI Mono', Consolas, monospace",
} as const;

export type FontRole = keyof typeof FONT_FAMILIES;
