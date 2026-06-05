import { buildGridFromGameplay } from './grid-builder.js';
import { SHIPMENT_GAMEPLAY } from './shipment.data.js';

export function buildShipmentGrid() {
  return buildGridFromGameplay(SHIPMENT_GAMEPLAY);
}
