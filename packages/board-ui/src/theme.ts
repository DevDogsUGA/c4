// Projector aesthetics: dark, high-contrast, readable from the back of a
// room. Consumers (presenter, testground) can override any subset via
// BoardRenderer's `theme` option.

export interface BoardTheme {
  /** Fills the canvas behind the board slab. */
  background: string;
  /** The board slab itself. */
  boardFill: string;
  /** An empty hole. */
  emptyCell: string;
  /** Player 1's piece color. */
  player1: string;
  /** Player 2's piece color. */
  player2: string;
  /** Stroke drawn around winning-line pieces. */
  winHighlight: string;
  /** Thin line separating the board slab from its holes. */
  holeStroke: string;
}

export const DEFAULT_THEME: BoardTheme = {
  background: '#05070a',
  boardFill: '#1b4b91',
  emptyCell: '#05070a',
  player1: '#f4c430',
  player2: '#e5484d',
  winHighlight: '#ffffff',
  holeStroke: 'rgba(0, 0, 0, 0.35)',
};

export function resolveTheme(overrides?: Partial<BoardTheme>): BoardTheme {
  return { ...DEFAULT_THEME, ...overrides };
}
