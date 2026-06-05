// ═══════════════════════════════════════════════════════════
//  WARFRONT — Weapon / magazine pickup interactions
// ═══════════════════════════════════════════════════════════

import {
  WEAPONS,
  DROPPABLE_WEAPONS,
  MAG_WEAPON_TYPES,
  WALL_WEAPON_RADIUS,
  MAG_PICKUP_RADIUS,
  AMMO_CHEST_RADIUS,
} from '../config.js';
import { pickupLabelFor } from '../weapon-pickups.js';
import { magLabelFor } from '../mag-pickups.js';
import { sound } from '../sound.js';

/**
 * Ground weapon & magazine pickup state and player interactions.
 * @param {import('../game.js').Game} game
 */
export class PickupController {
  constructor(game) {
    this.game = game;
    this.nearWeaponPickup = null;
    this.nearMagPickup = null;
    this._pickupIdCounter = 0;
  }

  reset() {
    this.nearWeaponPickup = null;
    this.nearMagPickup = null;
    this._pickupIdCounter = 0;
  }

  nextPickupId(prefix = 'drop') {
    this._pickupIdCounter += 1;
    return `${prefix}-${this._pickupIdCounter}-${Date.now()}`;
  }

  updateInteractZones(delta) {
    const game = this.game;
    const px = game.camera.position.x;
    const pz = game.camera.position.z;
    const showHud = game.controls.isLocked;
    const canTakeMag = w => game.weapon?.canUseMagPickup(w) ?? false;

    const nearPickup = game.weaponPickups?.findNearest(px, pz, WALL_WEAPON_RADIUS) ?? null;
    this.nearWeaponPickup = nearPickup?.id ?? null;
    game.weaponPickups?.updateHighlights(px, pz, game.map);
    game.weaponPickups?.updatePulse(delta);

    const nearMag = game.magPickups?.findNearestTakable(px, pz, MAG_PICKUP_RADIUS, canTakeMag) ?? null;
    this.nearMagPickup = nearMag?.id ?? null;
    game.magPickups?.updateHighlights(px, pz, game.map, canTakeMag);
    game.magPickups?.updatePulse(delta);

    if (nearPickup) {
      game.hud.showWallWeaponHint(showHud, nearPickup.label);
      game.hud.showMagHint(false);
      game.hud.showAmmoChestHint(false);
      return;
    }

    game.hud.showWallWeaponHint(false);

    if (nearMag) {
      game.hud.showMagHint(showHud, nearMag.label);
      game.hud.showAmmoChestHint(false);
      return;
    }

    game.hud.showMagHint(false);

    const chests = game.map.ammoChests ?? [];
    let nearChest = false;
    const chestR2 = AMMO_CHEST_RADIUS * AMMO_CHEST_RADIUS;
    for (const c of chests) {
      const dx = px - c.x;
      const dz = pz - c.z;
      if (dx * dx + dz * dz <= chestR2) {
        nearChest = true;
        break;
      }
    }
    game._nearAmmoChest = nearChest;
    const now     = performance.now();
    const ready   = now >= game._ammoChestReadyAt;
    const leftSec = ready ? 0 : Math.ceil((game._ammoChestReadyAt - now) / 1000);
    game.hud.showAmmoChestHint(nearChest && showHud, ready, leftSec);
  }

  spawnGroundPickup(x, z, weapon, ammo, reserve, id = null) {
    const game = this.game;
    if (!DROPPABLE_WEAPONS.has(weapon)) return null;
    const pickupId = id ?? this.nextPickupId('drop');
    game.weaponPickups?.spawnGround({
      id: pickupId,
      weapon,
      x,
      z,
      ammo,
      reserve,
      label: pickupLabelFor(weapon),
    });
    return pickupId;
  }

  spawnGroundPickupFromNetwork(evt) {
    if (this.game.weaponPickups?.get(evt.id)) return;
    this.spawnGroundPickup(evt.x, evt.z, evt.weapon, evt.ammo, evt.reserve, evt.id);
  }

  broadcastGroundPickup(id, weapon, x, z, ammo, reserve) {
    this.game.mp?.sendWorldEvent({
      type:    'weapon_ground_spawn',
      id,
      weapon,
      x,
      z,
      ammo,
      reserve,
    });
  }

  broadcastGroundMag(id, weapon, x, z) {
    this.game.mp?.sendWorldEvent({
      type:   'mag_ground_spawn',
      id,
      weapon,
      x,
      z,
    });
  }

  spawnGroundMag(x, z, weapon, id = null) {
    const game = this.game;
    if (!MAG_WEAPON_TYPES.has(weapon)) return null;
    const pickupId = id ?? this.nextPickupId('mag');
    game.magPickups?.spawnGround({
      id: pickupId,
      weapon,
      x,
      z,
      label: magLabelFor(weapon),
    });
    return pickupId;
  }

  spawnGroundMagFromNetwork(evt) {
    if (this.game.magPickups?.get(evt.id)) return;
    this.spawnGroundMag(evt.x, evt.z, evt.weapon, evt.id);
  }

