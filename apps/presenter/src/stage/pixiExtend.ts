// Registers the Pixi display-object classes the stage components use as
// JSX host elements (<pixiContainer>, <pixiGraphics>, <pixiSprite>,
// <pixiText>) with @pixi/react's reconciler (SHOW_PLAN.md §9b). `extend()`
// mutates a module-level registry inside @pixi/react, so it only needs to
// run once -- but every file that renders one of those tags imports this
// module (for its side effect) anyway, so no stage component's behavior
// ever depends on import order across bundlers/HMR.

import { extend } from '@pixi/react';
import { Container, Graphics, ParticleContainer, Sprite, Text } from 'pixi.js';

extend({ Container, Graphics, Sprite, Text, ParticleContainer });
