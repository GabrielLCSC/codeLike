import * as THREE from 'three';

/**
 * Canvas label texture for world pickup markers.
 * @param {string} label
 * @returns {THREE.CanvasTexture}
 */
export function makeLabelTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width  = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, 40);
  const metrics = ctx.measureText(label);
  const x0 = canvas.width / 2 - metrics.width / 2;
  const x1 = canvas.width / 2 + metrics.width / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, 58);
  ctx.lineTo(x1, 58);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
