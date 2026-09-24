import { describe, expect, it } from 'vitest';
import { INTRO_SLIDES, OUTRO_SLIDES, type Slide } from './slides.js';

function assertShape(slide: Slide): void {
  expect(typeof slide.heading).toBe('string');
  expect(slide.heading.length).toBeGreaterThan(0);
  if (slide.eyebrow !== undefined) expect(typeof slide.eyebrow).toBe('string');
  if (slide.footnote !== undefined) expect(typeof slide.footnote).toBe('string');

  switch (slide.kind) {
    case 'title':
      if (slide.image !== undefined) expect(typeof slide.image).toBe('string');
      break;
    case 'agenda':
      expect(Array.isArray(slide.rows)).toBe(true);
      expect(slide.rows.length).toBeGreaterThan(0);
      for (const row of slide.rows) expect(typeof row).toBe('string');
      break;
    case 'content':
      expect(Array.isArray(slide.bullets)).toBe(true);
      expect(slide.bullets.length).toBeGreaterThan(0);
      for (const bullet of slide.bullets) expect(typeof bullet).toBe('string');
      if (slide.image !== undefined) expect(typeof slide.image).toBe('string');
      break;
  }
}

describe('INTRO_SLIDES', () => {
  it('has exactly 5 slides', () => {
    expect(INTRO_SLIDES).toHaveLength(5);
  });

  it('every slide has a valid shape for its kind', () => {
    for (const slide of INTRO_SLIDES) assertShape(slide);
  });

  it('opens on a title slide with the deck title + ACM eyebrow', () => {
    const first = INTRO_SLIDES[0]!;
    expect(first.kind).toBe('title');
    expect(first.heading).toBe('CONNECT FOUR SHOWDOWN');
    expect(first.eyebrow).toBe('ACM @ UGA');
  });

  it('has an agenda slide with the three numbered rows', () => {
    const agenda = INTRO_SLIDES.find((s) => s.kind === 'agenda');
    expect(agenda).toBeDefined();
    expect(agenda!.rows).toEqual(['01 Seeding', '02 The Bracket', '03 The Final']);
  });

  it('has a "What is ACM?" content slide', () => {
    const acm = INTRO_SLIDES.find((s) => s.kind === 'content' && s.heading === 'WHAT IS ACM?');
    expect(acm).toBeDefined();
  });

  it('has at least two other content slides', () => {
    const content = INTRO_SLIDES.filter((s) => s.kind === 'content');
    expect(content.length).toBeGreaterThanOrEqual(3);
  });
});

describe('OUTRO_SLIDES', () => {
  it('has exactly 4 slides', () => {
    expect(OUTRO_SLIDES).toHaveLength(4);
  });

  it('every slide has a valid shape for its kind', () => {
    for (const slide of OUTRO_SLIDES) assertShape(slide);
  });

  it('has a Next Event slide and an Upcoming Events slide', () => {
    expect(OUTRO_SLIDES.some((s) => s.heading === 'NEXT EVENT')).toBe(true);
    expect(OUTRO_SLIDES.some((s) => s.heading === 'UPCOMING EVENTS')).toBe(true);
  });

  it('has a THANKS FOR COMING slide mentioning Discord', () => {
    const thanks = OUTRO_SLIDES.find((s) => s.heading === 'THANKS FOR COMING!');
    expect(thanks).toBeDefined();
    expect(thanks!.kind).toBe('content');
    if (thanks!.kind === 'content') {
      expect(thanks!.bullets.some((b) => /discord/i.test(b))).toBe(true);
    }
  });

  it('closes on a final card', () => {
    const last = OUTRO_SLIDES[OUTRO_SLIDES.length - 1]!;
    expect(typeof last.heading).toBe('string');
    expect(last.heading.length).toBeGreaterThan(0);
  });
});
