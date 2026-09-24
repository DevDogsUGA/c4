// Team-facing bot testing page. Collects the team's bot URL + opponent
// choice, referees a live game via referee.playGame, renders it with
// @acm-uga/c4-board-ui (through BoardCanvas), and surfaces the last
// request/response JSON plus clear error states. Not unit tested (per this
// repo's ground rules: rendering/DOM is excluded) -- the logic it calls into
// (referee.ts, protocol.ts, bot-player.ts, practice-bots.ts) IS tested.

import { useRef, useState } from 'react';
import type { Player } from '@acm-uga/c4-engine';
import { playGame, type GameEvent } from './referee.js';
import { createBotPlayer, type BotExchange } from './bot-player.js';
import { DEFAULT_PRACTICE_BOTS_URL, PRACTICE_BOTS, practiceBotUrl } from './practice-bots.js';
import { BoardCanvas, type BoardCanvasHandle } from './BoardCanvas.js';

// Presentational status categories layered on top of the unchanged event
// flow -- see SHOW_PLAN.md §1's functional-state remap: silver/steel for
// in-progress and wins/legal flow (state is carried by copy, not hue),
// bulldog for timeout/warnings and forfeits/errors.
type StatusKind = 'idle' | 'progress' | 'ok' | 'warning' | 'error';

interface Status {
  message: string;
  kind: StatusKind;
}

const statusClass: Record<StatusKind, string> = {
  idle: 'text-steel',
  progress: 'text-steel',
  ok: 'text-silver',
  warning: 'text-bulldog',
  error: 'text-bulldog',
};

