import { buildGridFromGameplay } from './grid-builder.js';
import { CITY_GAMEPLAY } from './city.data.js';

export function buildCityGrid() {
  return buildGridFromGameplay(CITY_GAMEPLAY);
}
