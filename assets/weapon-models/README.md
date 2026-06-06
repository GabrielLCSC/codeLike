# Weapon GLB models

Replace procedural first-person guns and ground pickups by dropping **`.glb`** files here.

## Quick start

1. Export one GLB per weapon from Blender.
2. Name files to match `manifest.json` (e.g. `assault_rifle.glb`, `ak47.glb`).
3. Reload the game — console should show `[WeaponModels] Loaded assault_rifle …`.
4. If a file is missing, that weapon keeps the built-in procedural mesh.

## Folder

```
assets/weapon-models/
  manifest.json
  assault_rifle.glb   ← first-person + pickup
  ak47.glb
  shotgun.glb
  sniper.glb
  pistol.glb
```

## Weapon IDs (must match exactly)

| `id` in manifest | In-game weapon |
|------------------|----------------|
| `assault_rifle` | Assault Rifle |
| `ak47` | AK47 |
| `shotgun` | Shotgun |
| `sniper` | Sniper Rifle |
| `pistol` | Pistol |

## Blender setup

- **Origin:** grip / pivot point (where the hands hold the gun).
- **Forward axis:** barrel should point down **−Z** (Three.js camera forward).
- **Scale:** model in meters; tune `"scale"` in manifest if too big/small.
- **Muzzle flash (optional):** add an Empty named `MUZZLE` at the barrel tip — auto-detected for flash + tracers.
- **Collision meshes:** if you use `COL_*` objects, they are stripped from the view model (not needed for weapons).

## Size & position (how the game treats your exports)

Every weapon goes through the **same pipeline**. Blender scene position is **not** used as-is.

| Step | What happens |
|------|----------------|
| **1. Anchor** | Mesh is recentered: **X/Z centered**, **bottom at Y=0**. Where the gun sat in the Blender scene is ignored. |
| **2. Uniform fit** | **Off by default** — keeps your Blender export size. Set `"autoFit": true` in manifest only if a file is wrong. |
| **3. View pose** | Same rotation + optional nudge for all: `WEAPON_POSES.view` in `weapon-model-loader.js` |
| **4. On screen** | `WeaponSystem` places every gun at **`REST_POS`** `(0.22, -0.28, -0.46)` — bottom-right of the camera, same for all |

### Tune in one place (code, not manifest)

```js
// js/weapons/weapon-model-loader.js
export const UNIFORM_FIT_LENGTH = 0.50;   // size — all guns
export const WEAPON_POSES = {
  view: {
    position: [0, 0, 0],                  // nudge all guns in hand
    rotation: [0, -Math.PI / 2, 0],       // aim direction — all guns
  },
};
```

When Blender exports are already true meter-scale and matched, set per entry:

```json
"autoFit": false
```

### Actual world sizes (with transforms applied)

Earlier raw-file numbers were wrong. Measured with node hierarchy transforms:

| Weapon | Longest axis |
|--------|----------------|
| pistol | ~0.44 m |
| ak47 | ~1.93 m |
| sniper | ~2.41 m |
| shotgun | ~2.60 m |

These are normal weapon proportions (pistol smaller than rifles). **autoFit is off by default** so this is what you get in-game.

Set `"autoFit": true` only to force everything to `0.5 m` longest axis.

## Uniform orientation (all weapons)

Every GLB is treated the same. Orientation is **not** set per weapon in `manifest.json`.

Tune once in code: `js/weapons/weapon-model-loader.js` → `WEAPON_POSES.view.rotation`

Default matches Blender exports with barrel along **+Y** → game forward **−Z**:

```js
rotation: [0, -Math.PI / 2, 0]
```

If all guns point the wrong way the **same** way, change that one array and reload.

Set `"autoFit": false` in manifest entries once your Blender exports are all true meter-scale.

## manifest.json fields

| Field | Description |
|-------|-------------|
| `id` | Weapon key — must match `js/config/weapons.js` |
| `file` | GLB filename in this folder |
| `scale` | Optional extra multiplier (default `1`) |
| `autoFit` | Same-size in-game fit to `0.5m` longest axis (default `true`) |
| `muzzle` | Optional `[x, y, z]` — or add `MUZZLE` empty in Blender |

Per-weapon `view` / `world` / `held` overrides exist for edge cases only — leave them out when exports match.

## What gets replaced

- **First-person viewmodel** (your hands)
- **Weapon pickups** on the ground
- **Third-person held gun** on bots/remotes (when GLB is loaded)

Sounds, damage, fire rate, etc. stay in `js/config/weapons.js` — only the mesh is swapped.
