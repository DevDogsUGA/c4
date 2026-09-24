// Framework-free DOM/canvas Connect Four board renderer. See README.md for
// the public API contract; this file just re-exports it.

export { BoardRenderer } from './renderer.js';
export type { BoardRendererOptions, DropPieceOptions } from './renderer.js';
export type { HandSide } from './pixels.js';
export { DEFAULT_THEME, resolveTheme } from './theme.js';
export type { BoardTheme } from './theme.js';
export { computeGeometry, cellCenter, dropStartY } from './geometry.js';
export type { BoardGeometry, Coord } from './geometry.js';
export { dropEasing, easeInCubic } from './easing.js';
export { parseHex, toHex, lighten, darken, alpha } from './color.js';
export type { RGB } from './color.js';
