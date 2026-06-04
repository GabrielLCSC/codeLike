// ═══════════════════════════════════════════════════════════
//  WARFRONT — Grenades (pin hold → throw, timed fuse, AoE)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  GRENADE_MAX,
  GRENADE_FUSE_S,
  GRENADE_THROW_SPEED,
  GRENADE_THROW_LIFT,
  GRENADE_DAMAGE,
  GRENADE_RADIUS,
  GRENADE_GRAVITY,
} from './config.js';
import { sound } from './sound.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _throwVel = new THREE.Vector3();

function falloffDamage(dist, radius, maxDmg) {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return maxDmg * t * t;
}

/** Build a small viewmodel + world grenade mesh. */
function makeGrenadeMesh() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4a5238 });
  const pinMat  = new THREE.MeshLambertMaterial({ color: 0x8a9098 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bodyMat);
  body.scale.set(1, 1.15, 1);
  g.add(body);

  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), pinMat);
  pin.rotation.x = Math.PI / 2;
  pin.position.set(0.07, 0.04, 0);
  pin.name = 'pin';
  g.add(pin);

  return g;
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Scene} scene
 * @param {import('./weapon.js').WeaponSystem} weapon
 * @param {object} hooks
 * @param {(amount: number, source: string) => void} hooks.onPlayerDamage
 * @param {(bot: import('./bots/host-bot.js').Bot, amount: number) => boolean} hooks.onBotDamage
 * @param {() => import('./bots/host-bot.js').Bot[]} hooks.getBots
 * @param {() => import('./mapgen.js').MapGenerator} hooks.getMap
 * @param {() => import('./particles.js').ParticleSystem} hooks.getParticles
 */
export class GrenadeSystem {
  constructor(camera, scene, weapon, hooks) {
    this._camera    = camera;
    this._scene     = scene;
    this._weapon    = weapon;
    this._hooks     = hooks;

    this.count      = GRENADE_MAX;
    this._primed    = false;
    this._fuseLeft  = 0;
    this._handMesh  = null;
    this._pinPhase  = 0;

    /** @type {{ mesh: THREE.Group, pos: THREE.Vector3, vel: THREE.Vector3, fuse: number }[]} */
    this._active = [];
  }

  get isPrimed() { return this._primed; }
  get fuseLeft() { return this._fuseLeft; }

  reset() {
    this._cancelPrime();
    this._clearActive();
    this.count = GRENADE_MAX;
  }

  /** E down — unpin, start 4s fuse, show in hand. */
  tryPrime() {
    if (this._primed || this.count <= 0) return false;
    if (this._weapon.reloading) return false;

    this._weapon.setADS(false);
    this._weapon.setViewSuppressed(true);

    this._primed   = true;
    this._fuseLeft = GRENADE_FUSE_S;
    this._pinPhase = 0;

    this._handMesh = makeGrenadeMesh();
    this._camera.add(this._handMesh);
    this._updateHandPose(0);

    sound.play('ui_click', { volume: 0.45, pitch: 0.85 });
    return true;
  }

  /** E up — throw; fuse keeps counting from unpin. */
  releaseThrow() {
    if (!this._primed) return;

    const pos = new THREE.Vector3();
    this._handMesh.getWorldPosition(pos);

    this._camera.getWorldDirection(_fwd);
    _right.setFromMatrixColumn(this._camera.matrix, 0);

    _throwVel.copy(_fwd).multiplyScalar(GRENADE_THROW_SPEED);
    _throwVel.y += GRENADE_THROW_LIFT;
    _throwVel.addScaledVector(_right, 0.6);

    this._spawnWorldGrenade(pos, _throwVel, { broadcast: true });
    this._endPrimeConsume();
  }

