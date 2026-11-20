import * as THREE from '../../vendor/three.module.js';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { navMouseMap, normalizeNavPreset, POSE_NAV_STORAGE_KEY } from './NavPreset.js';

/* Kamera motoru: persp/ortho, lens, görünüm presetleri, F-odak. */
export class CameraManager {
  constructor({ viewport }) {
    this.viewport = viewport;
    this.persp = viewport.camera;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
    this.ortho.userData.orthoScale = 2.4;
    this.mode = 'perspective';

    this.controls = new OrbitControls(this.persp, viewport.canvas);
    this.orthoControls = new OrbitControls(this.ortho, viewport.canvas);
    this.orthoControls.enabled = false;
    this.orthoControls.target.copy(this.controls.target);

    [this.controls, this.orthoControls].forEach(controls => {
      controls.enableDamping = true;
      /* Kutuplarda lookAt belirsizleşiyor: tam +Y/−Y'ye kilitlenmek yerine
         küçük bir pay bırak. Böylece üst/alt görünümden çıkarken kamera
         ters dönmüyor. */
      controls.minPolarAngle = 0.02;
      controls.maxPolarAngle = Math.PI - 0.02;
      controls.addEventListener('change', () => viewport.invalidate());
    });

    /* enableDamping ve programatik kamera hareketleri için update() her karede
       çağrılmalı. Eksikken preset sonrası kamera yeni konuma taşınıyor ama
       eski yönüne bakmaya devam ediyordu; karakter ekran dışında kalıyor,
       tekerlek kaydırınca update() çalıştığı için geri geliyordu. */
    viewport.onFrame(() => this.activeControls.update());

    // Gezinme şeması: Maya (endüstri standardı) veya Blender.
    // Maya: Alt + sol orbit, Alt + orta pan, Alt + sağ dolly.
    // Blender: orta orbit, Shift + orta pan, Ctrl + orta dolly.
    // Tekerlek her iki şemada da zoom yapar.
    this._navPreset = this._readNavPreset();
    this._applyMouseButtons(null);
    viewport.canvas.addEventListener('contextmenu', event => event.preventDefault());
    /* Yakalama (capture) pencerede: OrbitControls kendi pointerdown dinleyicisini
       kurucuda bizden önce ekliyor. Tuval üzerindeki bir dinleyici hedef
       aşamasında kayıt sırasına göre çalışacağı için düğme eşlemesi bir basış
       gecikirdi; pencere yakalaması her durumda önce koşar. */
    this._onPointerDown = event => this._applyMouseButtons(event);
    window.addEventListener('pointerdown', this._onPointerDown, true);
    this._onPointerUp = () => this._applyMouseButtons(null);
    window.addEventListener('pointerup', this._onPointerUp);
    /* Ayar penceresinden şema değişince panel açıkken anında uygulanır. */
    this._onNavPresetChange = event => {
      const next = event && event.detail ? event.detail.preset : this._readNavPreset();
      this.setNavPreset(next);
    };
    window.addEventListener('tailref:pose3d-nav', this._onNavPresetChange);

    this._tween = null;
    viewport.onFrame(() => this._tick());
    /* Uzak düzlem aktif mesafeye uysun: uzun odak setLens(...) kamera
       görünüş doğrultusunda oransal geri kaydırır (400 mm ≈ 12× uzaklık);
       sabit far=100'ü geçince karakter uzak düzlemden parça parça
       siliniyordu (kullanıcı bildirimi, 12 Kasım). */
    viewport.onFrame(() => this._fitPlanes());
    viewport.onResize(() => this.syncFrustum());
    this.syncFrustum();
  }

