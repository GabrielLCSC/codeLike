// ═══════════════════════════════════════════════════════════
//  WARFRONT — In-game map editor (grid snap + fly camera)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { CELL_SIZE, MAP_W, MAP_H } from '../config.js';
import {
  createEmptyMapData,
  snapWorldToCell,
  slugifyMapId,
  validateMapData,
  getToolDefForType,
  promptMapDimensions,
  clampMapSize,
  MIN_MAP_CELLS,
  MAX_MAP_CELLS,
} from './map-schema.js';
import {
  getEditorAssetTools,
  assetFootprintCells,
  footprintWorldCenter,
  parseToolSelection,
  setModelTools,
} from './asset-catalog.js';
import { reloadMapModels } from './model-loader.js';
import { saveMapToFirebase, loadMapFromFirebase, listMapsFromFirebase } from './map-storage.js';
import { registerCustomMap } from './index.js';
import { buildSpawnMarkers } from './custom-map-scene.js';
import { buildMapAssetObject } from './editor-meshes.js';
import { applySceneTheme, rebuildEditorLighting, resolveMapTheme } from './map-theme.js';

/**
 * @param {import('../game.js').Game} game
 */
export class MapEditor {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.mapData = createEmptyMapData();
    this.selectedTool = 'wall';
    this.eraseMode = false;
    this._assetIdCounter = 0;
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hitPoint = new THREE.Vector3();
    this._preview = null;
    this._assetRoot = null;
    this._spawnMarkers = null;
    this._gridHelper = null;
    this._keys = new Set();
    this._orbit = { yaw: 0, pitch: 0.65, dist: 42 };
    this._panTarget = new THREE.Vector3(MAP_W * CELL_SIZE * 0.5, 0, MAP_H * CELL_SIZE * 0.5);
    this._savedCamPos = null;
    this._savedCamRot = null;
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onContextMenu = e => e.preventDefault();
    this._dragging = false;
    this._lastMouse = { x: 0, y: 0 };
    this._overlayOnly = false;
  }

  /** @param {{ overlayOnly?: boolean, mapData?: import('./map-schema.js').CustomMapData }} [options] @returns {Promise<boolean>} */
  async enter(options = {}) {
    if (this.active) return true;
    const game = this.game;
    this.active = true;
    this._overlayOnly = !!options.overlayOnly;

    if (options.mapData) {
      this.mapData = structuredClone(options.mapData);
      this._assetIdCounter = this.mapData.assets.length;
    }
    if (!this.mapData.theme) this.mapData.theme = { timeOfDay: 'day' };

    await this._ensureModelsLoaded();

    game.controls?.unlock();
    game.mouseDown = false;
    game.keys.clear();

    if (game.camera) {
      this._savedCamPos = game.camera.position.clone();
      this._savedCamRot = game.camera.rotation.clone();
    }

    this._showSidebar(true);
    this._bindEditorDom();
    this._bindEditorInput();

    if (this._overlayOnly) {
      this._ensureGridOverlay();
      this._syncAssetMeshes();
      this._applyTheme();
    } else {
      this._ensureEditorScene();
      this._regenerateTerrain({ resetPan: true });
    }

    this._syncMapSettingsUi();
    this._updateFlyCamera();
    this._setStatus('Editor — ZQSD pan · Shift erase · Right-drag orbit · ` toggle');
    return true;
  }

  /** Prompt for map size and return fresh map data, or null if cancelled. */
  static promptNewMapData() {
    const dims = promptMapDimensions();
    if (!dims) return null;
    return createEmptyMapData({ meta: dims });
  }

  /** Exit editor — restore gameplay camera if available. */
  exit() {
    if (!this.active) return;
    this.active = false;
    this._overlayOnly = false;
    this._unbindEditorInput();
    this._showSidebar(false);
    this._clearPreview();

    const game = this.game;
    if (this._gridHelper && game.scene) {
      game.scene.remove(this._gridHelper);
      this._gridHelper = null;
    }

    if (this._savedCamPos && game.camera) {
      game.camera.position.copy(this._savedCamPos);
      if (this._savedCamRot) game.camera.rotation.copy(this._savedCamRot);
    }
  }

  /** @param {import('./map-schema.js').CustomMapData} data */
  async loadMapData(data) {
    validateMapData(data);
    this.mapData = structuredClone(data);
    if (!this.mapData.theme) this.mapData.theme = { timeOfDay: 'day' };
    this._assetIdCounter = this.mapData.assets.length;

    await this._ensureModelsLoaded();
    this._ensureEditorScene();

    if (this._overlayOnly) {
      this._syncAssetMeshes();
      this._applyTheme();
    } else {
      this._regenerateTerrain({ resetPan: true });
    }
    this._syncMapSettingsUi();
    this._updateFlyCamera();
    this._setStatus(`Loaded "${data.meta.name}"`);
  }

  getMapData() {
    return structuredClone(this.mapData);
  }

  update(delta) {
    if (!this.active) return;
    this._updateFlyCameraMovement(delta);
    this._updateFlyCamera();
    this._updatePreviewFromMouse();
  }

  async saveMap() {
    const name = window.prompt('Map name:', this.mapData.meta.name);
    if (!name?.trim()) return;
    const id = slugifyMapId(name);
    this.mapData.meta.name = name.trim();
    this.mapData.meta.id = id;
    try {
      await saveMapToFirebase(this.getMapData());
      registerCustomMap(this.getMapData());
      this._setStatus(`Saved to Firebase: /maps/${id}`);
    } catch (err) {
      this._setStatus(err.message ?? 'Save failed', true);
    }
  }

  async loadMapPrompt() {
    try {
      const list = await listMapsFromFirebase();
      if (!list.length) {
        this._setStatus('No custom maps in Firebase yet.', true);
        return;
      }
      const names = list.map(m => `${m.id} — ${m.name}`).join('\n');
      const pick = window.prompt(`Enter map id to load:\n\n${names}`, list[0].id);
      if (!pick?.trim()) return;
      const id = pick.trim().split('—')[0].trim();
      const data = await loadMapFromFirebase(id);
      await this.loadMapData(data);
    } catch (err) {
      this._setStatus(err.message ?? 'Load failed', true);
    }
  }

  newMap() {
    const data = MapEditor.promptNewMapData();
    if (!data) return;
    this.mapData = data;
    this._assetIdCounter = 0;
    if (this._overlayOnly) {
      this._syncAssetMeshes();
      this._applyTheme();
      this._syncMapSettingsUi();
    } else {
      this._regenerateTerrain({ resetPan: true });
    }
    this._setStatus(`New ${this.mapData.meta.width}×${this.mapData.meta.height} map`);
  }

  _disposeObject3D(obj) {
    obj.traverse(c => {
      if (c.isMesh) {
        c.geometry?.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material?.dispose();
      }
    });
  }

  _ensureEditorScene() {
    const game = this.game;
    if (!game.renderer) game._initRenderer();
    if (!game.scene) {
      game._initScene();
      if (game.camera) game.scene.add(game.camera);
      this._assetRoot = null;
      this._gridHelper = null;
      this._spawnMarkers = null;
      this._clearPreview();
    }
    if (!game.map) game.map = new MapGenerator();
  }

  _removeMapGeneratedMeshes() {
    const game = this.game;
    if (!game.scene) return;
    const toRemove = game.scene.children.filter(
      c => c.userData?.mapGenerated || c.userData?.customMapAsset,
    );
    for (const obj of toRemove) {
      game.scene.remove(obj);
      this._disposeObject3D(obj);
    }
    if (game.map) {
      game.map.staticMeshes = [];
      game.map.wallMeshes = [];
    }
  }

  _regenerateTerrain({ resetPan = false } = {}) {
    const game = this.game;
    this._ensureEditorScene();
    if (!game.map || !game.scene) {
      throw new Error('Editor scene is not ready.');
    }
    const savedPan = this._panTarget.clone();
    const savedOrbit = { ...this._orbit };

    this._removeMapGeneratedMeshes();
    registerCustomMap(this.mapData);
    game.map.generateFromEditorData(this.mapData);
    game.map.buildScene(game.scene, { editorMode: true });
    game.map.finalizeMeshCollision(game.scene, { editorAssets: this.mapData.assets });
    this._rebuildSceneFromData({ resetPan });
    if (!resetPan) {
      this._panTarget.copy(savedPan);
      Object.assign(this._orbit, savedOrbit);
    }
    this._applyTheme();
    this._syncMapSettingsUi();
  }

  _applyTheme() {
    const game = this.game;
    if (!game.scene) return;
    const theme = resolveMapTheme(this.mapData);
    applySceneTheme(game.scene, theme);

    const w = this.mapData.meta.width ?? MAP_W;
    const h = this.mapData.meta.height ?? MAP_H;
    const center = { x: w * CELL_SIZE * 0.5, z: h * CELL_SIZE * 0.5 };

    if (this._overlayOnly) {
      rebuildEditorLighting(game.scene, theme, center);
    } else {
      game.scene.traverse(c => {
        if (c.isAmbientLight && c.userData?.mapGenerated) {
          c.color.setHex(theme.ambientColor);
          c.intensity = theme.ambientInt;
        }
        if (c.isDirectionalLight && c.userData?.mapGenerated) {
          c.color.setHex(theme.sunColor);
          c.intensity = theme.sunInt;
          c.position.set(...theme.sunPos);
        }
        if (c.isHemisphereLight && c.userData?.mapGenerated) {
          c.color.setHex(theme.hemiSky);
          c.groundColor.setHex(theme.hemiGround);
          c.intensity = theme.hemiInt;
        }
        if (c.isPointLight && c.userData?.mapGenerated) {
          c.color.setHex(theme.midLightColor);
          c.intensity = theme.midLightInt;
          c.position.set(center.x, 6, center.z);
        }
      });
    }
  }

  toggleDayNight() {
    const next = this.mapData.theme?.timeOfDay === 'night' ? 'day' : 'night';
    this.mapData.theme = { ...this.mapData.theme, timeOfDay: next };
    this._applyTheme();
    this._syncMapSettingsUi();
    this._setStatus(next === 'night' ? 'Night mode' : 'Day mode');
  }

  applyMapSizeFromUi() {
    if (this._overlayOnly) {
      this._setStatus('Resize in Map Editor mode only', true);
      return;
    }
    const wEl = document.getElementById('editor-map-width');
    const hEl = document.getElementById('editor-map-height');
    if (!wEl || !hEl) return;
    const width = clampMapSize(wEl.value, this.mapData.meta.width ?? MAP_W);
    const height = clampMapSize(hEl.value, this.mapData.meta.height ?? MAP_H);
    if (width === this.mapData.meta.width && height === this.mapData.meta.height) return;

    this.mapData.meta.width = width;
    this.mapData.meta.height = height;
    this.mapData.openRects = [{
      x: 0, z: 0, w: width, h: height, kind: 'floor',
    }];
    this.mapData.assets = this.mapData.assets.filter(a =>
      assetFootprintCells(a).every(([gx, gz]) => gx >= 0 && gz >= 0 && gx < width && gz < height),
    );
    this._regenerateTerrain({ resetPan: true });
    this._setStatus(`Map resized to ${width}×${height}`);
  }

  _syncMapSettingsUi() {
    const wEl = document.getElementById('editor-map-width');
    const hEl = document.getElementById('editor-map-height');
    const dayBtn = document.getElementById('editor-btn-day');
    const nightBtn = document.getElementById('editor-btn-night');
    if (wEl) wEl.value = String(this.mapData.meta.width ?? MAP_W);
    if (hEl) hEl.value = String(this.mapData.meta.height ?? MAP_H);
    const isNight = this.mapData.theme?.timeOfDay === 'night';
    dayBtn?.classList.toggle('active', !isNight);
    nightBtn?.classList.toggle('active', isNight);
  }

  _ensureGridOverlay() {
    const game = this.game;
    if (!game.scene || this._gridHelper) return;
    const w = this.mapData.meta.width ?? MAP_W;
    const h = this.mapData.meta.height ?? MAP_H;
    this._gridHelper = new THREE.GridHelper(w * CELL_SIZE, w, 0x00ff88, 0x334455);
    this._gridHelper.position.set(w * CELL_SIZE * 0.5, 0.02, h * CELL_SIZE * 0.5);
    game.scene.add(this._gridHelper);
  }

  _syncAssetMeshes() {
    if (!this._assetRoot) {
      this._assetRoot = new THREE.Group();
      this._assetRoot.name = 'editor-assets';
      this.game.scene.add(this._assetRoot);
    }
    while (this._assetRoot.children.length) {
      const c = this._assetRoot.children[0];
      this._assetRoot.remove(c);
      this._disposeObject3D(c);
    }
    for (const a of this.mapData.assets) {
      const mesh = this._buildAssetMesh(a);
      if (mesh) this._assetRoot.add(mesh);
    }
    if (this._spawnMarkers) this.game.scene.remove(this._spawnMarkers);
    this._spawnMarkers = buildSpawnMarkers(this.game.scene, this.mapData.assets);
    this.game.map.finalizeMeshCollision(this.game.scene, { editorAssets: this.mapData.assets });
  }

  _rebuildSceneFromData({ resetPan = false } = {}) {
    const game = this.game;
    if (!game.scene) return;

    if (this._assetRoot) {
      game.scene.remove(this._assetRoot);
      this._disposeObject3D(this._assetRoot);
    }
    if (this._spawnMarkers) {
      game.scene.remove(this._spawnMarkers);
      this._spawnMarkers = null;
    }
    if (this._gridHelper) {
      game.scene.remove(this._gridHelper);
      this._gridHelper = null;
    }

    const w = this.mapData.meta.width ?? MAP_W;
    const h = this.mapData.meta.height ?? MAP_H;
    this._gridHelper = new THREE.GridHelper(
      w * CELL_SIZE,
      w,
      0x00ff88,
      0x334455,
    );
    this._gridHelper.position.set(w * CELL_SIZE * 0.5, 0.02, h * CELL_SIZE * 0.5);
    game.scene.add(this._gridHelper);

    this._assetRoot = new THREE.Group();
    this._assetRoot.name = 'editor-assets';

    for (const a of this.mapData.assets) {
      const mesh = this._buildAssetMesh(a);
      if (mesh) this._assetRoot.add(mesh);
    }
    game.scene.add(this._assetRoot);

    this._spawnMarkers = buildSpawnMarkers(game.scene, this.mapData.assets);

    if (resetPan) {
      this._panTarget.set(w * CELL_SIZE * 0.5, 0, h * CELL_SIZE * 0.5);
    }
  }

  /** @param {import('./map-schema.js').MapAsset} asset */
  _buildAssetMesh(asset) {
    const def = getToolDefForType(asset.type, asset.modelId);
    return buildMapAssetObject(asset, { editor: def && !def.blocks });
  }

  _assetAtCell(gx, gz) {
    return this.mapData.assets.find(a =>
      assetFootprintCells(a).some(([cx, cz]) => cx === gx && cz === gz),
    );
  }

  _footprintFits(gx, gz, type, modelId, rotY, mapW, mapH) {
    /** @type {import('./map-schema.js').MapAsset} */
    const fake = { id: '_', type, gx, gz, rotY, x: 0, y: 0, z: 0, modelId };
    return assetFootprintCells(fake).every(([cx, cz]) =>
      cx >= 0 && cz >= 0 && cx < mapW && cz < mapH,
    );
  }

  _footprintOverlaps(gx, gz, type, modelId, rotY, ignoreId) {
    /** @type {import('./map-schema.js').MapAsset} */
    const fake = { id: '_', type, gx, gz, rotY, x: 0, y: 0, z: 0, modelId };
    const cells = new Set(assetFootprintCells(fake).map(([x, z]) => `${x},${z}`));
    return this.mapData.assets.some(a => {
      if (a.id === ignoreId) return false;
      return assetFootprintCells(a).some(([x, z]) => cells.has(`${x},${z}`));
    });
  }

  async _ensureModelsLoaded() {
    const models = await reloadMapModels();
    setModelTools(models);
    this._refreshToolList();
  }

  _refreshToolList() {
    const toolList = document.getElementById('editor-tool-list');
    if (!toolList) return;
    toolList.innerHTML = '';
    const groups = [
      { key: 'basic', title: 'Basic' },
      { key: 'props', title: 'Props' },
      { key: 'models', title: 'Models' },
      { key: 'spawns', title: 'Spawns' },
    ];
    for (const { key, title } of groups) {
      const tools = getEditorAssetTools().filter(t => t.category === key);
      if (!tools.length) continue;
      const heading = document.createElement('p');
      heading.className = 'editor-tool-group-title';
      heading.textContent = title;
      toolList.appendChild(heading);
      for (const t of tools) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'editor-tool-btn' + (t.id === this.selectedTool ? ' active' : '');
        btn.dataset.tool = t.id;
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
          this.selectedTool = t.id;
          toolList.querySelectorAll('.editor-tool-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tool === t.id),
          );
        });
        toolList.appendChild(btn);
      }
    }
  }

  // ── Placement ─────────────────────────────────────────────

  _placeAtWorld(x, z) {
    const w = this.mapData.meta.width ?? MAP_W;
    const h = this.mapData.meta.height ?? MAP_H;
    const snap = snapWorldToCell(x, z);
    const { type, modelId } = parseToolSelection(this.selectedTool);
    const toolDef = getToolDefForType(type, modelId);
    if (!toolDef) return;

    if (this.eraseMode) {
      const existing = this._assetAtCell(snap.gx, snap.gz);
      if (existing) {
        this.mapData.assets = this.mapData.assets.filter(a => a.id !== existing.id);
        this._syncAssetMeshes();
      }
      return;
    }

    if (!this._footprintFits(snap.gx, snap.gz, type, modelId, 0, w, h)) return;
    if (this._footprintOverlaps(snap.gx, snap.gz, type, modelId, 0)) return;

    const center = footprintWorldCenter(
      snap.gx, snap.gz, toolDef.footprint ?? [1, 1], 0, CELL_SIZE,
    );

    this._assetIdCounter += 1;
    /** @type {import('./map-schema.js').MapAsset} */
    const asset = {
      id:   `asset-${this._assetIdCounter}`,
      type: /** @type {import('./map-schema.js').MapAssetType} */ (type),
      x: center.x,
      y: 0,
      z: center.z,
      rotY: 0,
      gx: snap.gx,
      gz: snap.gz,
    };
    if (modelId) {
      asset.modelId = modelId;
      asset.blocks = toolDef.blocks;
      asset.gridKind = toolDef.gridKind ?? 'cover';
      asset.footprint = [...(toolDef.footprint ?? [1, 1])];
      if (toolDef.yOffset) asset.yOffset = toolDef.yOffset;
    }
    this.mapData.assets.push(asset);
    this._syncAssetMeshes();
  }

  // ── Fly camera ────────────────────────────────────────────

  _updateFlyCameraMovement(delta) {
    const spd = 18 * delta;
    const fwd = new THREE.Vector3(
      -Math.sin(this._orbit.yaw),
      0,
      -Math.cos(this._orbit.yaw),
    );
    const rgt = new THREE.Vector3(fwd.z, 0, -fwd.x);

    if (this._keys.has('KeyZ') || this._keys.has('KeyW') || this._keys.has('ArrowUp')) {
      this._panTarget.addScaledVector(fwd, spd);
    }
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) {
      this._panTarget.addScaledVector(fwd, -spd);
    }
    if (this._keys.has('KeyQ') || this._keys.has('KeyA') || this._keys.has('ArrowLeft')) {
      this._panTarget.addScaledVector(rgt, -spd);
    }
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) {
      this._panTarget.addScaledVector(rgt, spd);
    }
    if (this._keys.has('KeyR')) this._orbit.dist = Math.max(8, this._orbit.dist - spd * 1.2);
    if (this._keys.has('KeyE')) this._orbit.dist = Math.min(90, this._orbit.dist + spd * 1.2);
  }

  _updateFlyCamera() {
    const cam = this.game.camera;
    if (!cam) return;
    const { yaw, pitch, dist } = this._orbit;
    const tp = this._panTarget;
    cam.position.set(
      tp.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      tp.y + Math.sin(pitch) * dist + 4,
      tp.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    cam.lookAt(tp.x, 0, tp.z);
  }

  // ── Raycast / preview ─────────────────────────────────────

  _ndcFromEvent(e) {
    const rect = this.game.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _raycastGround() {
    this._raycaster.setFromCamera(this._mouse, this.game.camera);
    const hit = this._raycaster.ray.intersectPlane(this._groundPlane, this._hitPoint);
    return hit ? this._hitPoint.clone() : null;
  }

  _updatePreviewFromMouse() {
    const pt = this._raycastGround();
    if (!pt) {
      this._clearPreview();
      return;
    }
    const snap = snapWorldToCell(pt.x, pt.z);
    if (!this._preview) {
      const geo = new THREE.BoxGeometry(CELL_SIZE * 0.88, 0.08, CELL_SIZE * 0.88);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      this._preview = new THREE.Mesh(geo, mat);
      this._preview.userData.ignoreRaycast = true;
      this.game.scene.add(this._preview);
    }
    this._preview.position.set(snap.x, 0.06, snap.z);
    this._preview.visible = true;
    this._preview.material.color.setHex(this.eraseMode ? 0xff4444 : 0x00ff88);
  }

  _clearPreview() {
    if (this._preview) this._preview.visible = false;
  }

  // ── Input ─────────────────────────────────────────────────

  _bindEditorInput() {
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('keyup', this._onKeyUp, true);
    const canvas = this.game.renderer?.domElement;
    canvas?.addEventListener('pointermove', this._onPointerMove);
    canvas?.addEventListener('pointerdown', this._onPointerDown);
    canvas?.addEventListener('wheel', this._onWheel, { passive: false });
    canvas?.addEventListener('contextmenu', this._onContextMenu);
  }

  _unbindEditorInput() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('keyup', this._onKeyUp, true);
    const canvas = this.game.renderer?.domElement;
    canvas?.removeEventListener('pointermove', this._onPointerMove);
    canvas?.removeEventListener('pointerdown', this._onPointerDown);
    canvas?.removeEventListener('wheel', this._onWheel);
    canvas?.removeEventListener('contextmenu', this._onContextMenu);
    this._keys.clear();
    this._dragging = false;
    this._overlayOnly = false;
  }

  _handleKeyDown(e) {
    if (!this.active) return;
    if (e.code === 'Backquote' || (e.code === 'KeyM' && e.ctrlKey)) {
      e.preventDefault();
      this.game.toggleEditorMode();
      return;
    }
    this._keys.add(e.code);
  }

  _handleKeyUp(e) {
    this._keys.delete(e.code);
  }

  _handlePointerMove(e) {
    if (!this.active) return;
    this._ndcFromEvent(e);
    if (this._dragging && e.buttons === 2) {
      const dx = e.clientX - this._lastMouse.x;
      const dy = e.clientY - this._lastMouse.y;
      this._orbit.yaw -= dx * 0.005;
      this._orbit.pitch = Math.max(0.15, Math.min(1.4, this._orbit.pitch + dy * 0.005));
    }
    this._lastMouse.x = e.clientX;
    this._lastMouse.y = e.clientY;
  }

  _handlePointerDown(e) {
    if (!this.active) return;
    this._ndcFromEvent(e);
    if (e.button === 2) {
      this._dragging = true;
      return;
    }
    if (e.button !== 0) return;
    const pt = this._raycastGround();
    if (!pt) return;
    this.eraseMode = e.shiftKey;
    this._placeAtWorld(pt.x, pt.z);
    this.eraseMode = false;
  }

  _handleWheel(e) {
    if (!this.active) return;
    e.preventDefault();
    this._orbit.dist = Math.max(8, Math.min(90, this._orbit.dist + e.deltaY * 0.04));
  }

  // ── DOM sidebar ───────────────────────────────────────────

  _showSidebar(show) {
    document.getElementById('map-editor-panel')?.classList.toggle('hidden', !show);
    document.getElementById('hud')?.classList.toggle('hidden', show);
    document.getElementById('crosshair')?.classList.toggle('hidden', show);
  }

  _bindEditorDom() {
    this._refreshToolList();
    const toolList = document.getElementById('editor-tool-list');
    if (toolList && !toolList.dataset.bound) {
      toolList.dataset.bound = '1';
    }

    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', fn);
      }
    };
    bind('editor-btn-save', () => this.saveMap());
    bind('editor-btn-load', () => this.loadMapPrompt());
    bind('editor-btn-new', () => this.newMap());
    bind('editor-btn-exit', () => this.game.exitEditorToMenu());
    bind('editor-btn-day', () => {
      if (this.mapData.theme?.timeOfDay !== 'day') this.toggleDayNight();
    });
    bind('editor-btn-night', () => {
      if (this.mapData.theme?.timeOfDay === 'night') return;
      this.toggleDayNight();
    });
    bind('editor-btn-apply-size', () => this.applyMapSizeFromUi());

    const wEl = document.getElementById('editor-map-width');
    const hEl = document.getElementById('editor-map-height');
    if (wEl && !wEl.dataset.bound) {
      wEl.dataset.bound = '1';
      wEl.min = String(MIN_MAP_CELLS);
      wEl.max = String(MAX_MAP_CELLS);
    }
    if (hEl && !hEl.dataset.bound) {
      hEl.dataset.bound = '1';
      hEl.min = String(MIN_MAP_CELLS);
      hEl.max = String(MAX_MAP_CELLS);
    }
  }

  _setStatus(msg, isError = false) {
    const el = document.getElementById('editor-status');
    if (el) {
      el.textContent = msg;
      el.classList.toggle('editor-status--error', isError);
    }
  }
}
