import { describe, expect, it } from 'vitest';
import {
  applyShowSyncMessage,
  dataMessage,
  HELLO_MESSAGE,
  inputMessage,
  isShowSyncMessage,
  SHOW_SYNC_CHANNEL,
  stateMessage,
  type ShowSyncState,
} from './showSync.js';

describe('SHOW_SYNC_CHANNEL', () => {
  it('is the fixed channel name both windows must agree on', () => {
    expect(SHOW_SYNC_CHANNEL).toBe('c4-show');
  });
});

describe('stateMessage', () => {
  it('builds a state message from a sync state', () => {
    const state: ShowSyncState = { sceneIndex: 3, phaseIndex: 1 };
    expect(stateMessage(state)).toEqual({ type: 'state', sceneIndex: 3, phaseIndex: 1 });
  });
});

describe('isShowSyncMessage', () => {
  it('accepts a hello message', () => {
    expect(isShowSyncMessage(HELLO_MESSAGE)).toBe(true);
    expect(isShowSyncMessage({ type: 'hello' })).toBe(true);
  });

  it('accepts a well-formed state message', () => {
    expect(isShowSyncMessage({ type: 'state', sceneIndex: 0, phaseIndex: 0 })).toBe(true);
    expect(isShowSyncMessage({ type: 'state', sceneIndex: 12, phaseIndex: 3 })).toBe(true);
  });

  it('rejects a state message with non-integer fields', () => {
    expect(isShowSyncMessage({ type: 'state', sceneIndex: 1.5, phaseIndex: 0 })).toBe(false);
    expect(isShowSyncMessage({ type: 'state', sceneIndex: '1', phaseIndex: 0 })).toBe(false);
    expect(isShowSyncMessage({ type: 'state', sceneIndex: 0 })).toBe(false);
  });

  it('rejects unrelated payloads', () => {
    expect(isShowSyncMessage(null)).toBe(false);
    expect(isShowSyncMessage(undefined)).toBe(false);
    expect(isShowSyncMessage('state')).toBe(false);
    expect(isShowSyncMessage({ type: 'goodbye' })).toBe(false);
    expect(isShowSyncMessage({})).toBe(false);
  });
});

describe('applyShowSyncMessage', () => {
  it('adopts the incoming state on a state message', () => {
    const next = applyShowSyncMessage(null, { type: 'state', sceneIndex: 4, phaseIndex: 2 });
    expect(next).toEqual({ sceneIndex: 4, phaseIndex: 2 });
  });

  it('overwrites prior state with the latest state message', () => {
    const first = applyShowSyncMessage(null, { type: 'state', sceneIndex: 0, phaseIndex: 0 });
    const second = applyShowSyncMessage(first, { type: 'state', sceneIndex: 5, phaseIndex: 1 });
    expect(second).toEqual({ sceneIndex: 5, phaseIndex: 1 });
  });

  it('leaves state unchanged on a hello message', () => {
    const state: ShowSyncState = { sceneIndex: 2, phaseIndex: 1 };
    expect(applyShowSyncMessage(state, HELLO_MESSAGE)).toEqual(state);
    expect(applyShowSyncMessage(null, HELLO_MESSAGE)).toBeNull();
  });
});

describe('data and input messages (stage-primary flow)', () => {
  const fakeData = {
    matches: [],
    summary: { standings: [], bracket: [], generated_at: '2026-09-18T00:00:00Z' },
  };

  it('builds and accepts a data message', () => {
    const msg = dataMessage(fakeData as never);
    expect(msg).toEqual({ type: 'data', data: fakeData });
    expect(isShowSyncMessage(msg)).toBe(true);
  });

  it('rejects malformed data payloads', () => {
    expect(isShowSyncMessage({ type: 'data' })).toBe(false);
    expect(isShowSyncMessage({ type: 'data', data: null })).toBe(false);
    expect(isShowSyncMessage({ type: 'data', data: { matches: 'nope', summary: {} } })).toBe(false);
  });

  it('builds and accepts input messages for both actions', () => {
    expect(inputMessage('advance')).toEqual({ type: 'input', action: 'advance' });
    expect(inputMessage('back')).toEqual({ type: 'input', action: 'back' });
    expect(isShowSyncMessage(inputMessage('advance'))).toBe(true);
    expect(isShowSyncMessage(inputMessage('back'))).toBe(true);
  });

  it('rejects unknown input actions', () => {
    expect(isShowSyncMessage({ type: 'input', action: 'skip' })).toBe(false);
    expect(isShowSyncMessage({ type: 'input' })).toBe(false);
  });

  it('data and input messages never move a follower mirror', () => {
    const state: ShowSyncState = { sceneIndex: 2, phaseIndex: 1 };
    expect(applyShowSyncMessage(state, dataMessage(fakeData as never))).toEqual(state);
    expect(applyShowSyncMessage(state, inputMessage('advance'))).toEqual(state);
    expect(applyShowSyncMessage(null, inputMessage('back'))).toBeNull();
  });
});
