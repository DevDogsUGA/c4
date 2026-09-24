import { beforeEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';

// Every test file gets a clean mock-fetch sandbox with network disabled, so
// unmocked outbound calls (e.g. postDiscord firing in tests that don't care
// about Discord) throw a quick, catchable "not matched" error instead of
// triggering a real DNS lookup that workerd logs verbosely. Tests that
// assert on Discord/GitHub calls register their own interceptors.
beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
