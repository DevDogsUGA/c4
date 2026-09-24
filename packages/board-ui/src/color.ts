// Pure color math for deriving shading (highlights, rims, shadows) from the
// theme's flat hex colors. No DOM/canvas -- kept separate from renderer.ts so
// it can be unit tested directly (ground rule: pure logic is tested,
// rendering/DOM is not). Renderer detail (radial-gradient pieces, punched
// holes, board edge stroke) derives every shade it needs from these.

/** 8-bit RGB triple. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

/**
 * Parses a `#rgb` or `#rrggbb` hex color string (the `#` is optional) into
 * its 8-bit RGB components.
 */
export function parseHex(hex: string): RGB {
  const clean = hex.trim().replace(/^#/, '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const num = Number.parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Formats an RGB triple as a `#rrggbb` hex string. */
export function toHex({ r, g, b }: RGB): string {
  const toByte = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/**
 * Lightens `hex` toward white by `amount` (0 = unchanged, 1 = white).
 * Values outside [0, 1] are clamped.
 */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const t = clamp01(amount);
  return toHex({
    r: r + (255 - r) * t,
    g: g + (255 - g) * t,
    b: b + (255 - b) * t,
  });
}

/**
 * Darkens `hex` toward black by `amount` (0 = unchanged, 1 = black).
 * Values outside [0, 1] are clamped.
 */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const t = clamp01(amount);
  return toHex({
    r: r * (1 - t),
    g: g * (1 - t),
    b: b * (1 - t),
  });
}

/** Returns `hex` as an `rgba(r, g, b, a)` string; `a` is clamped to [0, 1]. */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(a)})`;
}
