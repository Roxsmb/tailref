import * as THREE from '../../vendor/three.module.js';
import { OutlineEffect } from '../../vendor/OutlineEffect.js';

/* Sahne ve renderer'ın tek sahibi. Diğer modüller renderer'ı ödünç alır. */
export class Viewport {
  constructor({ canvas, pixelRatio = 2 }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.65;

    this.outline = new OutlineEffect(this.renderer, {
      defaultThickness: 0.004,
      defaultColor: [0, 0, 0],
      defaultAlpha: 1,
      defaultKeepAlive: true,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.position.set(2.8, 1.7, 4.2);
    this.scene.add(this.camera);
    this.pipeline = null;

    this._frameHooks = new Set();
    /* Render SONRASI kancalar: otomatik kalite gözcüsü yalnız gerçekten
       çizilen kareleri saymalı; rAF poll'ları (boşta 140ms adımları)
       FPS'i düşük göstermesin. */
    this._renderHooks = new Set();
    /* Teşhis paneli (Ctrl+Alt+P): çizilen karelerin zaman damgaları
       (son 300 kare). Kare başına tek dizi push'u — ölçümün kendisi
       ölçülebilir yükün altında kalır. */
    this._renderTimes = [];
    this._raf = 0;
    this._idleTimer = 0;
    this._inStep = false;
    this._wantNextRaf = false;
    this._resizeHooks = new Set();
    this._cameraHooks = new Set();
    this._dirty = true;
    this._running = false;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas);
    this._onWindowResize = () => this.resize();
    window.addEventListener('resize', this._onWindowResize);
    this.resize();
  }

  /* Kare başına çalışacak güncelleme (controls, controller takibi…). */
  onFrame(fn) { this._frameHooks.add(fn); return () => this._frameHooks.delete(fn); }

  /** Çizilen her karenin hemen ardından çağrılır (boşta poll sayılmaz). */
  onRender(fn) { this._renderHooks.add(fn); return () => this._renderHooks.delete(fn); }

  onResize(fn) { this._resizeHooks.add(fn); return () => this._resizeHooks.delete(fn); }

  onCameraChange(fn) { this._cameraHooks.add(fn); return () => this._cameraHooks.delete(fn); }

  setCamera(camera) {
    if (this.camera === camera) return;
    this.camera = camera;
    if (!camera.parent) this.scene.add(camera);
    this._cameraHooks.forEach(fn => fn(camera));
    this.resize();
  }

  invalidate() {
    this._dirty = true;
    if (!this._running) return;
    if (this._inStep) this._wantNextRaf = true;   /* kare zarında: akış devam */
    else if (this._scheduleFrame) this._scheduleFrame();
  }

  start() {
    if (this._running) return;
    this._running = true;
    /* Talep-temelli döngü (kullanıcı 8 Kasım perf profili): dirty yoksa
       rAF zinciri kırılır, 140ms poll'e iner; invalidate() anında rAF'e
       döner. Sürükleme/tween/damping sürekli invalidate ürettiği için
       hareket sırasında 60fps akışın aynısıdır; boştayken CPU/GPU'u
       rahat bırakır (eski hâli: dirty fark etmeksizin sonsuz 60Hz). */
    const step = () => {
      this._raf = 0;
      this._inStep = true;
      this._wantNextRaf = false;
      this._frameHooks.forEach(fn => fn());
      this._inStep = false;
      if (this._dirty && !document.hidden) {
        this._dirty = false;
        this.renderFrame();
      }
      if (!this._running) return;
      if (this._wantNextRaf) {
        this._idleCheckClear();
        this._raf = requestAnimationFrame(step);
      } else {
        this._idleCheckClear();
        this._idleTimer = setTimeout(step, 140);
      }
    };
    this._idleCheckClear = () => {
      if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = 0; }
    };
    this._scheduleFrame = () => {
      this._idleCheckClear();
      if (!this._raf) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  stop() {
    this._running = false;
    this._idleCheckClear?.();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  renderFrame() {
    if (this.pipeline && this.pipeline.enabled) this.pipeline.render();
    else this.outline.render(this.scene, this.camera);
    const times = this._renderTimes;
    times.push(performance.now());
    if (times.length > 300) times.shift();
    this._renderHooks.forEach(fn => {
      try { fn(); } catch (error) { console.warn('render kancası hatası', error); }
    });
  }

  resize() {
    const width = this.canvas.clientWidth || 320;
    const height = this.canvas.clientHeight || 260;
    this.renderer.setSize(width, height, false);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this._resizeHooks.forEach(fn => fn(width, height));
    this.invalidate();
  }

  dispose() {
    this.stop();
    this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onWindowResize);
    this.renderer.dispose();
  }
}