  dropActiveAt(x, z, syncId = null) {
    const game = this.game;
    const dropped = game.weapon.dropPrimary();
    if (!dropped || !DROPPABLE_WEAPONS.has(dropped.key)) return null;
    const id = this.spawnGroundPickup(x, z, dropped.key, dropped.ammo, dropped.reserve, syncId);
    if (id && !syncId) {
      this.broadcastGroundPickup(id, dropped.key, x, z, dropped.ammo, dropped.reserve);
    }
    game.hud.setWeaponSlot(game.weapon.activeSlot, game.weapon.slotOccupancy());
    return id;
  }

  tryTakeWeaponPickup() {
    const game = this.game;
    if (!game.alive || !game.controls.isLocked || !this.nearWeaponPickup) return false;
    const pickup = game.weaponPickups?.get(this.nearWeaponPickup);
    if (!pickup || pickup.taken) return false;

    const dropX = pickup.x + (Math.random() - 0.5) * 0.6;
    const dropZ = pickup.z + (Math.random() - 0.5) * 0.6;
    const bothFull = game.weapon.hasSlot('primary') && game.weapon.hasSlot('side');
    if (bothFull) {
      this.dropActiveAt(dropX, dropZ);
    }

    const ammoState = pickup.kind === 'ground' || pickup.ammo != null
      ? { key: pickup.weapon, ammo: pickup.ammo ?? WEAPONS[pickup.weapon].magSize, reserve: pickup.reserve ?? 0 }
      : null;

    game.weapon.pickupWeapon(pickup.weapon, ammoState);
    game._applyADSState(false);
    game.weaponPickups.remove(pickup.id);
    this.nearWeaponPickup = null;
    game.hud.setWeaponSlot(game.weapon.activeSlot, game.weapon.slotOccupancy());

    game.mp?.updateWeapon(pickup.weapon);
    game.mp?.sendWorldEvent({ type: 'weapon_pickup_removed', id: pickup.id });
    sound.play('ui_click', { volume: 0.65, pitch: 1.08 });
    return true;
  }

  tryTakeMagPickup() {
    const game = this.game;
    if (!game.alive || !game.controls.isLocked || !this.nearMagPickup) return false;
    const pickup = game.magPickups?.get(this.nearMagPickup);
    if (!pickup || pickup.taken) return false;
    if (!game.weapon.canUseMagPickup(pickup.weapon)) return false;

    if (!game.weapon.applyMagPickup(pickup.weapon)) return false;

    game.magPickups.remove(pickup.id);
    this.nearMagPickup = null;
    game.mp?.sendWorldEvent({ type: 'mag_pickup_removed', id: pickup.id });
    sound.play('ui_click', { volume: 0.55, pitch: 1.15 });
    return true;
  }

  tryDropMag() {
    const game = this.game;
    if (!game.alive || !game.controls.isLocked || game.weapon.isThrowing) return;
    if (game.grenades?.isPrimed) return;
    if (!game.weapon.canDropMag()) return;

    const dropped = game.weapon.dropMagReserve();
    if (!dropped) return;

    game.camera.getWorldDirection(game._camDir);
    game._camDir.y = 0;
    if (game._camDir.lengthSq() < 0.001) game._camDir.set(0, 0, -1);
    game._camDir.normalize();

    const px = game.camera.position.x + game._camDir.x * 0.75;
    const pz = game.camera.position.z + game._camDir.z * 0.75;
    const id = this.spawnGroundMag(px, pz, dropped.weapon);
    if (id) this.broadcastGroundMag(id, dropped.weapon, px, pz);
    sound.play('ui_click', { volume: 0.45, pitch: 0.88 });
  }

  tryDropWeapon() {
    const game = this.game;
    if (!game.alive || !game.controls.isLocked || game.weapon.isThrowing) return;
    if (!game.weapon.hasSlot(game.weapon.activeSlot)) return;
    if (game.grenades?.isPrimed) return;

    game.camera.getWorldDirection(game._camDir);
    game._camDir.y = 0;
    if (game._camDir.lengthSq() < 0.001) game._camDir.set(0, 0, -1);
    game._camDir.normalize();

    const landDist = 2.4;
    const landX = game.camera.position.x + game._camDir.x * landDist;
    const landZ = game.camera.position.z + game._camDir.z * landDist;

    if (!game.weapon.beginThrow((dropped) => {
      if (!dropped) return;
      const id = this.spawnGroundPickup(landX, landZ, dropped.key, dropped.ammo, dropped.reserve);
      if (id) {
        this.broadcastGroundPickup(id, dropped.key, landX, landZ, dropped.ammo, dropped.reserve);
      }
      game.hud.setWeaponSlot(game.weapon.activeSlot, game.weapon.slotOccupancy());
    })) return;

    sound.play('ui_click', { volume: 0.5, pitch: 0.92 });
  }

  tryInteractF() {
    if (this.tryTakeWeaponPickup()) return;
    if (this.tryTakeMagPickup()) return;
    this.game._tryAmmoChestResupply();
  }

  onWeaponPickupRemoved(id) {
    if (this.nearWeaponPickup === id) this.nearWeaponPickup = null;
  }

  onMagPickupRemoved(id) {
    if (this.nearMagPickup === id) this.nearMagPickup = null;
  }
}
