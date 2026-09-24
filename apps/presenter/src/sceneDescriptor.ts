// Pure summary of a Scene for the control window's jumpable scene list and
// static "next scene" preview card (SHOW_PLAN.md §3): scene type, a short
// title, and the team names involved, if any -- deliberately NOT a live
// render (that stays on the stage window only).

import type { Scene } from './show.js';

export interface SceneDescriptor {
  type: Scene['type'];
  title: string;
  teams: string[];
}

/** Builds the display summary for one scene, independent of its DOM rendering. */
export function describeScene(scene: Scene): SceneDescriptor {
  switch (scene.type) {
    case 'slide':
      return { type: 'slide', title: scene.slide.heading, teams: [] };
    case 'seeding':
      return {
        type: 'seeding',
        title: 'Seeding Reveal',
        teams: scene.standings.map((entry) => entry.team.name),
      };
    case 'bracket':
      return {
        type: 'bracket',
        title: scene.doubleForfeit
          ? 'Bracket — double forfeit'
          : scene.justAdvanced
            ? `Bracket — ${scene.justAdvanced.name} advances`
            : 'Bracket',
        teams: [],
      };
    case 'match':
      return {
        type: 'match',
        title: scene.match.round ?? 'Match',
        teams: scene.match.teams.map((team) => team.name),
      };
    case 'champion':
      return scene.team
        ? { type: 'champion', title: 'Champion', teams: [scene.team.name] }
        : { type: 'champion', title: 'No Champion — Double Forfeit', teams: [] };
  }
}

/** Builds the descriptor list for a whole script, in order. */
export function describeScenes(scenes: readonly Scene[]): SceneDescriptor[] {
  return scenes.map(describeScene);
}
