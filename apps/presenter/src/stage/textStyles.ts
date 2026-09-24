// Pixi TextStyle factories, built only from @acm-uga/c4-theme/tokens -- the
// single source of truth Tailwind classes can't reach on a canvas
// (SHOW_PLAN.md §9b). DOM/Pixi-adjacent (imports pixi.js), so left untested
// per this repo's rendering-exclusion convention; the tokens these read
// from are owned and typed by packages/theme.

import { TextStyle, type TextStyleOptions } from 'pixi.js';
import { FONT_FAMILIES, TOKENS } from '@acm-uga/c4-theme/tokens';

function build(base: TextStyleOptions, overrides?: Partial<TextStyleOptions>): TextStyle {
  return new TextStyle({ ...base, ...overrides });
}

/** The deck's signature red hero display type (title/champion scenes, SHOW_PLAN.md §1). */
export function heroTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.display,
      fontWeight: '700',
      fontSize: 140,
      fill: TOKENS.bulldog,
      letterSpacing: 2,
      align: 'center',
    },
    overrides,
  );
}

/** Scene headings -- agenda/content slide titles, section headers. */
export function headingTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.display,
      fontWeight: '700',
      fontSize: 64,
      fill: TOKENS.chalk,
      letterSpacing: 1,
      align: 'center',
    },
    overrides,
  );
}

/** The deck's signature mono uppercase eyebrow label. */
export function eyebrowTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.mono,
      fontWeight: '500',
      fontSize: 24,
      fill: TOKENS.bulldog,
      letterSpacing: 3,
      align: 'center',
    },
    overrides,
  );
}

/** Body copy -- bullets, paragraphs. Word-wraps by default; pass `wordWrapWidth` to match the caller's layout box. */
export function bodyTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.body,
      fontWeight: '400',
      fontSize: 32,
      fill: TOKENS.steel,
      wordWrap: true,
      wordWrapWidth: 1100,
      lineHeight: 42,
      align: 'left',
    },
    overrides,
  );
}

/** Numbered agenda rows / standings-table cells -- brighter than body copy. */
export function rowTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.body,
      fontWeight: '400',
      fontSize: 32,
      fill: TOKENS.chalk,
      align: 'left',
    },
    overrides,
  );
}

/** Mono labels -- clocks, footnotes, debug readouts. */
export function monoTextStyle(overrides?: Partial<TextStyleOptions>): TextStyle {
  return build(
    {
      fontFamily: FONT_FAMILIES.mono,
      fontWeight: '400',
      fontSize: 20,
      fill: TOKENS.graphite,
      align: 'center',
    },
    overrides,
  );
}