export default function App(): React.ReactElement {
  const [botUrl, setBotUrl] = useState('http://localhost:8000');
  const [opponentId, setOpponentId] = useState('self');
  const [practiceUrl, setPracticeUrl] = useState(DEFAULT_PRACTICE_BOTS_URL);
  const [firstPlayer, setFirstPlayer] = useState<Player>(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>({ message: '', kind: 'idle' });
  const [lastRequest, setLastRequest] = useState('(no moves yet)');
  const [lastResponse, setLastResponse] = useState('(no moves yet)');

  const boardRef = useRef<BoardCanvasHandle>(null);
  const stopRequestedRef = useRef(false);

  function setStatusMessage(message: string, kind: StatusKind = 'idle'): void {
    setStatus({ message, kind });
  }

  function showExchange(exchange: BotExchange): void {
    setLastRequest(JSON.stringify(exchange.request, null, 2));
    setLastResponse(
      exchange.result.responseBody !== undefined
        ? JSON.stringify(exchange.result.responseBody, null, 2)
        : `(no response body -- ${exchange.result.outcome.ok ? 'ok' : exchange.result.outcome.message})`,
    );
  }

  function playerLabel(player: Player, selfPlay: boolean): string {
    if (selfPlay) return `Your bot (player ${player})`;
    return player === 1 ? 'Your bot' : 'Opponent';
  }

  async function handleEvent(event: GameEvent, selfPlay: boolean): Promise<void> {
    switch (event.type) {
      case 'move_attempt':
        setStatusMessage(`Waiting on ${playerLabel(event.player, selfPlay)}...`, 'progress');
        return;
      case 'move_applied':
        setStatusMessage(`${playerLabel(event.player, selfPlay)} played column ${event.column} (${event.think_ms}ms)`, 'progress');
        await boardRef.current?.dropPiece(event.column, event.row, event.player);
        return;
      case 'forfeit':
        setStatusMessage(
          `${playerLabel(event.player, selfPlay)} forfeits: ${event.reason} -- ${event.message}`,
          event.reason === 'timeout' ? 'warning' : 'error',
        );
        return;
      case 'win':
        setStatusMessage(`${playerLabel(event.player, selfPlay)} wins!`, 'ok');
        boardRef.current?.highlightWin(event.line);
        return;
      case 'draw':
        setStatusMessage('Draw.', 'ok');
        return;
    }
  }

  async function startGame(): Promise<void> {
    if (running) return;
    setRunning(true);
    stopRequestedRef.current = false;

    await boardRef.current?.reset();
    setLastRequest('(no moves yet)');
    setLastResponse('(no moves yet)');

    const yourUrl = botUrl.trim();
    if (!yourUrl) {
      setStatusMessage('Enter your bot URL first.', 'error');
      setRunning(false);
      return;
    }

    const opponentUrl =
      opponentId === 'self' ? yourUrl : practiceBotUrl(practiceUrl.trim(), PRACTICE_BOTS.find((b) => b.id === opponentId)!);

    const matchId = `testground-${Date.now()}`;
    const onExchange = (exchange: BotExchange) => showExchange(exchange);

    const providers = {
      1: createBotPlayer({ baseUrl: yourUrl, matchId, onExchange }),
      2: createBotPlayer({ baseUrl: opponentUrl, matchId, onExchange }),
    } as const;

    setStatusMessage('Playing...', 'progress');

    try {
      for await (const event of playGame(providers, firstPlayer)) {
        if (stopRequestedRef.current) {
          setStatusMessage('Stopped.', 'idle');
          break;
        }
        await handleEvent(event, opponentId === 'self');
      }
    } catch (err) {
      setStatusMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }

    setRunning(false);
  }

  function stopGame(): void {
    stopRequestedRef.current = true;
    setStatusMessage('Stopping...', 'progress');
  }

  const selfPlay = opponentId === 'self';
  const player1Name = selfPlay ? 'Your bot (player 1)' : 'Your bot';
  const player2Name = selfPlay ? 'Your bot (player 2)' : 'Opponent';

  const inputClass =
    'w-full rounded border border-card-edge bg-ink px-2.5 py-2 text-[0.95rem] text-chalk outline-none focus:ring-2 focus:ring-bulldog';

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-8 py-6 pb-12 font-body text-chalk md:grid-cols-[minmax(320px,420px)_1fr]">
      <header className="md:col-span-2">
        <p className="m-0 mb-1 font-mono text-xs uppercase tracking-widest text-bulldog">ACM @ UGA — CONNECT FOUR</p>
        <h1 className="m-0 mb-1 font-display text-3xl font-bold uppercase tracking-tight text-chalk">Testground</h1>
        <p className="m-0 text-steel">
          Point this at your bot and watch it play. Your browser may prompt for a "local network" permission (Chrome{' '}
          <a
            href="https://developer.chrome.com/blog/private-network-access-preflight"
            className="text-bulldog underline"
            target="_blank"
            rel="noreferrer"
          >
            Private Network Access
          </a>
          ) the first time it reaches <code className="font-mono">http://localhost</code> — allow it.
        </p>
      </header>

      <section className="rounded-lg border border-card-edge bg-card p-4 px-5">
        <h2 className="m-0 mb-3 font-display text-lg font-bold uppercase tracking-tight text-chalk">Setup</h2>

        <label htmlFor="bot-url" className="mt-0 mb-1 block text-sm text-steel">
          Your bot's URL
        </label>
        <input id="bot-url" type="url" value={botUrl} onChange={(e) => setBotUrl(e.target.value)} className={inputClass} />

        <label htmlFor="opponent" className="mt-3 mb-1 block text-sm text-steel">
          Opponent
        </label>
        <select id="opponent" value={opponentId} onChange={(e) => setOpponentId(e.target.value)} className={inputClass}>
          <option value="self">Your bot (vs. itself)</option>
          {PRACTICE_BOTS.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.label} (practice)
            </option>
          ))}
        </select>

        {opponentId !== 'self' && (
          <div id="practice-url-row">
            <label htmlFor="practice-url" className="mt-3 mb-1 block text-sm text-steel">
              Practice bots base URL
            </label>
            <input
              id="practice-url"
              type="url"
              value={practiceUrl}
              onChange={(e) => setPracticeUrl(e.target.value)}
              className={inputClass}
            />
            <p className="mt-2 text-xs text-steel">
              Run <code className="font-mono">pnpm -C packages/practice-bots dev</code> locally, or point this at a
              deployed instance.
            </p>
          </div>
        )}

        <label htmlFor="first-player" className="mt-3 mb-1 block text-sm text-steel">
          First move
        </label>
        <select
          id="first-player"
          value={firstPlayer}
          onChange={(e) => setFirstPlayer(Number(e.target.value) as Player)}
          className={inputClass}
        >
          <option value={1}>Your bot</option>
          <option value={2}>Opponent</option>
        </select>

        <button
          id="start"
          onClick={() => void startGame()}
          disabled={running}
          className="mt-4 w-full rounded bg-bulldog px-4 py-2.5 text-[0.95rem] font-semibold text-chalk disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start game
        </button>
        <button
          id="stop"
          onClick={stopGame}
          disabled={!running}
          className="mt-2 w-full rounded border border-card-edge bg-card px-4 py-2.5 text-[0.95rem] font-semibold text-chalk disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stop
        </button>

        <p id="status" className={`mt-2 font-mono text-[0.95rem] ${statusClass[status.kind]}`}>
          {status.message}
        </p>
      </section>

      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-card-edge bg-card p-4 px-5">
          <h2 className="m-0 mb-3 font-display text-lg font-bold uppercase tracking-tight text-chalk">Board</h2>
          <BoardCanvas ref={boardRef} player1Name={player1Name} player2Name={player2Name} />
        </section>

        <section className="rounded-lg border border-card-edge bg-card p-4 px-5">
          <h2 className="m-0 mb-3 font-display text-lg font-bold uppercase tracking-tight text-chalk">Last exchange (debugging aid)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="m-0 mb-1 font-mono text-xs uppercase tracking-widest text-bulldog">Request</h3>
              <pre className="m-0 max-h-[220px] overflow-auto rounded border border-card-edge bg-ink p-2.5 font-mono text-xs text-steel">
                {lastRequest}
              </pre>
            </div>
            <div>
              <h3 className="m-0 mb-1 font-mono text-xs uppercase tracking-widest text-bulldog">Response</h3>
              <pre className="m-0 max-h-[220px] overflow-auto rounded border border-card-edge bg-ink p-2.5 font-mono text-xs text-steel">
                {lastResponse}
              </pre>
              {status.kind === 'error' &&
                /forfeit|unreachable|error/i.test(status.message) && (
                  <p className="mt-2 font-mono text-xs text-bulldog">
                    Tip: a blocked or failed request may be a CORS or Private Network Access (PNA) issue — check the
                    browser console and confirm your bot's server allows cross-origin requests from this origin.
                  </p>
                )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
