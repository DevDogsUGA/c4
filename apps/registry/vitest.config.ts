import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      // apps-script/ has its own plain-Node vitest project (see
      // vitest.workspace.ts) since it shims GAS globals rather than
      // running inside the Workers runtime.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts', './test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              FORM_HMAC_SECRET: 'test-form-hmac-secret',
              ROSTER_TOKEN: 'test-roster-token',
              RESULTS_TOKEN: 'test-results-token',
              GITHUB_TOKEN: 'test-github-token',
              DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
              ADMIN_EMAILS: '',
              // Default test topology serves every route from one Worker
              // (mirrors the single-Worker/custom-domain deployment);
              // test/mode.test.ts overrides MODE per test to cover the
              // others. See test/access-jwt.ts for the matching keypair.
              MODE: 'both',
              ACCESS_TEAM_DOMAIN: 'access.test',
              ACCESS_AUD: 'test-audience-tag',
            },
          },
        },
      },
    },
  };
});
