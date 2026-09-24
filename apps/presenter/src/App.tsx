// The presenter's primary window and control console (SHOW_PLAN.md §3,
// revised flow):
//
//   1. The PRIMARY window (default route) loads the tournament data (?dir=
//      or the folder picker) and shows the control console.
//   2. "Launch stage display" (disabled until data is loaded) flips THIS
//      window into the fullscreen stage — fullscreen must be requested in
//      the window being fullscreened, on a user gesture — and opens a
//      control POPUP (`?role=control`).
//   3. The popup becomes the controller: it acquires the data over the
//      BroadcastChannel (hello -> data; the picker's files only exist in
//      the primary window), owns the ShowController, broadcasts `state`,
//      and applies `input` actions forwarded from the stage's keyboard.
//
// The current/next scene are shown here as static descriptor cards
// (type/title/teams), never a live render, so the control window stays
// cheap regardless of how heavy the stage's board animations get. Not unit
// tested, per this repo's ground rules (rendering/window wiring is
// excluded) -- the logic it calls into (records.ts, show.ts,
// sceneDescriptor.ts, showSync.ts, ...) IS tested.

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTournamentDataFromDir, type TournamentData } from './records.js';
import { buildShowScript } from './show.js';
import { useShowController } from './useShowController.js';
import { Loader } from './Loader.js';
import { StageView } from './Stage.js';
import { describeScenes, type SceneDescriptor } from './sceneDescriptor.js';
import {
  dataMessage,
  HELLO_MESSAGE,
  isShowSyncMessage,
  SHOW_SYNC_CHANNEL,
  stateMessage,
  type ShowSyncState,
} from './showSync.js';

