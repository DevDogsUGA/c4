// Loads a bundled image asset as a nearest-neighbor-filtered Pixi Texture --
// crisp pixel-art (e.g. the ACM pixel-computer icon, SHOW_PLAN.md §1/§9c
// item 5) instead of the browser's default smoothing. Uses pixi.js's Assets
// loader, which caches/dedupes by URL; this module adds its own promise
// cache on top so concurrent mounts of the same asset share one load.
//
// DOM/Pixi-adjacent, left untested per this repo's rendering-exclusion
// convention.

import { useEffect, useState } from 'react';
import { Assets, Texture } from 'pixi.js';

const cache = new Map<string, Promise<Texture>>();

function loadPixelTexture(url: string): Promise<Texture> {
  let promise = cache.get(url);
  if (!promise) {
    promise = Assets.load<Texture>(url).then((texture) => {
      texture.source.scaleMode = 'nearest';
      return texture;
    });
    cache.set(url, promise);
  }
  return promise;
}

/** Loads `url` as a nearest-neighbor Texture; returns `null` until it's ready (or `url` is undefined). */
export function usePixelTexture(url: string | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    void loadPixelTexture(url).then((tex) => {
      if (!cancelled) setTexture(tex);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return texture;
}
