# Map editor 3D models

Drop **`.glb`** files here (recommended) or **`.gltf`** (+ `.bin` / textures in the same folder).

Register each model in `manifest.json`:

```json
{
  "models": [
    {
      "id": "fuel-drum",
      "file": "fuel-drum.glb",
      "label": "Fuel Drum",
      "scale": 1,
      "yOffset": 0,
      "blocks": true,
      "gridKind": "cover",
      "footprint": [1, 1]
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique id stored in map JSON as `modelId` |
| `file` | Filename in this folder |
| `label` | Name shown in the editor palette |
| `scale` | Uniform scale applied on load (default `1`) |
| `yOffset` | Lift model above ground if needed |
| `blocks` | Whether players collide with it (default `true`) |
| `gridKind` | Collision type: `cover`, `wall`, or `pillar` |
| `footprint` | Grid cells occupied `[width, depth]`, e.g. `[2, 2]` for a ~4.4 m box (each cell = 2.2 m) |

**Collision notes**

- Collision is **grid-based**, not mesh-accurate — the GLB mesh is visual only.
- Each grid cell is **2.2 m** wide/deep. Set `footprint` to cover the prop’s ground area (e.g. a 3 m wide crate → `[2, 1]` or `[2, 2]`).
- `"blocks": true` enables collision; `"blocks": false` for decorative props (like lamps).
- `"gridKind": "wall"` or `"pillar"` for full-height blockers; `"cover"` for low cover.
- **Map editor fly mode has no player collision** — save the map, pick it in the main menu, then play Solo to test walking into props.
- After editing `manifest.json`, reload the page. Re-save maps so placed props store updated collision data.

**Tips**

- Prefer **GLB** (single binary file, embedded textures).
- Keep poly count reasonable for browser FPS.
- Origin at the base center of the prop works best.
- After adding files, reload the page — models appear under **MODELS** in the map editor.