  /* Uzak düzlem hedef mesafesine uysun. Sıkılık bozulmasın: yalnız değer
     gerçekten değişirse güncelle. Near dokunulmaz: SSAO/DoF kare içinde
     near/far eşliyor; near'ı oynatmak alfa/derinlik akışlarını sarsar
     (12 Kasım alfa regresyonu). Yakın plan z hassasiyeti 0.01 near ile
     kabul edilebilir (24-bit derinlik, karakter ~2 m). */
  _fitPlanes() {
    const target = this.controls.target;
    const dist = this.persp.position.distanceTo(target);
    if (!Number.isFinite(dist) || dist <= 0) return;
    const far = Math.min(4000, Math.max(100, dist * 4));
    if (Math.abs(far - this.persp.far) > 0.5) {
      this.persp.far = far;
      this.persp.updateProjectionMatrix();
      this.viewport.invalidate();
    }
  }

  get camera() { return this.mode === 'orthographic' ? this.ortho : this.persp; }
  get activeControls() { return this.mode === 'orthographic' ? this.orthoControls : this.controls; }
  get target() { return this.activeControls.target; }

  get lens() { return 12 / Math.tan((this.persp.fov * Math.PI) / 360); }
  get orthoScale() { return this.ortho.userData.orthoScale; }

  get navPreset() { return this._navPreset; }

  _readNavPreset() {
    try {
      return normalizeNavPreset(localStorage.getItem(POSE_NAV_STORAGE_KEY));
    } catch {
      return 'maya';
    }
  }

  /** Şemayı değiştirir; panel açıkken bir sonraki basıştan itibaren geçerli. */
  setNavPreset(preset) {
    this._navPreset = normalizeNavPreset(preset);
    this._applyMouseButtons(null);
  }

  _applyMouseButtons(event) {
    const map = navMouseMap(this._navPreset, {
      alt: !!(event && event.altKey),
      shift: !!(event && event.shiftKey),
      ctrl: !!(event && event.ctrlKey),
    });
    const toMouse = action => (action ? THREE.MOUSE[action] : null);
    [this.controls, this.orthoControls].forEach(controls => {
      controls.mouseButtons.LEFT = toMouse(map.LEFT);
      controls.mouseButtons.MIDDLE = toMouse(map.MIDDLE);
      controls.mouseButtons.RIGHT = toMouse(map.RIGHT);
    });
  }

  _tick() {
    if (!this._tween) return;
    const tween = this._tween;
    const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
    const e = 1 - Math.pow(1 - t, 3);
    this.camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    this.activeControls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    this.camera.up.lerpVectors(tween.fromUp, tween.toUp, e).normalize();
    this.viewport.invalidate();
    if (t >= 1) this._tween = null;
  }

