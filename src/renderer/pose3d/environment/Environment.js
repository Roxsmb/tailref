import * as THREE from '../../vendor/three.module.js';
import { RGBELoader } from '../../vendor/RGBELoader.js';

/* Sahne arka planı ve ortam haritası.
   Kipler: gradient (varsayılan), solid (tema rengi), transparent, hdri. */
const MODES = new Set(['gradient', 'solid', 'transparent', 'hdri']);

export class Environment {
  constructor({ viewport }) {
    this.viewport = viewport;
    this.scene = viewport.scene;
    this.renderer = viewport.renderer;

    this.mode = 'gradient';
    this.rotation = 0;       // derece
    this.blur = 0;           // 0–1
    this.intensity = 1;      // ortam ışığı çarpanı

    this.gradient = this.createGradientTexture();
    this.texture = this.gradient;
    this.hdri = null;
    this.envTexture = null;
    this.environmentTarget = null;

    this.scene.background = this.gradient;
    this.scene.environment = null;
    this.scene.backgroundBlurriness = 0;
    this.scene.backgroundIntensity = 1;
    this.scene.environmentIntensity = 1;
    this.scene.backgroundRotation.set(0, 0, 0);
    this.scene.environmentRotation.set(0, 0, 0);
    this.renderer.setClearAlpha(1);

    // Fog kapalı: FBX ölçeği değişince karakter/controller renklerini bozuyordu.
    this.scene.fog = null;

    this._loader = new RGBELoader();
    this._pmrem = null;
  }

  createGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#17232e');
    gradient.addColorStop(0.48, '#41596b');
    gradient.addColorStop(1, '#101820');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);

    const glow = context.createRadialGradient(256, 220, 20, 256, 220, 330);
    glow.addColorStop(0, 'rgba(170,205,224,.22)');
    glow.addColorStop(1, 'rgba(20,30,40,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 512, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = 'pose-gradient';
    return texture;
  }

  /* Tema değişkeninden düz renk. */
  themeColor() {
    const styles = getComputedStyle(document.documentElement);
    const raw = (styles.getPropertyValue('--bg') || '').trim();
    const color = new THREE.Color(0x15151a);
    if (raw) {
      try { color.set(raw); } catch { /* geçersiz CSS rengi */ }
    }
    return color;
  }

  get hasHDRI() { return !!this.hdri; }

  setBackgroundMode(mode) {
    if (!MODES.has(mode)) return false;
    this.mode = mode;
    this.applyBackground();
    this.viewport.invalidate();
    return true;
  }

  /* HDRI dosyasını (File veya URL) yükler, PMREM ortamını üretir.
     Dosya doğrudan parse edilir: CSP `connect-src 'self'` blob: isteklerini
     engellediği için File → objectURL → fetch yolu çalışmıyor. */
  async loadHDRI(source) {
    const isUrl = typeof source === 'string';
    const texture = isUrl
      ? await new Promise((resolve, reject) => {
        this._loader.load(source, resolve, undefined, reject);
      })
      : this.createHDRTexture(this._loader.parse(await source.arrayBuffer()));

    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.name = isUrl ? 'pose-hdri' : `pose-hdri-${source.name || 'file'}`;

    this.disposeHDRI();
    const pmrem = this.getPMREM();
    const target = pmrem.fromEquirectangular(texture);
    this.hdri = texture;
    this.environmentTarget = target;
    this.envTexture = target.texture;

    this.mode = 'hdri';
    this.applyBackground();
    this.viewport.invalidate();
    return true;
  }

  /* RGBELoader.parse() ham texData döner; load() gibi DataTexture üretip
     aynı doku ayarlarını (lineer uzay, filtre, mipmap yok) uygularız. */
  createHDRTexture(texData) {
    const texture = new THREE.DataTexture(
      texData.data, texData.width, texData.height, THREE.RGBAFormat, texData.type,
    );
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.needsUpdate = true;
    return texture;
  }

  clearHDRI() {
    this.disposeHDRI();
    if (this.mode === 'hdri') this.mode = 'gradient';
    this.applyBackground();
    this.viewport.invalidate();
    return true;
  }

  setRotation(degrees) {
    this.rotation = ((Number(degrees) || 0) % 360 + 360) % 360;
    this.applyRotation();
    this.viewport.invalidate();
    return this.rotation;
  }

  setBlur(value) {
    this.blur = Math.min(1, Math.max(0, Number(value) || 0));
    this.scene.backgroundBlurriness = this.mode === 'hdri' ? this.blur : 0;
    this.viewport.invalidate();
    return this.blur;
  }

  setIntensity(value) {
    this.intensity = Math.min(3, Math.max(0, Number(value) || 0));
    this.scene.environmentIntensity = this.intensity;
    this.viewport.invalidate();
    return this.intensity;
  }

  applyRotation() {
    const radians = THREE.MathUtils.degToRad(this.rotation);
    this.scene.backgroundRotation.set(0, radians, 0);
    this.scene.environmentRotation.set(0, radians, 0);
  }

  applyBackground() {
    this.applyRotation();
    this.scene.backgroundBlurriness = this.mode === 'hdri' ? this.blur : 0;
    this.scene.environmentIntensity = this.intensity;

    if (this.mode === 'hdri') {
      this.scene.background = this.hdri || this.gradient;
      this.scene.environment = this.envTexture;
      this.renderer.setClearAlpha(1);
      return;
    }

    this.scene.environment = null;
    if (this.mode === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else if (this.mode === 'solid') {
      this.scene.background = this.themeColor();
      this.renderer.setClearAlpha(1);
    } else {
      this.scene.background = this.gradient;
      this.renderer.setClearAlpha(1);
    }
  }

  /* Tema değişince düz renk arka planını tazele. */
  refreshTheme() {
    if (this.mode === 'solid') this.scene.background = this.themeColor();
    this.viewport.invalidate();
  }

  getPMREM() {
    if (!this._pmrem) {
      this._pmrem = new THREE.PMREMGenerator(this.renderer);
      this._pmrem.compileEquirectangularShader();
    }
    return this._pmrem;
  }

  disposeHDRI() {
    if (this.environmentTarget) {
      this.environmentTarget.dispose();
      this.environmentTarget = null;
    }
    if (this.hdri) {
      this.hdri.dispose();
      this.hdri = null;
    }
    this.envTexture = null;
  }

  dispose() {
    this.disposeHDRI();
    this.gradient?.dispose();
    this.gradient = null;
    this.scene.background = null;
    this.scene.environment = null;
    if (this._pmrem) {
      this._pmrem.dispose();
      this._pmrem = null;
    }
  }
}
