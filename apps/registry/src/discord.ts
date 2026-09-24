export async function postDiscord(webhookUrl: string, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.error(`Discord webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('Discord webhook failed', err);
  }
}

export function shortSha(commit: string): string {
  return commit.slice(0, 7);
}