  tweenTo(position, target, up = this.camera.up.clone(), duration = 220) {
    this._tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.activeControls.target.clone(),
      toTarget: target.clone(),
      fromUp: this.camera.up.clone(),
      toUp: up.clone(),
      start: performance.now(),
      duration,
    };
  }

  setTarget(x, y, z) {
    this.controls.target.set(x, y, z);
    this.orthoControls.target.set(x, y, z);
    this.viewport.invalidate();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const previous = this.camera;
    const target = this.activeControls.target.clone();
    const distance = Math.max(0.4, previous.position.distanceTo(target));
    const up = previous.up.clone();

    this.mode = mode;
    this.controls.enabled = mode === 'perspective';
    this.orthoControls.enabled = mode === 'orthographic';

    const next = this.camera;
    next.up.copy(up);
    next.position.copy(target).add(previous.position.clone().sub(target).normalize().multiplyScalar(distance));
    next.lookAt(target);
    this.activeControls.target.copy(target);
    if (mode === 'orthographic') {
      this.ortho.userData.orthoScale = Math.max(0.2, 2 * distance * Math.tan((this.persp.fov * Math.PI) / 360));
    } else {
      this.persp.fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.orthoScale / (2 * distance)));
    }
    this.viewport.setCamera(next);
    this.syncFrustum();
    this.activeControls.update();
    this.viewport.invalidate();
  }

  toggleMode() { this.setMode(this.mode === 'perspective' ? 'orthographic' : 'perspective'); }

  setLens(mm) {
    const focal = Math.min(400, Math.max(14, mm));
    /* Mercek değişince çerçeve sabit kalsın: 400 mm'de dar FOV konuyu
       büyütür ve kullanıcı elle geri gitmek zorunda kalır. Bunun yerine
       kamera görünüş doğrultusunda otomatik geri kayar: konunun ekrandaki
       boyu ∝ mesafe · tan(fov/2) olduğundan bu çarpımı koruyan mesafeye
       taşınır. Böylece mm sadece perspektif sıkılığını değiştirir;
       kadrajanmış gibi aynı kalır. 12 = sensör yarı yüksekliği (36×12). */
    const oldFovRad = (this.persp.fov * Math.PI) / 180;
    const newFovRad = 2 * Math.atan(12 / focal);
    const target = this.activeControls.target;
    const ray = this.persp.position.clone().sub(target);
    const distance = ray.length();
    if (distance > 0.25) {
      const ratio = Math.tan(oldFovRad / 2) / Math.tan(newFovRad / 2);
      const next = Math.min(80, Math.max(0.3, distance * ratio));
      ray.setLength(next);
      this.persp.position.copy(target).add(ray);
    }
    this.persp.fov = THREE.MathUtils.radToDeg(newFovRad);
    this.persp.updateProjectionMatrix();
    this.viewport.invalidate();
  }

  setOrthoScale(scale) {
    this.ortho.userData.orthoScale = Math.max(0.2, Math.min(20, scale));
    this.syncFrustum();
    this.viewport.invalidate();
  }

  syncFrustum() {
    const width = this.viewport.canvas.clientWidth || 320;
    const height = this.viewport.canvas.clientHeight || 260;
    const aspect = width / height;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();

    const halfHeight = this.ortho.userData.orthoScale / 2;
    const halfWidth = halfHeight * aspect;
    this.ortho.left = -halfWidth;
    this.ortho.right = halfWidth;
    this.ortho.top = halfHeight;
    this.ortho.bottom = -halfHeight;
    this.ortho.updateProjectionMatrix();
  }

  frame(box, { offset = 1.35 } = {}) {
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 0.5;
    const direction = this.camera.position.clone().sub(this.activeControls.target).normalize();
    const distance = radius / Math.tan((this.persp.fov * Math.PI) / 360) * offset;

    if (this.mode === 'orthographic') {
      this.ortho.userData.orthoScale = Math.max(0.2, radius * 2.4);
      this.syncFrustum();
    }
    const position = center.clone().add(direction.multiplyScalar(distance));
    this.tweenTo(position, center);
    this.viewport.invalidate();
  }

  frameAll(root) {
    if (!root) return;
    this.frame(new THREE.Box3().setFromObject(root));
  }

  preset(name) {
    const target = this.activeControls.target.clone();
    const distance = Math.max(0.5, this.camera.position.distanceTo(target));
    /* Kamera up vektörü sabit kalır (0,1,0). Üst/alt görünümde up'ı
       değiştirmek OrbitControls'ün iç quaternion'ını bozuyor, sonraki
       orbit sürüklemesi ters/karışık hissettiriyordu. Bunun yerine bakış
       yönüne çok küçük bir eğim veriyoruz: lookAt belirsizleşmez ve
       kamera yönü manyetik kuzeyi (+Z) korur. */
    const dirs = {
      front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0],
      top: [0, 1, 0.04], bottom: [0, -1, 0.04],
    };
    const direction = new THREE.Vector3(...(dirs[name] || dirs.front)).normalize();
    const position = target.clone().add(direction.multiplyScalar(distance));
    this.tweenTo(position, target);
    this.viewport.invalidate();
  }

  /* Görünüm presetinden sonra kameranın hedefe baktığını doğrular. */
  isFacingTarget(epsilon = 0.999) {
    const target = this.activeControls.target;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const wanted = target.clone().sub(this.camera.position).normalize();
    return direction.dot(wanted) >= epsilon;
  }

  dispose() {
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('tailref:pose3d-nav', this._onNavPresetChange);
    this.controls.dispose();
    this.orthoControls.dispose();
  }
}