  update(delta) {
    if (this._primed) {
      this._fuseLeft -= delta;
      this._pinPhase += delta * 14;
      this._updateHandPose(delta);

      if (this._fuseLeft <= 0) {
        const pos = new THREE.Vector3();
        this._handMesh.getWorldPosition(pos);
        this._detonate(pos, 'Grenade');
        this._endPrimeConsume();
      }
    }

    for (let i = this._active.length - 1; i >= 0; i--) {
      const g = this._active[i];
      g.fuse -= delta;
      g.vel.y -= GRENADE_GRAVITY * delta;
      g.pos.addScaledVector(g.vel, delta);

      const map = this._hooks.getMap();
      if (map.isWall(g.pos.x, g.pos.z)) {
        g.vel.x *= -0.35;
        g.vel.z *= -0.35;
      }
      if (g.pos.y < 0.12) {
        g.pos.y = 0.12;
        g.vel.y = Math.abs(g.vel.y) * 0.28;
        g.vel.x *= 0.72;
        g.vel.z *= 0.72;
      }

      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += delta * 9;
      g.mesh.rotation.z += delta * 6;

      if (g.fuse <= 0) {
        this._detonate(g.pos.clone(), 'Grenade');
        this._scene.remove(g.mesh);
        g.mesh.traverse(c => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
        this._active.splice(i, 1);
      }
    }
  }

  _updateHandPose(delta) {
    if (!this._handMesh) return;
    const t = this._pinPhase;
    this._handMesh.position.set(0.28 + Math.sin(t) * 0.008, -0.14 + Math.cos(t * 0.7) * 0.006, -0.38);
    this._handMesh.rotation.set(-0.35 + Math.sin(t * 0.5) * 0.04, 0.45, 0.25);
    const pin = this._handMesh.getObjectByName('pin');
    if (pin) pin.rotation.z = Math.min(Math.PI * 0.55, t * 0.35);
  }

  _spawnWorldGrenade(pos, vel, { broadcast = false } = {}) {
    const mesh = makeGrenadeMesh();
    mesh.scale.setScalar(1.35);
    mesh.position.copy(pos);
    this._scene.add(mesh);
    const entry = {
      mesh,
      pos: pos.clone(),
      vel: vel.clone(),
      fuse: this._fuseLeft,
    };
    this._active.push(entry);

    if (broadcast && this._hooks.broadcastThrow) {
      this._hooks.broadcastThrow({
        x: pos.x, y: pos.y, z: pos.z,
        vx: vel.x, vy: vel.y, vz: vel.z,
        fuse: this._fuseLeft,
      });
    }
  }

  /** Networked throw from another player — visual + physics only. */
  spawnRemoteThrow(data) {
    const pos = new THREE.Vector3(data.x, data.y ?? 0.12, data.z);
    const vel = new THREE.Vector3(data.vx, data.vy, data.vz);
    this._spawnWorldGrenade(pos, vel, { broadcast: false });
  }

  /** Explosion from network (VFX + damage for non-thrower clients). */
  handleRemoteExplode(center, sourceName) {
    this._hooks.getParticles().spawnExplosion(center);
    sound.play('bullet_wall', { volume: 0.9, pitch: 0.45 });
    this._hooks.onExplosionDamage?.(center, sourceName, false);
  }

  _detonate(center, sourceName) {
    this._hooks.getParticles().spawnExplosion(center);
    sound.play('bullet_wall', { volume: 0.9, pitch: 0.45 });
    this._hooks.onExplosionDamage?.(center, sourceName, true);
    this._hooks.broadcastExplode?.(center);
  }

  _endPrimeConsume() {
    this._cancelPrime();
    this.count = Math.max(0, this.count - 1);
  }

  _cancelPrime() {
    if (this._handMesh) {
      this._camera.remove(this._handMesh);
      this._handMesh.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      this._handMesh = null;
    }
    this._primed = false;
    this._fuseLeft = 0;
    this._weapon.setViewSuppressed(false);
  }

  _clearActive() {
    for (const g of this._active) {
      this._scene.remove(g.mesh);
      g.mesh.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }
    this._active = [];
  }
}
