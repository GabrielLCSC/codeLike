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
| `footprint` | Grid cells occupied `[width, depth]`, e.g. `[2, 1]` |

**Tips**

- Prefer **GLB** (single binary file, embedded textures).
- Keep poly count reasonable for browser FPS.
- Origin at the base center of the prop works best.
- After adding files, reload the page — models appear under **MODELS** in the map editor.
