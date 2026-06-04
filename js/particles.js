// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bullet-impact particle system
//  Self-contained: pass a THREE.Scene, call update() each frame.
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';

export class ParticleSystem {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene     = scene;
    /** @type {{mesh:THREE.Mesh, vel:THREE.Vector3, life:number, maxLife:number}[]} */
    this._particles = [];
  }

  /** Spawn sparks + debris at a surface-impact point. */
  spawnImpact(point, normal) {
    const count = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const isSpark = i < count * 0.5;
      const size    = isSpark ? 0.018 + Math.random() * 0.022 : 0.025 + Math.random() * 0.035;
      const mat     = new THREE.MeshBasicMaterial({
        color:      isSpark ? 0xffcc44 : 0x888877,
        transparent: true, opacity: 1, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 4, 4), mat);
      mesh.position.copy(point).addScaledVector(normal, 0.04);
      this._scene.add(mesh);

      const vel = normal.clone()
        .multiplyScalar(1.5 + Math.random() * 2)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 2.5,
          Math.random() * 2.0 + 0.5,
          (Math.random() - 0.5) * 2.5,
        ));
      const maxLife = isSpark ? 0.35 + Math.random() * 0.25 : 0.5 + Math.random() * 0.3;
      this._particles.push({ mesh, vel, life: maxLife, maxLife });
    }

    // Brief flash at impact point
    const flash = new THREE.PointLight(0xffaa33, 6, 1.8);
    flash.position.copy(point).addScaledVector(normal, 0.06);
    this._scene.add(flash);
    setTimeout(() => this._scene.remove(flash), 70);
  }

  /** Subtle muzzle smoke puffs after a shot (world space). */
  spawnMuzzleSmoke(point, direction) {
    const fwd = direction.clone().normalize();
    const count = 14 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const baseOpacity = 0.06 + Math.random() * 0.1;
      const mat = new THREE.MeshBasicMaterial({
        color:       0xb8b4a8,
        transparent: true,
        opacity:     baseOpacity,
        depthWrite:  false,
      });
      const radius = 0.012 + Math.random() * 0.022;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 6, 5),
        mat,
      );
      mesh.position.copy(point).addScaledVector(fwd, 0.02 + Math.random() * 0.06);
      mesh.position.add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.06,
        (Math.random() - 0.5) * 0.04,
        (Math.random() - 0.5) * 0.06,
      ));
      this._scene.add(mesh);

      const vel = fwd.clone().multiplyScalar(0.15 + Math.random() * 0.28).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.14,
          0.28 + Math.random() * 0.38,
          (Math.random() - 0.5) * 0.14,
        ),
      );
      const maxLife = 0.65 + Math.random() * 0.45;
      this._particles.push({
        mesh, vel, life: maxLife, maxLife,
        isSmoke: true,
        baseOpacity,
        grow: 0.9 + Math.random() * 0.8,
      });
    }
  }

  /** Call every frame. @param {number} delta — seconds since last frame */
  update(delta) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= delta;
      p.vel.y -= (p.isSmoke ? 0.9 : 9) * delta;
      p.mesh.position.addScaledVector(p.vel, delta * (p.isSmoke ? 0.75 : 0.6));

      if (p.isSmoke) {
        const t = 1 - p.life / p.maxLife;
        const scale = 1 + t * (p.grow ?? 1);
        p.mesh.scale.setScalar(scale);
        p.mesh.material.opacity = (p.baseOpacity ?? 0.1) * Math.max(0, p.life / p.maxLife);
      } else {
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      }

      if (p.life <= 0) {
        this._scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this._particles.splice(i, 1);
      }
    }
  }

  /** Remove all active particles and free GPU memory. */
  dispose() {
    this._particles.forEach(p => {
      this._scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });
    this._particles = [];
  }
}
