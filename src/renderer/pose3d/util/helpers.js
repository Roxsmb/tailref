import * as THREE from '../../vendor/three.module.js';

/* Saf yardımcılar — DOM veya sahne durumu tutmaz. */

export function cleanName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function disposeObject(root) {
  if (!root) return;
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    materials.forEach(mat => {
      if (!mat) return;
      Object.values(mat).forEach(value => {
        if (value && value.isTexture) value.dispose();
      });
      mat.dispose();
    });
  });
}

/* 36×24 mm tam kare sensör varsayımıyla lens etiketi. */
export function describeCamera(camera, mode = 'perspective') {
  if (mode === 'orthographic' || camera?.isOrthographicCamera) return 'Ortho';
  const focal = 12 / Math.tan((camera.fov * Math.PI) / 360);
  return `Persp · ${Math.round(focal)}mm`;
}

export function lutGradient(stops) {  const data = new Uint8Array(stops.length * 4);
  stops.forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  const texture = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
