// Typed slide data model + default content for the intro/outro slide decks.
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

/**
 * Intro deck (5 slides), per SHOW_PLAN.md §4 item 1:
 *   1. Title -- "CONNECT FOUR SHOWDOWN" / "ACM @ UGA" eyebrow.
 *   2. Agenda -- 01 Seeding / 02 The Bracket / 03 The Final.
 *   3. "What is ACM?" -- copy reused verbatim from the deck's slide 3.
 *   4/5. Two free-form about/events slides.
 */
export const INTRO_SLIDES: Slide[] = [
  {
    kind: 'title',
    eyebrow: 'ACM @ UGA',
    heading: 'CONNECT FOUR SHOWDOWN',
    image: pixelComputerUrl,
  },
  {
    kind: 'agenda',
    eyebrow: 'TONIGHT',
    heading: 'AGENDA',
    rows: ['01 Seeding', '02 The Bracket', '03 The Final'],
  },
  {
    kind: 'content',
    eyebrow: 'WHO WE ARE',
    heading: 'WHAT IS ACM?',
    bullets: [
      'We host technical workshops, company speakers, and info sessions all semester long.',
      'We build things: hackathons, project teams, and events like tonight’s showdown.',
      'We’re open to every major -- if you like building, you belong here.',
    ],
    image: pixelComputerUrl,
  },
  {
    kind: 'content',
    eyebrow: 'GET INVOLVED',
    heading: 'ABOUT TONIGHT',
    bullets: [
      'Every team submitted a bot that plays Connect Four on an 8x8 board.',
      'Round robin seeding decides the bracket -- then it’s single elimination.',
      'Best of three per match, sudden death on a tie.',
    ],
  },
  {
    kind: 'content',
    eyebrow: 'RULES',
    heading: 'HOW IT WORKS',
    bullets: [
      'Each bot gets 10 seconds of think time per game -- run out, and the clock forfeits you.',
      'Crashes get one restart, billed to your clock.',
      'The bracket is live -- lose a match and you’re out.',
    ],
  },
];

/**
 * Outro deck (4 slides), per SHOW_PLAN.md §4 item 5:
 *   1. Next Event
 *   2. Upcoming Events
 *   3. "THANKS FOR COMING!" + Discord line + pixel icon
 *   4. Closing card
 */
export const OUTRO_SLIDES: Slide[] = [
  {
    kind: 'content',
    eyebrow: 'UP NEXT',
    heading: 'NEXT EVENT',
    bullets: ['Keep an eye on our socials and Discord for the next workshop.'],
  },
  {
    kind: 'content',
    eyebrow: "WHAT'S COMING",
    heading: 'UPCOMING EVENTS',
    bullets: [
      'Weekly workshops all semester.',
      'Company info sessions and speaker nights.',
      'More competitions like tonight.',
    ],
  },
  {
    kind: 'content',
    eyebrow: 'THANK YOU',
    heading: 'THANKS FOR COMING!',
    bullets: ['Join the conversation on our Discord.'],
    image: pixelComputerUrl,
  },
  {
    kind: 'title',
    eyebrow: 'ACM @ UGA',
    heading: 'SEE YOU NEXT TIME',
  },
];
