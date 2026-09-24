#!/usr/bin/env tsx
/**
 * End-to-end check of the submission pipeline against the UNRESTRICTED
 * staging copy of the Google Form: submits one response directly over
 * HTTP (the public formResponse endpoint, no Google auth needed since the
 * staging form isn't UGA-restricted), then polls the Worker's staging
 * roster until the team shows up.
 *
 * This can't run until the staging form exists and its Apps Script
 * deployment (FORM_ENV=staging Script Property) is wired to WORKER_URL.
 * See ../apps-script/README.md for the setup steps.
 *
 * Required env vars:
 *   STAGING_FORM_ID       - the staging form's public id, from its
 *                            "Send" > link URL:
 *                            https://docs.google.com/forms/d/e/<THIS>/viewform
 *   STAGING_ENTRY_TEAM     - entry.<id> for the "Team name" field
 *   STAGING_ENTRY_REPO     - entry.<id> for the "GitHub repo URL" field
 *   STAGING_ENTRY_MEMBERS  - entry.<id> for the "Team members" field
 *   STAGING_ENTRY_EMAIL    - entry.<id> for the form's own responder-input
 *                            email field (staging forms aren't UGA-verified,
 *                            so email is a plain question, not "collect
 *                            verified email")
 *   WORKER_URL             - e.g. https://REGISTRY_HOST (no trailing slash)
 *   ROSTER_TOKEN            - must match the Worker's ROSTER_TOKEN secret
 *
 * Optional:
 *   POLL_TIMEOUT_MS  - default 60000
 *   POLL_INTERVAL_MS - default 2000
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const formId = requireEnv('STAGING_FORM_ID');
  const entryTeam = requireEnv('STAGING_ENTRY_TEAM');
  const entryRepo = requireEnv('STAGING_ENTRY_REPO');
  const entryMembers = requireEnv('STAGING_ENTRY_MEMBERS');
  const entryEmail = requireEnv('STAGING_ENTRY_EMAIL');
  const workerUrl = requireEnv('WORKER_URL').replace(/\/$/, '');
  const rosterToken = requireEnv('ROSTER_TOKEN');

  const pollTimeoutMs = Number(process.env.POLL_TIMEOUT_MS ?? 60_000);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 2_000);

  // A unique team name/email per run so we can unambiguously find our own
  // submission in the roster even if the staging form has other test data.
  const runId = Date.now().toString(36);
  const teamName = `staging-e2e-${runId}`;
  const email = `staging-e2e-${runId}@example.com`;
  const repoUrl = `https://github.com/octocat/Hello-World`; // any reachable public repo
  const members = 'Staging Bot A\nStaging Bot B';

  console.log(`[staging-e2e] submitting form response as "${teamName}"...`);

  const formBody = new URLSearchParams();
  formBody.set(entryTeam, teamName);
  formBody.set(entryRepo, repoUrl);
  formBody.set(entryMembers, members);
  formBody.set(entryEmail, email);

  const submitUrl = `https://docs.google.com/forms/d/e/${formId}/formResponse`;
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
    redirect: 'manual', // Google Forms 302s to a confirmation page on success
  });

  if (submitRes.status !== 200 && submitRes.status !== 302 && submitRes.status !== 0) {
    console.error(`[staging-e2e] FAIL: form submission returned unexpected status ${submitRes.status}`);
    process.exit(1);
  }
  console.log(`[staging-e2e] form submission returned status ${submitRes.status}, waiting for the webhook...`);

  const deadline = Date.now() + pollTimeoutMs;
  let found = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${workerUrl}/api/roster?env=staging`, {
        headers: { Authorization: `Bearer ${rosterToken}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { teams: Array<{ team_name: string; submitter_email: string }> };
        if (body.teams.some((t) => t.team_name === teamName || t.submitter_email === email)) {
          found = true;
          break;
        }
      } else {
        console.log(`[staging-e2e] roster fetch returned ${res.status}, retrying...`);
      }
    } catch (err) {
      console.log(`[staging-e2e] roster fetch failed (${String(err)}), retrying...`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  if (found) {
    console.log(`[staging-e2e] PASS: "${teamName}" appeared in the staging roster.`);
    process.exit(0);
  } else {
    console.error(`[staging-e2e] FAIL: "${teamName}" did not appear within ${pollTimeoutMs}ms.`);
    console.error('[staging-e2e] Check: Apps Script FORM_ENV=staging + WORKER_URL Script Properties, the');
    console.error('[staging-e2e] installable onFormSubmit trigger (run setup()), and the Worker logs.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[staging-e2e] unexpected error', err);
  process.exit(1);
});
