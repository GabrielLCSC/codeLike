// ═══════════════════════════════════════════════════════════
//  TEMPLATE — copy to maps/<name>.data.js when adding a map
// ═══════════════════════════════════════════════════════════
//
//  1. Define OPEN_RECTS (walkable zones carved first)
//  2. List PILLARS / COVERS / other blocked cells
//  3. Add DOOR cells if lanes connect through walls
//  4. Export spawns, ammo, lanes, MAP_META
//  5. Create maps/<name>.grid.js → buildXGrid() using MapGrid
//  6. Register in maps/index.js BUILDERS
//  7. Add scene builder in mapgen.js (or maps/<name>.scene.js)
//
// import { MAP_W, MAP_H } from '../config.js';
//
// export const MY_OPEN_RECTS = [
//   { x: 2, z: 2, w: 40, h: 40, kind: 'floor' },
// ];
// export const MY_OBSTACLES = [[10, 10]];
// export const MY_MAP_META = { id: 'my-map', width: MAP_W, height: MAP_H };
