// Pure message protocol + follower reducer for the presenter/stage split
// (SHOW_PLAN.md §3, revised): the PRIMARY window loads the tournament data
// (via ?dir= or the folder picker), and "Launch stage display" turns it
// into the fullscreen stage while opening a control POPUP. The popup owns
// the ShowController and broadcasts its position; the stage is a pure
// follower. Because the picker's data only exists in the primary window,
// the popup acquires it over the channel: it sends `hello`, and any window
// holding data replies with a `data` message (tournament records are plain
// JSON, so they survive the structured clone).
//
// The stage also FORWARDS its keyboard (space/arrows) as `input` messages —
// during the show the fullscreen stage usually has focus, and the host's
// clicker must keep working — which the control window applies to its
// controller.
//
// BroadcastChannel/window wiring (main.tsx, App.tsx, Stage.tsx) is
// untested per this repo's ground rules; everything in THIS module is pure
// and has no DOM/BroadcastChannel dependency, so it's fully unit tested.

import type { TournamentData } from './records.js';

/** Channel name shared by the control and stage windows. */
export const SHOW_SYNC_CHANNEL = 'c4-show';

/** The control window's authoritative position, mirrored by followers. */
export interface ShowSyncState {
  sceneIndex: number;
  phaseIndex: number;
}

/** A stage-forwarded keyboard action, applied by the control window. */
export type ShowSyncInputAction = 'advance' | 'back';

/**
 * `hello` — late-join request, sent once on mount by both roles: the
 *   control window replies with `state`, and any data-holding window
 *   replies with `data`. Receivers ignore the reply flavors they don't
 *   need, so a single hello serves both handshakes.
 * `state` — the controller's position, broadcast on every change.
 * `data` — the loaded tournament data (picker case: only the primary
 *   window has it, and the control popup can't reload it from disk).
 * `input` — a keyboard action forwarded from the stage to the controller.
 */
export type ShowSyncMessage =
  | { type: 'hello' }
  | ({ type: 'state' } & ShowSyncState)
  | { type: 'data'; data: TournamentData }
  | { type: 'input'; action: ShowSyncInputAction };

/** The late-join request; sent once, on mount. */
export const HELLO_MESSAGE: ShowSyncMessage = { type: 'hello' };

/** Builds the `state` message the control window broadcasts. */
export function stateMessage(state: ShowSyncState): ShowSyncMessage {
  return { type: 'state', sceneIndex: state.sceneIndex, phaseIndex: state.phaseIndex };
}

/** Builds the `data` reply a data-holding window sends to a hello. */
export function dataMessage(data: TournamentData): ShowSyncMessage {
  return { type: 'data', data };
}

/** Builds the `input` message the stage forwards for a keyboard action. */
export function inputMessage(action: ShowSyncInputAction): ShowSyncMessage {
  return { type: 'input', action };
}

/**
 * Runtime guard for data arriving off a BroadcastChannel (untyped
 * `unknown` at that boundary) -- narrows it to a `ShowSyncMessage` before
 * any pure logic touches it. The `data` payload is only shallow-checked
 * here; receivers treat it as already-validated TournamentData because the
 * only senders are sibling presenter windows that parsed it via records.ts.
 */
export function isShowSyncMessage(value: unknown): value is ShowSyncMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'hello') return true;
  if (v.type === 'state') {
    return Number.isInteger(v.sceneIndex) && Number.isInteger(v.phaseIndex);
  }
  if (v.type === 'data') {
    const d = v.data as Record<string, unknown> | null;
    return typeof d === 'object' && d !== null && Array.isArray(d.matches) && typeof d.summary === 'object';
  }
  if (v.type === 'input') {
    return v.action === 'advance' || v.action === 'back';
  }
  return false;
}

/**
 * The stage's pure follower reducer: applies an incoming message to the
 * follower's current mirrored state (`null` before the first sync lands).
 * Only `state` moves the mirror; `hello`/`data`/`input` are other windows'
 * concerns and leave a follower's position untouched.
 */
export function applyShowSyncMessage(
  state: ShowSyncState | null,
  message: ShowSyncMessage,
): ShowSyncState | null {
  if (message.type === 'state') {
    return { sceneIndex: message.sceneIndex, phaseIndex: message.phaseIndex };
  }
  return state;
}
