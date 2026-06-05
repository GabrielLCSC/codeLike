/**
 * World yaw (Y) from a direction vector on the XZ plane.
 * Mesh is authored facing +Z; atan2(dx, dz) points +Z toward (dx, dz).
 */
export function yawFromDirection(dx, dz) {
  return Math.atan2(dx, dz);
}

/** World yaw (Y) from one XZ point toward another. */
export function yawTowardPoint(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** @deprecated Use yawFromDirection or yawTowardPoint — kept for gradual migration. */
export function yawToward(a, b, c, d) {
  if (c === undefined) return yawFromDirection(a, b);
  return yawTowardPoint(a, b, c, d);
}
