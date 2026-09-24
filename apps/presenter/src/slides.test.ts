import { describe, expect, it } from 'vitest';
import { INTRO_SLIDES, type Slide } from './slides.js';

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
  it('has exactly 1 slide', () => {
    expect(INTRO_SLIDES).toHaveLength(1);
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
});
