import { buildGridFromGameplay } from './grid-builder.js';
import { CROSSFIRE_GAMEPLAY } from './crossfire.data.js';

export function buildCrossfireGrid() {
  return buildGridFromGameplay(CROSSFIRE_GAMEPLAY);
}