export function App({ popup = false }: { popup?: boolean }) {
  const [data, setData] = useState<TournamentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirParam] = useState(() => new URLSearchParams(window.location.search).get('dir'));
  /** Primary window only: flips to 'stage' when the show is launched. */
  const [mode, setMode] = useState<'control' | 'stage'>('control');

  // This window acts as the controller while it shows the console: the
  // popup always does; the primary only until it becomes the stage.
  const isController = popup || mode === 'control';

  useEffect(() => {
    if (!dirParam) return;
    loadTournamentDataFromDir(dirParam)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [dirParam]);

  // Popup without ?dir= (picker case): the data lives only in the primary
  // window -- request it over the channel.
  useEffect(() => {
    if (!popup || dirParam) return;
    const channel = new BroadcastChannel(SHOW_SYNC_CHANNEL);
    function onMessage(event: MessageEvent): void {
      if (isShowSyncMessage(event.data) && event.data.type === 'data') {
        setData(event.data.data);
      }
    }
    channel.addEventListener('message', onMessage);
    channel.postMessage(HELLO_MESSAGE);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [popup, dirParam]);

  const scenes = useMemo(() => (data ? buildShowScript(data) : null), [data]);
  const descriptors = useMemo(() => (scenes ? describeScenes(scenes) : null), [scenes]);
  const { sceneIndex, phaseIndex, advance, back, jumpTo } = useShowController(scenes);

  // --- keyboard: space/arrows drive the controller (console windows only;
  // the stage forwards its keys as `input` messages instead). ---
  useEffect(() => {
    if (!isController) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (!scenes) return;
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'ArrowRight') {
        event.preventDefault();
        advance();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isController, scenes, advance, back]);

  // --- sync (controller side): answer hellos with state (+ data when this
  // window holds it), apply stage-forwarded input, broadcast position. ---
  const positionRef = useRef<ShowSyncState>({ sceneIndex, phaseIndex });
  positionRef.current = { sceneIndex, phaseIndex };
  const dataRef = useRef<TournamentData | null>(data);
  dataRef.current = data;

  useEffect(() => {
    if (!isController) return;
    const channel = new BroadcastChannel(SHOW_SYNC_CHANNEL);
    function onMessage(event: MessageEvent): void {
      if (!isShowSyncMessage(event.data)) return;
      if (event.data.type === 'hello') {
        channel.postMessage(stateMessage(positionRef.current));
        if (dataRef.current) channel.postMessage(dataMessage(dataRef.current));
      } else if (event.data.type === 'input') {
        if (event.data.action === 'advance') advance();
        else back();
      }
    }
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [isController, advance, back]);

  useEffect(() => {
    if (!isController) return;
    const channel = new BroadcastChannel(SHOW_SYNC_CHANNEL);
    channel.postMessage(stateMessage({ sceneIndex, phaseIndex }));
    channel.close();
  }, [isController, sceneIndex, phaseIndex]);

  // --- elapsed time: since data finished loading (show start). ---
  const startRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!data) return;
    startRef.current = Date.now();
    const interval = window.setInterval(() => {
      setElapsedMs(startRef.current ? Date.now() - startRef.current : 0);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [data]);

  // --- launch: THIS window becomes the fullscreen stage; the controls
  // move to a popup. ---
  function launchStage(): void {
    if (!data) return;
    const url = new URL(window.location.href);
    url.searchParams.set('role', 'control');
    const controlWindow = window.open(url.toString(), 'connect-4-control', 'popup=yes,width=1100,height=750');
    if (!controlWindow) {
      setError('Popup blocked -- allow popups for this site to launch the stage display.');
      return;
    }
    setMode('stage');
    void document.documentElement.requestFullscreen?.()?.catch(() => {
      /* fullscreen is best-effort; the window is a stage either way */
    });
  }

  // Escape hatch out of stage mode: once fullscreen has already been exited
  // (Escape exits fullscreen first), another Escape returns to the console.
  useEffect(() => {
    if (popup || mode !== 'stage') return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !document.fullscreenElement) setMode('control');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [popup, mode]);

  if (mode === 'stage' && data) {
    return <StageView data={data} />;
  }

  const idle = data === null && !error;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink px-8 py-6 font-body text-chalk">
      <header className="flex items-center justify-between gap-4 border-b border-card-edge pb-4">
        <div>
          <p className="m-0 font-mono text-xs uppercase tracking-widest text-bulldog">ACM @ UGA</p>
          <h1 className="m-0 font-display text-2xl font-bold uppercase text-chalk">Show Control</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="m-0 font-mono text-sm text-steel">Elapsed {formatElapsed(elapsedMs)}</p>
          {!popup ? (
            <button
              type="button"
              onClick={launchStage}
              disabled={!data}
              title={data ? undefined : 'Load a tournament output first'}
              className="rounded border border-bulldog bg-bulldog px-4 py-2 font-mono text-sm uppercase tracking-wide text-chalk hover:bg-card disabled:cursor-not-allowed disabled:border-card-edge disabled:bg-card disabled:text-graphite"
            >
              Launch stage display
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="mt-8 text-xl text-bulldog">{error}</p>
      ) : idle ? (
        popup ? (
          <p className="mt-8 font-mono text-sm uppercase tracking-widest text-graphite">
            Connecting to the stage window&hellip;
          </p>
        ) : !dirParam ? (
          <Loader onLoad={setData} />
        ) : (
          <p className="mt-8 text-steel">Loading tournament data&hellip;</p>
        )
      ) : (
        <ControlBody
          descriptors={descriptors!}
          sceneIndex={sceneIndex}
          phaseIndex={phaseIndex}
          onAdvance={advance}
          onBack={back}
          onJump={jumpTo}
        />
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ControlBody({
  descriptors,
  sceneIndex,
  phaseIndex,
  onAdvance,
  onBack,
  onJump,
}: {
  descriptors: SceneDescriptor[];
  sceneIndex: number;
  phaseIndex: number;
  onAdvance: () => void;
  onBack: () => void;
  onJump: (index: number) => void;
}) {
  const current = descriptors[sceneIndex] ?? null;
  const next = descriptors[sceneIndex + 1] ?? null;

  return (
    <div className="mt-6 grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-6">
      <div className="flex min-h-0 flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <DescriptorCard label="Now" descriptor={current} meta={`Scene ${sceneIndex + 1} of ${descriptors.length} · Phase ${phaseIndex + 1}`} />
          <DescriptorCard label="Next" descriptor={next} meta={next ? `Scene ${sceneIndex + 2} of ${descriptors.length}` : 'End of show'} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-card-edge bg-card px-6 py-3 font-mono text-sm uppercase tracking-wide text-chalk hover:border-bulldog"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={onAdvance}
            className="rounded border border-bulldog bg-bulldog px-6 py-3 font-mono text-sm uppercase tracking-wide text-chalk hover:bg-card"
          >
            Advance &rarr;
          </button>
          <p className="m-0 font-mono text-xs text-steel">
            <kbd className="rounded border border-card-edge bg-card px-2 py-0.5">space</kbd> advance &middot;{' '}
            <kbd className="rounded border border-card-edge bg-card px-2 py-0.5">&larr;/&rarr;</kbd> back/advance
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded border border-card-edge bg-card">
        <p className="m-0 border-b border-card-edge px-4 py-2 font-mono text-xs uppercase tracking-widest text-steel">
          Scene list
        </p>
        <ol className="m-0 flex-1 list-none overflow-y-auto p-2">
          {descriptors.map((descriptor, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => onJump(index)}
                className={`m-0 flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left ${
                  index === sceneIndex ? 'bg-bulldog text-chalk' : 'text-steel hover:bg-ink'
                }`}
              >
                <span className="font-mono text-[10px] uppercase tracking-widest opacity-80">
                  {index + 1}. {descriptor.type}
                </span>
                <span className="text-sm">{descriptor.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DescriptorCard({
  label,
  descriptor,
  meta,
}: {
  label: string;
  descriptor: SceneDescriptor | null;
  meta: string;
}) {
  return (
    <div className="rounded border border-card-edge bg-card p-4">
      <p className="m-0 font-mono text-xs uppercase tracking-widest text-bulldog">{label}</p>
      {descriptor ? (
        <>
          <p className="m-0 mt-2 font-mono text-[10px] uppercase tracking-widest text-steel">{descriptor.type}</p>
          <h2 className="m-0 mt-1 font-display text-lg font-bold text-chalk">{descriptor.title}</h2>
          {descriptor.teams.length > 0 ? (
            <p className="m-0 mt-2 font-mono text-xs text-steel">{descriptor.teams.join(' vs. ')}</p>
          ) : null}
        </>
      ) : (
        <p className="m-0 mt-2 text-sm text-steel">&mdash;</p>
      )}
      <p className="m-0 mt-3 font-mono text-[10px] text-graphite">{meta}</p>
    </div>
  );
}
