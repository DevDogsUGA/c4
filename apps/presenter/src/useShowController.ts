// React binding for show.ts's ShowController -- a tiny state machine that
// steps phase-by-phase through a fixed scene script. The controller class
// itself stays exactly as tested in show.test.ts; this hook just mirrors
// its current scene/position into React state and exposes advance/back
// callbacks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShowController, type Scene } from './show.js';

export interface UseShowController {
  scene: Scene | null;
  /** Current index into the scene script; drives the scene-transition key in App.tsx. */
  sceneIndex: number;
  /** Current phase within `scene` (see `scenePhaseCount`). */
  phaseIndex: number;
  advance: () => void;
  back: () => void;
  /** Jumps directly to `index`, resetting to that scene's first phase (see `ShowController.jumpTo`). */
  jumpTo: (index: number) => void;
}

export function useShowController(scenes: Scene[] | null): UseShowController {
  const controllerRef = useRef<ShowController | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (!scenes) {
      controllerRef.current = null;
      setScene(null);
      setSceneIndex(0);
      setPhaseIndex(0);
      return;
    }
    const controller = new ShowController(scenes);
    controllerRef.current = controller;
    setScene(controller.current());
    setSceneIndex(0);
    setPhaseIndex(0);
  }, [scenes]);

  const advance = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.atEnd()) return;
    setScene(controller.advance());
    setSceneIndex(controller.sceneIndex());
    setPhaseIndex(controller.phaseIndex());
  }, []);

  const back = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.atStart()) return;
    setScene(controller.back());
    setSceneIndex(controller.sceneIndex());
    setPhaseIndex(controller.phaseIndex());
  }, []);

  const jumpTo = useCallback((index: number) => {
    const controller = controllerRef.current;
    if (!controller) return;
    setScene(controller.jumpTo(index));
    setSceneIndex(controller.sceneIndex());
    setPhaseIndex(controller.phaseIndex());
  }, []);

  return { scene, sceneIndex, phaseIndex, advance, back, jumpTo };
}
