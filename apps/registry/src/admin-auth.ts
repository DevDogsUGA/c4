/**
 * Whether an email authenticated by Cloudflare Access is allowed to use
 * /admin. Cloudflare Access itself gates the route at the edge; this is
 * defense in depth plus an optional extra allowlist.
 */
export function isAllowedAdminEmail(email: string | null | undefined, allowlistCsv: string | undefined): boolean {
  if (!email) return false;
  const allowlist = (allowlistCsv ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return allowlist.includes(email.toLowerCase());
}
