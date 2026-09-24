// Uploads the tournament bundle to R2 via its S3-compatible API, per
// EVENT_PLAN.md: "--upload-r2 uses R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_BUCKET, and prints a presigned GET URL."
//
// Uses aws4fetch (a small, dependency-free SigV4 signer) rather than the
// full AWS SDK — this is one PUT and one presigned-URL computation, not a
// reason to pull in @aws-sdk/*. Real credentials don't exist yet (see
// EVENT_PLAN.md workstream A1's "only the real R2 upload" caveat), so this
// is unit-tested against a mocked fetch.

import { AwsClient } from 'aws4fetch';

const PRESIGN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2CredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): R2Credentials | undefined {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return undefined;
  return { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
}

function endpointFor(creds: R2Credentials): string {
  return `https://${creds.accountId}.r2.cloudflarestorage.com`;
}

function objectUrl(creds: R2Credentials, key: string): string {
  return `${endpointFor(creds)}/${creds.bucket}/${key}`;
}

/** Builds the R2 object key for a tournament bundle uploaded at `uploadedAt`. */
export function bundleObjectKey(uploadedAt: Date = new Date()): string {
  return `tournaments/${uploadedAt.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Uploads `body` (a JSON string) to `key` in the configured R2 bucket. */
export async function uploadToR2(creds: R2Credentials, key: string, body: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const res = await client.fetch(objectUrl(creds, key), {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`R2 upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  }
}

/** Returns a presigned GET URL for `key`, valid for 7 days. */
export async function presignGetUrl(creds: R2Credentials, key: string): Promise<string> {
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const url = new URL(objectUrl(creds, key));
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRY_SECONDS));

  const signed = await client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}

/** Uploads the bundle and returns its 7-day presigned GET URL. */
export async function uploadBundleToR2(creds: R2Credentials, body: string, uploadedAt: Date = new Date()): Promise<string> {
  const key = bundleObjectKey(uploadedAt);
  await uploadToR2(creds, key, body);
  return presignGetUrl(creds, key);
}
