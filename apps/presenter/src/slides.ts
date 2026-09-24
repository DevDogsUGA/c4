// Typed slide data model + default content for the intro slide deck.
// Per SHOW_PLAN.md §4.1/§4.5: slide content lives here (typed, editable) --
// no hardcoded copy in components beyond these defaults. Pure data, no DOM.
//
// The icon is a bundled asset import (not a /public path): the presenter's
// vite publicDir is repointed at fixtures/ so `?dir=/` can serve tournament
// records, which means nothing under public/ is actually served.

import pixelComputerUrl from './assets/pixel-computer.png';

/** A title slide: hero heading + eyebrow, optional image. */
export interface TitleSlide {
  kind: 'title';
  eyebrow?: string;
  heading: string;
  image?: string;
  footnote?: string;
}

/** An agenda slide: numbered rows (e.g. "01 Seeding"). */
export interface AgendaSlide {
  kind: 'agenda';
  eyebrow?: string;
  heading: string;
  rows: string[];
  footnote?: string;
}

/** A free-form content slide: heading + bullet copy, optional image. */
export interface ContentSlide {
  kind: 'content';
  eyebrow?: string;
  heading: string;
  bullets: string[];
  image?: string;
  footnote?: string;
}

export type Slide = TitleSlide | AgendaSlide | ContentSlide;

/** Intro deck: the title card only -- the show goes straight from it into the seeding reveal. */
export const INTRO_SLIDES: Slide[] = [
  {
    kind: 'title',
    eyebrow: 'ACM @ UGA',
    heading: 'CONNECT FOUR SHOWDOWN',
    image: pixelComputerUrl,
  },
];
