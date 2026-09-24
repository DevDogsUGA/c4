import { applyD1Migrations, env } from 'cloudflare:test';

// `TEST_MIGRATIONS` is injected by vitest.config.ts (readD1Migrations over
// ../migrations) so every test run starts from a freshly migrated D1.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: unknown }).TEST_MIGRATIONS as never);
