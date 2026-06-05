import { buildGridFromGameplay } from './grid-builder.js';
import { OUTPOST_GAMEPLAY } from './outpost.data.js';

export function buildOutpostGrid() {
  return buildGridFromGameplay(OUTPOST_GAMEPLAY);
}
