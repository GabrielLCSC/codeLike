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
    /** @type {{mesh:THREE.Mesh, life:number, maxLife:number, peak:number}[]} */
    this._bursts    = [];
    /** @type {THREE.PointLight[]} */
    this._flashLights = [];
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

  /** Bright muzzle flash visible in world space (players + bots). */
  spawnMuzzleFlash(point, direction) {
    const fwd = direction.clone().normalize();
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), coreMat);
    core.position.copy(point).addScaledVector(fwd, 0.02);
    this._scene.add(core);
    this._bursts.push({ mesh: core, life: 0.075, maxLife: 0.075, peak: 2.6, kind: 'fire' });

    const flash = new THREE.PointLight(0xffaa44, 20, 6);
    flash.position.copy(point);
    this._scene.add(flash);
    this._flashLights.push({ light: flash, life: 0.085, maxLife: 0.085 });

    this.spawnMuzzleSmoke(point, fwd);
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

  /** Grenade / explosive burst — fireball, shock ring, debris, light flash. */
  spawnExplosion(center) {
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff6622,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), coreMat);
    core.position.copy(center);
    this._scene.add(core);
    this._bursts.push({ mesh: core, life: 0.42, maxLife: 0.42, peak: 3.2, kind: 'fire' });

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.55, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center).y += 0.08;
    this._scene.add(ring);
    this._bursts.push({ mesh: ring, life: 0.55, maxLife: 0.55, peak: 5.5, kind: 'ring' });

    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x3a3835,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), smokeMat);
    smoke.position.copy(center).y += 0.4;
    this._scene.add(smoke);
    this._bursts.push({ mesh: smoke, life: 1.1, maxLife: 1.1, peak: 4.0, kind: 'smoke' });

    const count = 28 + Math.floor(Math.random() * 14);
    for (let i = 0; i < count; i++) {
      const isSpark = i < count * 0.45;
      const size = isSpark ? 0.04 + Math.random() * 0.05 : 0.06 + Math.random() * 0.08;
      const mat = new THREE.MeshBasicMaterial({
        color: isSpark ? 0xffcc55 : 0x5a5048,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 5, 4), mat);
      mesh.position.copy(center);
      this._scene.add(mesh);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        4 + Math.random() * 10,
        (Math.random() - 0.5) * 14,
      );
      const maxLife = 0.45 + Math.random() * 0.55;
      this._particles.push({ mesh, vel, life: maxLife, maxLife });
    }

    const flash = new THREE.PointLight(0xffaa55, 28, 14);
    flash.position.copy(center).y += 0.5;
    this._scene.add(flash);
    this._flashLights.push({ light: flash, life: 0.35, maxLife: 0.35 });
  }

  /** Call every frame. @param {number} delta — seconds since last frame */
  update(delta) {
    for (let i = this._bursts.length - 1; i >= 0; i--) {
      const b = this._bursts[i];
      b.life -= delta;
      const t = 1 - b.life / b.maxLife;
      const ease = 1 - (1 - t) * (1 - t);
      const scale = 0.15 + ease * b.peak;
      b.mesh.scale.setScalar(scale);
      if (b.kind === 'fire') {
        b.mesh.material.opacity = 0.95 * Math.max(0, b.life / b.maxLife);
      } else if (b.kind === 'ring') {
        b.mesh.material.opacity = 0.7 * Math.max(0, b.life / b.maxLife);
      } else {
        b.mesh.material.opacity = 0.5 * Math.max(0, b.life / b.maxLife);
        b.mesh.position.y += delta * 0.35;
      }
      if (b.life <= 0) {
        this._scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this._bursts.splice(i, 1);
      }
    }

    for (let i = this._flashLights.length - 1; i >= 0; i--) {
      const f = this._flashLights[i];
      f.life -= delta;
      f.light.intensity = 28 * Math.max(0, f.life / f.maxLife);
      if (f.life <= 0) {
        this._scene.remove(f.light);
        this._flashLights.splice(i, 1);
      }
    }

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
    this._bursts.forEach(b => {
      this._scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    });
    this._bursts = [];
    this._flashLights.forEach(f => this._scene.remove(f.light));
    this._flashLights = [];
  }
}
