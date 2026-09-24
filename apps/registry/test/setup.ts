import { beforeEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { _resetAccessCertsCacheForTests } from '../src/admin-auth';

// Every test file gets a clean mock-fetch sandbox with network disabled, so
// unmocked outbound calls (e.g. postDiscord firing in tests that don't care
// about Discord) throw a quick, catchable "not matched" error instead of
// triggering a real DNS lookup that workerd logs verbosely. Tests that
// assert on Discord/GitHub calls register their own interceptors; tests
// that exercise admin auth register the Access certs mock themselves (see
// test/access-jwt.ts's mockAccessCerts) since it isn't needed everywhere
// and a persisted-but-unconsumed mock would trip fetchMock.assertNoPendingInterceptors()
// in unrelated tests.
//
// admin-auth's in-memory Access-keys cache is reset before every test so a
// stale keypair from a previous test file can never leak in.
beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  _resetAccessCertsCacheForTests();
});
