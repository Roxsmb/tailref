import * as THREE from '../../vendor/three.module.js';
import { PASS_IDS, resolveSize } from './CapturePresets.js';

/* Aynı renderer üzerinde yüksek çözünürlüklü kare üretir.
   Yakalama sırasında tuval geçici olarak hedef boyuta getirilir (CSS boyutu
   değişmez), kare 2D tuvale kopyalanır ve tüm durum try/finally ile geri alınır.
   Böylece ikinci bir WebGL bağlamı / doku kopyası gerekmez. */

const PASS_SET = new Set(PASS_IDS);

const blobToBytes = async blob => new Uint8Array(await blob.arrayBuffer());

const dataUrlToBlob = dataUrl => {
  const [header, base64] = String(dataUrl || '').split(',');
  const mime = /data:([^;]+)/.exec(header || '')?.[1] || 'image/png';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const canvasToBlob = canvas => new Promise(resolve => {
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob(blob => resolve(blob || dataUrlToBlob(canvas.toDataURL('image/png'))), 'image/png');
    return;
  }
  resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
});

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export class RenderExporter {
  constructor({
    viewport, pipeline = null, sceneGraph = null, lighting = null,
    posing = null, gizmo = null, skeleton = null, guides = null,
    getGraphs = null,
  } = {}) {
    this.viewport = viewport;
    this.pipeline = pipeline;
    this.sceneGraph = sceneGraph;
    this.lighting = lighting;
    this.posing = posing;
    this.gizmo = gizmo;
    this.skeleton = skeleton;
    this.guides = guides;
    /* Çoklu karakter: yakalama yardımcıları tüm karakter grafiklerini
       kapsayacak şekilde bootstrap bir işlev verir. */
    this.getGraphs = getGraphs;
    this.busy = false;
    this._hidden = [];

    this.materials = {
      alpha: new THREE.MeshBasicMaterial({
        color: 0x000000, side: THREE.DoubleSide, toneMapped: false,
      }),
      wireframe: new THREE.MeshBasicMaterial({
        color: 0x8fd8ff, wireframe: true, side: THREE.DoubleSide, toneMapped: false,
      }),
      normal: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
      /* BasicDepthPacking: 1 - fragCoordZ → yakın beyaz, uzak siyah (8-bit gri). */
      depth: new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide,
      }),
    };
  }

  get renderer() { return this.viewport.renderer; }

  /* 1x kabul edilen kaynak: tuvalin gerçek çizim tamponu (CSS × piksel oranı). */
  baseSize() {
    const canvas = this.viewport.canvas;
    const width = canvas.width || Math.round((canvas.clientWidth || 380) * this.renderer.getPixelRatio());
    const height = canvas.height || Math.round((canvas.clientHeight || 232) * this.renderer.getPixelRatio());
    return { width, height };
  }

  resolve(request = {}) {
    const maxTexture = this.renderer.capabilities?.maxTextureSize || 4096;
    return resolveSize(request, this.baseSize(), maxTexture);
  }

  /* Tek pass yakalar. Dönen: { pass, blob, width, height, preset, scale, clamped }. */
  async capture(options = {}) {
    if (!this.viewport) return null;
    if (this.busy) return null;
    const pass = PASS_SET.has(options.pass) ? options.pass : 'beauty';
    const settings = { ...options, pass };
    const renderer = this.renderer;
    const scene = this.viewport.scene;
    const camera = this.viewport.camera;
    const size = this.resolve(settings);

    this.busy = true;
    const saved = this._snapshot(camera);
    let flat = null;
    try {
      this._prepare(pass, settings);
      this._applySize(size, camera);
      if (this.pipeline?.enabled && pass === 'beauty') this.pipeline.render();
      else if (pass === 'beauty') this.viewport.outline.render(scene, camera);
      else renderer.render(scene, camera);
      flat = this._flatten(size.width, size.height, { guides: settings.guides });
    } finally {
      this._restore(saved, camera);
      this.busy = false;
    }

    if (!flat) return null;
    const blob = await canvasToBlob(flat);
    return {
      pass,
      blob,
      width: size.width,
      height: size.height,
      preset: size.preset,
      scale: size.scale,
      clamped: size.clamped,
      createdAt: Date.now(),
    };
  }

  /* Birden fazla pass'i sırayla yakalar. */
  async captureSet(passes = ['beauty'], options = {}) {
    const list = (Array.isArray(passes) ? passes : [passes]).filter(pass => PASS_SET.has(pass));
    const results = [];
    for (const pass of (list.length ? list : ['beauty'])) {
      const result = await this.capture({ ...options, pass });
      if (result) results.push(result);
    }
    return results;
  }

  /* Hızlı kare (geriye uyum): beauty PNG data URL. */
  quickCapture() {
    this.viewport.renderFrame();
    return this.viewport.renderer.domElement.toDataURL('image/png');
  }

  async toBytes(result) {
    if (!result?.blob) return null;
    return blobToBytes(result.blob);
  }

  async toDataUrl(result) {
    if (!result?.blob) return '';
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(result.blob);
    });
  }

  /* Pano: önce Clipboard API, olmazsa Electron IPC. */
  async copyToClipboard(result) {
    if (!result?.blob) return false;
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })]);
        return true;
      }
    } catch { /* IPC'ye düş */ }
    try {
      const bytes = await this.toBytes(result);
      if (window.tailref?.copyImage) return (await window.tailref.copyImage(bytes)) === true;
    } catch { /* sessiz */ }
    return false;
  }

  /* Diske kaydet: Electron kaydetme penceresi, yoksa bağlantı indirmesi. */
  async saveToDisk(result, name) {
    if (!result?.blob) return { ok: false, error: 'no image' };
    const fileName = name || this.fileName(result);
    try {
      if (window.tailref?.saveImage) {
        const bytes = await this.toBytes(result);
        const saved = await window.tailref.saveImage(bytes, fileName);
        if (saved && typeof saved === 'object') return saved;
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
    try {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, file: fileName, method: 'anchor' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  fileName(result) {
    const pass = result?.pass || 'beauty';
    return `tailref-pose-${pass}-${stamp()}.png`;
  }

  /* --- iç işleyiş --- */

  _snapshot(camera) {
    const renderer = this.renderer;
    const pipeline = this.pipeline;
    this._hidden = [];
    return {
      pixelRatio: renderer.getPixelRatio(),
      size: renderer.getSize(new THREE.Vector2()),
      clearAlpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear,
      shadowMap: renderer.shadowMap.enabled,
      background: this.viewport.scene.background,
      overrideMaterial: this.viewport.scene.overrideMaterial,
      camera: {
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      composerRatio: pipeline?.composer?._pixelRatio ?? null,
    };
  }

  _applySize(size, camera) {
    const renderer = this.renderer;
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);

    if (camera.isPerspectiveCamera) {
      camera.aspect = size.width / size.height;
    } else if (camera.isOrthographicCamera) {
      const halfHeight = Math.max(0.01, (camera.top - camera.bottom) / 2);
      const halfWidth = halfHeight * (size.width / size.height);
      camera.left = -halfWidth;
      camera.right = halfWidth;
    }
    camera.updateProjectionMatrix();

    if (this.pipeline) {
      this.pipeline.composer.setPixelRatio(1);
      this.pipeline.resize(size.width, size.height);
    }
  }

  _hide(object) {
    if (!object?.isObject3D) return;
    this._hidden.push([object, object.visible]);
    object.visible = false;
  }

  /* Çoklu karakter: bootstrap getGraphs sağlar; tek karakterde fallback. */
  _graphs() {
    const provided = typeof this.getGraphs === 'function' ? this.getGraphs() : null;
    const list = Array.isArray(provided) ? provided : this.sceneGraph ? [this.sceneGraph] : [];
    return list.filter(Boolean);
  }

  _prepare(pass, settings) {
    const beauty = pass === 'beauty';
    const scene = this.viewport.scene;

    /* Yardımcılar her pass'te kareye girmez. */
    this._hide(this.gizmo?.helper);
    this._hide(this.skeleton);
    (this.posing?.handles || []).forEach(handle => this._hide(handle));
    this._hide(this.lighting?.grid);

    if (!beauty) {
      this._hide(this.lighting?.floor);
      this._graphs().forEach(graph => {
        graph?.root?.traverse(obj => {
          if (obj.userData?.poseToonOutline) this._hide(obj);
        });
      });
      this.renderer.shadowMap.enabled = false;
      scene.overrideMaterial = this.materials[pass] || this.materials.normal;
    }

    /* Arka plan. */
    if (beauty) {
      if (settings.background === 'transparent') {
        scene.background = null;
        this.renderer.setClearAlpha(0);
      } else if (settings.background === 'white') {
        scene.background = new THREE.Color(0xffffff);
        this.renderer.setClearAlpha(1);
      }
    } else if (pass === 'alpha' && settings.matte) {
      scene.background = new THREE.Color(0xffffff);
      this.renderer.setClearAlpha(1);
    } else {
      scene.background = null;
      this.renderer.setClearAlpha(0);
    }

    /* Depth: kameranın yakın/uzak düzlemini öznenin derinlik aralığına daralt. */
    if (pass === 'depth') this._fitDepthRange(this.viewport.camera);
  }

  _fitDepthRange(camera) {
    /* Tüm görünür karakter köklerinin birleşik kutusu ölçülür. */
    const roots = this._graphs()
      .map(graph => graph?.root)
      .filter(Boolean);
    if (!roots.length) return;
    const box = new THREE.Box3();
    roots.forEach(root => box.expandByObject(root));
    if (box.isEmpty()) return;

    camera.updateMatrixWorld();
    const inverse = camera.matrixWorld.clone().invert();
    let min = Infinity;
    let max = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).applyMatrix4(inverse);
      const depth = -corner.z;
      if (depth < min) min = depth;
      if (depth > max) max = depth;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const pad = Math.max(0.01, (max - min) * 0.02);
    camera.near = Math.max(0.001, min - pad);
    camera.far = max + pad;
    camera.updateProjectionMatrix();
  }

  _flatten(width, height, { guides = false } = {}) {
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    if (guides) this._drawGuides(context, width, height);
    return canvas;
  }

  /* Kompozisyon kılavuzları DOM'da SVG; PNG'ye 2D tuval üzerinde çizilir. */
  _drawGuides(context, width, height) {
    const mode = this.guides?.mode || 'off';
    if (mode === 'off') return;

    const stroke = Math.max(1, Math.round(Math.min(width, height) / 800));
    const line = (x1, y1, x2, y2, strong = false) => {
      context.globalAlpha = strong ? 0.5 : 0.34;
      context.beginPath();
      context.moveTo(x1 * width, y1 * height);
      context.lineTo(x2 * width, y2 * height);
      context.stroke();
    };

    context.save();
    context.strokeStyle = '#ffffff';
    context.lineWidth = stroke;

    if (mode === 'thirds') {
      [100 / 3, 200 / 3].forEach(value => {
        line(value, 0, value, 100);
        line(0, value, 100, value);
      });
    } else if (mode === 'golden') {
      [38.2, 61.8].forEach(value => {
        line(value, 0, value, 100, true);
        line(0, value, 100, value, true);
      });
      line(0, 0, 38.2, 38.2);
      line(100, 0, 61.8, 38.2);
      line(0, 100, 38.2, 61.8);
      line(100, 100, 61.8, 61.8);
    } else if (mode === 'crosshair') {
      line(50, 0, 50, 100, true);
      line(0, 50, 100, 50, true);
      context.globalAlpha = 0.5;
      context.beginPath();
      context.arc(width / 2, height / 2, Math.min(width, height) * 0.06, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }

  _restore(saved, camera) {
    const renderer = this.renderer;
    const scene = this.viewport.scene;

    scene.overrideMaterial = saved.overrideMaterial;
    scene.background = saved.background;
    renderer.setClearAlpha(saved.clearAlpha);
    renderer.shadowMap.enabled = saved.shadowMap;
    renderer.autoClear = saved.autoClear;

    camera.aspect = saved.camera.aspect;
    camera.near = saved.camera.near;
    camera.far = saved.camera.far;
    if (camera.isOrthographicCamera) {
      camera.left = saved.camera.left;
      camera.right = saved.camera.right;
      camera.top = saved.camera.top;
      camera.bottom = saved.camera.bottom;
    }
    camera.updateProjectionMatrix();

    this._hidden.forEach(([object, visible]) => { if (object) object.visible = visible; });
    this._hidden = [];

    /* Önce küçük boyuta dön, sonra piksel oranını geri yükle: 8K karede
       ters sıra geçici olarak 15K×8K'lık tampon ayırıyordu. */
    renderer.setPixelRatio(1);
    renderer.setSize(saved.size.x, saved.size.y, false);
    renderer.setPixelRatio(saved.pixelRatio);
    if (this.pipeline) {
      this.pipeline.resize(saved.size.x, saved.size.y);
      if (saved.composerRatio != null) this.pipeline.composer.setPixelRatio(saved.composerRatio);
    }
    this.viewport.invalidate();
  }

  dispose() {
    Object.values(this.materials).forEach(material => material.dispose());
    this.materials = {};
    this._hidden = [];
    this.skeleton = null;
    this.busy = false;
  }
}
