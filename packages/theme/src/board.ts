// Shared board-renderer theme for presenter and testground so both apps
// render identical piece/board colors. See SHOW_PLAN.md §1 "Board theme".
import type { BoardTheme } from '@connect-4/board-ui';

export const BOARD_THEME: Partial<BoardTheme> = {
  background: '#000000',
  boardFill: '#141414',
  emptyCell: '#000000',
  player1: '#BA0C2F',
  player2: '#FFFFFF',
  winHighlight: '#FFFFFF',
};
