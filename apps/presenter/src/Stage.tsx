// The projector view (SHOW_PLAN.md §3, revised): scenes only, no chrome,
// no controls. It never owns a ShowController -- it builds the identical,
// deterministic show script from the same tournament data and follows the
// control window's { sceneIndex, phaseIndex } over a BroadcastChannel.
//
// Two ways to be a stage:
//   - StageView: embedded in the PRIMARY window after "Launch stage
//     display" (the data is already loaded there; the control popup is the
//     one that has to catch up).
//   - StageApp (`?role=stage`): a standalone follower window for manual
//     multi-monitor setups. It loads data from `?dir=` when present,
//     otherwise requests it over the channel (hello -> data).
//
// The stage forwards its own keyboard (space/arrows) as `input` messages:
// during the show the fullscreen stage has focus, and the host's keyboard/
// clicker must keep driving the controller in the popup.
//
// Window/BroadcastChannel wiring is untested per this repo's ground rules
// -- the message protocol + follower reducer it calls into (showSync.ts)
// IS tested.

import './stage/pixiExtend.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTournamentDataFromBundleUrl, loadTournamentDataFromDir, type TournamentData } from './records.js';
import { buildShowScript, type Scene } from './show.js';
import { StagePixi } from './stage/StagePixi.js';
import { SlideStage } from './stage/scenes/SlideStage.js';
import { SeedingStage } from './stage/scenes/SeedingStage.js';
import { BracketStage } from './stage/scenes/BracketStage.js';
import { MatchStage } from './stage/scenes/MatchStage.js';
import { ChampionStage } from './stage/scenes/ChampionStage.js';
import {
  applyShowSyncMessage,
  dataMessage,
  HELLO_MESSAGE,
  inputMessage,
  isShowSyncMessage,
  SHOW_SYNC_CHANNEL,
  type ShowSyncState,
} from './showSync.js';

/**
 * Dispatches one scene to its Pixi renderer (SHOW_PLAN.md §9c) -- the Pixi
 * analog of the old SceneBody.tsx, now the stage's only rendering path.
 * `prevScene` (the immediately-preceding scene in the script) feeds the
 * bracket scene's entry animations: the table->bracket morph reads the
 * standings off a preceding `seeding` scene, and the winner-travel/loser-
 * tumble cues diff against a preceding `bracket` scene's `revealedThrough`.
 */
function StageScene({ scene, phaseIndex, prevScene }: { scene: Scene; phaseIndex: number; prevScene: Scene | undefined }) {
  switch (scene.type) {
    case 'slide':
      return <SlideStage slide={scene.slide} />;
    case 'seeding':
      return <SeedingStage standings={scene.standings} marquee={scene.marquee} phaseIndex={phaseIndex} />;
    case 'bracket':
      return (
        <BracketStage
          scene={scene}
          prevRevealedThrough={prevScene?.type === 'bracket' ? prevScene.revealedThrough : null}
          morphFromStandings={prevScene?.type === 'seeding' ? prevScene.standings : null}
        />
      );
    case 'match':
      return <MatchStage scene={scene} phaseIndex={phaseIndex} />;
    case 'champion':
      return <ChampionStage team={scene.team} />;
  }
}

/**
 * Pure follower render of the show at the last synced position. Also:
 *   - replies to `hello` with a `data` message (the control popup's only
 *     path to picker-loaded data), and
 *   - forwards space/arrow keys as `input` messages so the host can drive
 *     the show while the fullscreen stage has focus.
 */
export function StageView({ data }: { data: TournamentData }) {
  const [sync, setSync] = useState<ShowSyncState | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const channel = new BroadcastChannel(SHOW_SYNC_CHANNEL);
    function onMessage(event: MessageEvent): void {
      if (!isShowSyncMessage(event.data)) return;
      if (event.data.type === 'hello') {
        channel.postMessage(dataMessage(dataRef.current));
        return;
      }
      setSync((prev) => applyShowSyncMessage(prev, event.data));
    }
    channel.addEventListener('message', onMessage);
    // Late-join both ways: ask the controller (if one is already running)
    // for its position.
    channel.postMessage(HELLO_MESSAGE);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(SHOW_SYNC_CHANNEL);
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'ArrowRight') {
        event.preventDefault();
        channel.postMessage(inputMessage('advance'));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        channel.postMessage(inputMessage('back'));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      channel.close();
    };
  }, []);

  const scenes = useMemo(() => buildShowScript(data), [data]);
  const sceneIndex = sync?.sceneIndex ?? 0;
  const phaseIndex = sync?.phaseIndex ?? 0;
  const scene = scenes[sceneIndex] ?? null;
  const prevScene: Scene | undefined = scenes[sceneIndex - 1];

  return (
    <div className="h-screen w-screen overflow-hidden bg-ink">
      <StagePixi>
        {scene ? (
          <pixiContainer key={sceneIndex}>
            <StageScene scene={scene} phaseIndex={phaseIndex} prevScene={prevScene} />
          </pixiContainer>
        ) : null}
      </StagePixi>
    </div>
  );
}

/** Standalone `?role=stage` window: acquires data via ?dir=, ?bundle=, or the channel. */
export function StageApp() {
  const [data, setData] = useState<TournamentData | null>(null);
  const [dirParam] = useState(() => new URLSearchParams(window.location.search).get('dir'));
  const [bundleParam] = useState(() => new URLSearchParams(window.location.search).get('bundle'));

  useEffect(() => {
    if (!dirParam) return;
    loadTournamentDataFromDir(dirParam)
      .then(setData)
      .catch(() => {
        /* stage window has no chrome to surface an error in; the primary
         * window's own load will have already reported it to the host. */
      });
  }, [dirParam]);

  useEffect(() => {
    if (!bundleParam) return;
    loadTournamentDataFromBundleUrl(bundleParam)
      .then(setData)
      .catch(() => {
        /* see the ?dir= catch above -- same rationale. */
      });
  }, [bundleParam]);

  // No ?dir=/?bundle= (picker case): ask the siblings for the data.
  useEffect(() => {
    if (dirParam || bundleParam) return;
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
  }, [dirParam, bundleParam]);

  if (!data) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-ink font-mono text-sm uppercase tracking-widest text-graphite">
        Waiting for tournament data&hellip;
      </div>
    );
  }
  return <StageView data={data} />;
}
