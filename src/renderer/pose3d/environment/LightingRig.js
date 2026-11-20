import * as THREE from '../../vendor/three.module.js';

/* 3-point ışık rigi: Key/Fill/Rim DirectionalLight + zemin gölgesi.
   Renk sıcaklığı Kelvin→RGB (Tanner Helland yaklaşımı) ile hesaplanır. */

const SHADOW_SIZES = { low: 1024, medium: 2048, high: 4096 };

const DEFAULTS = {
  key: { intensity: 1.5, kelvin: 5600, azimuth: 38, elevation: 42 },
  fill: { intensity: 0.5, kelvin: 4700, azimuth: -58, elevation: 14 },
  rim: { intensity: 1.0, kelvin: 7600, azimuth: 168, elevation: 52 },
};

const clamp01 = value => Math.min(1, Math.max(0, value / 255));

/* 1000–40000 K arası renk. Değerler sRGB uzayındadır (0–1). */
export function kelvinToRGB(kelvin) {
  const value = Math.min(40000, Math.max(1000, Number(kelvin) || 6500));
  const temp = value / 100;
  let r;
  let g;
  let b;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

export class LightingRig {
  constructor({ viewport }) {
    this.viewport = viewport;
    this.scene = viewport.scene;
    this.renderer = viewport.renderer;

    this.quality = 'high';
    this.shadowEnabled = true;
    this.floorOpacity = 0.28;
    this.gridVisible = true;
    this.distance = 8;
    this.size = new THREE.Vector3(1, 2, 1);

    this.state = {
      key: { ...DEFAULTS.key },
      fill: { ...DEFAULTS.fill },
      rim: { ...DEFAULTS.rim },
    };

    this.target = new THREE.Object3D();
    this.target.name = 'pose-light-target';
    this.scene.add(this.target);

    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a3340, 0.22);
    this.hemi.name = 'pose-hemi-light';
    this.scene.add(this.hemi);

    this.lights = {};
    ['key', 'fill', 'rim'].forEach(name => {
      const light = new THREE.DirectionalLight(0xffffff, this.state[name].intensity);
      light.name = `pose-${name}-light`;
      light.target = this.target;
      light.castShadow = name === 'key';
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 3;
      this.scene.add(light);
      this.lights[name] = light;
    });

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    /* Zemin: yalnızca gölge alır; opaklığı panelden ayarlanır. */
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: this.floorOpacity, depthWrite: false }),
    );
    this.floor.name = 'pose-shadow-floor';
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -1.05;
    this.floor.receiveShadow = true;
    /* OutlineEffect zeminin çevresini çizmesin. */
    this.floor.material.userData.outlineParameters = { visible: false };
    this.scene.add(this.floor);

    this.grid = new THREE.GridHelper(8, 32, 0x7190a0, 0x354653);
    this.grid.name = 'pose-grid';
    this.grid.position.y = -1.04;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.45;
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    this.setShadowQuality(this.quality);
    this.applyAll();
  }

  /* --- Işık durumu --- */

  getLight(name) {
    const state = this.state[name];
    return state ? { ...state } : null;
  }

  setLight(name, patch = {}) {
    const state = this.state[name];
    if (!state) return null;
    if (patch.intensity !== undefined) state.intensity = Math.min(10, Math.max(0, Number(patch.intensity) || 0));
    if (patch.kelvin !== undefined) state.kelvin = Math.min(12000, Math.max(2000, Number(patch.kelvin) || 5600));
    if (patch.azimuth !== undefined) state.azimuth = ((Number(patch.azimuth) || 0) % 360 + 360) % 360;
    if (patch.elevation !== undefined) state.elevation = Math.min(90, Math.max(0, Number(patch.elevation) || 0));
    this.applyLight(name);
    this.viewport.invalidate();
    return { ...state };
  }

  setIntensity(name, value) { return this.setLight(name, { intensity: value }); }
  setTemperature(name, value) { return this.setLight(name, { kelvin: value }); }
  setAzimuth(name, value) { return this.setLight(name, { azimuth: value }); }
  setElevation(name, value) { return this.setLight(name, { elevation: value }); }

  applyLight(name) {
    const state = this.state[name];
    const light = this.lights[name];
    if (!state || !light) return;
    const rgb = kelvinToRGB(state.kelvin);
    light.color.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
    light.intensity = state.intensity;

    const elevation = THREE.MathUtils.degToRad(state.elevation);
    const azimuth = THREE.MathUtils.degToRad(state.azimuth);
    const horizontal = Math.cos(elevation) * this.distance;
    light.position.set(
      Math.sin(azimuth) * horizontal + this.target.position.x,
      Math.sin(elevation) * this.distance + this.target.position.y,
      Math.cos(azimuth) * horizontal + this.target.position.z,
    );
    light.updateMatrixWorld();
  }

  applyAll() {
    ['key', 'fill', 'rim'].forEach(name => this.applyLight(name));
  }

  /* Model boyutuna göre gölge kamerası, zemin ve ışık mesafesi. */
  fit(size) {
    const safe = size || this.size;
    this.size.copy(safe);
    const radius = Math.max(safe.x, safe.y, safe.z) || 2;
    this.distance = Math.max(6, radius * 3.5);

    const bottom = -safe.y / 2;
    this.floor.position.y = bottom - 0.02;
    this.grid.position.y = bottom - 0.01;
    this.floor.scale.setScalar(Math.max(1, radius / 2));

    const bounds = Math.max(1.6, radius * 1.8);
    ['key', 'fill', 'rim'].forEach(name => {
      const shadowCamera = this.lights[name].shadow.camera;
      shadowCamera.left = -bounds;
      shadowCamera.right = bounds;
      shadowCamera.top = bounds;
      shadowCamera.bottom = -bounds;
      shadowCamera.near = 0.1;
      shadowCamera.far = this.distance * 4;
      shadowCamera.updateProjectionMatrix();
    });

    this.applyAll();
    this.viewport.invalidate();
  }

  /* --- Gölge ve zemin --- */

  setShadowQuality(level) {
    const next = SHADOW_SIZES[level] ? level : 'high';
    this.quality = next;
    const size = SHADOW_SIZES[next];
    ['key', 'fill', 'rim'].forEach(name => {
      const shadow = this.lights[name].shadow;
      shadow.mapSize.set(size, size);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    });
    this.renderer.shadowMap.needsUpdate = true;
    this.viewport.invalidate();
    return next;
  }

  setShadows(enabled) {
    this.shadowEnabled = !!enabled;
    this.renderer.shadowMap.enabled = this.shadowEnabled;
    this.lights.key.castShadow = this.shadowEnabled;
    this.syncFloorVisibility();
    this.viewport.invalidate();
    return this.shadowEnabled;
  }

  setFloorOpacity(value) {
    this.floorOpacity = Math.min(1, Math.max(0, Number(value) || 0));
    this.floor.material.opacity = this.floorOpacity;
    this.syncFloorVisibility();
    this.viewport.invalidate();
    return this.floorOpacity;
  }

  setGridVisible(visible) {
    this.gridVisible = !!visible;
    this.grid.visible = this.gridVisible;
    this.viewport.invalidate();
    return this.gridVisible;
  }

  syncFloorVisibility() {
    this.floor.visible = this.shadowEnabled && this.floorOpacity > 0.001;
    this.grid.visible = this.gridVisible;
  }

  dispose() {
    ['key', 'fill', 'rim'].forEach(name => {
      const light = this.lights[name];
      if (light?.shadow?.map) light.shadow.map.dispose();
      this.scene.remove(light);
    });
    this.scene.remove(this.hemi);
    this.scene.remove(this.target);
    this.scene.remove(this.floor);
    this.scene.remove(this.grid);
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.lights = {};
  }
}
