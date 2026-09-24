/**
 * Normalize a GitHub repo URL to `https://github.com/<owner>/<repo>`,
 * lowercased, with `.git` suffix and trailing slash stripped. Returns null
 * for anything that isn't a plausible GitHub repo URL.
 */
export function normalizeRepoUrl(input: string): string | null {
  if (!input) return null;
  let url: URL;
  try {
    // Allow bare "github.com/owner/repo" by assuming https if no scheme.
    const candidate = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    url = new URL(candidate);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  let [owner, repo] = parts;
  owner = owner.toLowerCase();
  repo = repo.toLowerCase().replace(/\.git$/, '');

  if (!owner || !repo) return null;
  // Basic GitHub identifier sanity check.
  const idRe = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  if (!idRe.test(owner)) return null;
  if (!/^[a-z0-9._-]+$/.test(repo)) return null;

  return `https://github.com/${owner}/${repo}`;
}
