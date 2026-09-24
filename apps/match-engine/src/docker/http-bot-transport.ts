// BotTransport implementation that POSTs /move to a running container, per
// DESIGN.md's bot contract. Maps the wire outcomes onto the failure table:
// connection failure (crash/OOM-kill) -> 'crashed'; non-200/malformed JSON/
// schema-invalid body -> 'invalid'; otherwise -> 'ok'.

import { MoveResponseSchema, type MoveRequest } from '@connect-4/contract';
import type { BotTransport, MoveOutcome } from '../types.js';
import type { ContainerHandle } from './container-runtime.js';

export class HttpBotTransport implements BotTransport {
  constructor(private readonly container: ContainerHandle) {}

  async move(request: MoveRequest): Promise<MoveOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.container.baseUrl}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch (err) {
      // Connection refused/reset, DNS failure, etc — the container died mid-request.
      return { type: 'crashed', detail: err instanceof Error ? err.message : String(err) };
    }

    if (!res.ok) {
      return { type: 'invalid', detail: `non-200 response: ${res.status}` };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { type: 'invalid', detail: 'response was not valid JSON' };
    }

    const parsed = MoveResponseSchema.safeParse(body);
    if (!parsed.success) {
      return { type: 'invalid', detail: `response did not match the /move schema: ${parsed.error.message}` };
    }

    return { type: 'ok', column: parsed.data.column };
  }

  restart(): Promise<number> {
    return this.container.restart();
  }
}
