import { TransformControls } from '../../vendor/TransformControls.js';

/* three r169+ TransformControls sarmalayıcısı: Object3D değil, getHelper() döner. */
export class GizmoManager {
  constructor({ viewport, camera, onChange, onDragging }) {
    this.viewport = viewport;
    this.controls = new TransformControls(camera, viewport.canvas);
    this.helper = typeof this.controls.getHelper === 'function' ? this.controls.getHelper() : this.controls;
    this.helper.visible = false;
    viewport.scene.add(this.helper);
    this.mode = 'rotate';
    this.controls.setMode(this.mode);
    /* Rig kontrolcüleri kendi yerel eksenlerinde çalışır (Maya "local"
       davranışı). Global moda geçmek için setSpace('world'). */
    this.space = 'local';
    this.controls.setSpace(this.space);
    this.controls.setSize(0.35);
    this.controls.addEventListener('objectChange', () => onChange?.(this.controls.object));
    this.controls.addEventListener('dragging-changed', event => onDragging?.(event.value));
    this.controls.addEventListener('change', () => viewport.invalidate());
  }

  setMode(mode) {
    if (mode === 'hidden') { this.detach(); return; }
    this.mode = mode;
    this.controls.setMode(mode);
    this.helper.visible = !!this.controls.object;
    this.viewport.invalidate();
  }

  setSize(size) { this.controls.setSize(size); }

  /* 'local' → gizmo seçili kontrolcünün dünya rotasyonuyla döner; fare
     sürüklemesi o kontrolcünün X/Y/Z eksenlerine map'lenir. 'world' →
     sabit dünya eksenleri. TransformControls raycast'i local modda
     nesne uzayına çevirip eksen düzlemleriyle kestiği için ayrı bir
     fare→eksen dönüşümü gerekmez; gizmo çizimi ve sürükleme aynı
     matrisi kullanır. */
  setSpace(space) {
    this.space = space === 'world' ? 'world' : 'local';
    this.controls.setSpace(this.space);
    this.viewport.invalidate();
    return this.space;
  }

  setAxis(axis) { this.controls.axis = axis === 'all' ? null : axis; }

  attach(object) {
    this.controls.attach(object);
    this.helper.visible = true;
    this.viewport.invalidate();
  }

  detach() {
    this.controls.detach();
    this.helper.visible = false;
    this.viewport.invalidate();
  }

  get object() { return this.controls.object; }
  get dragging() { return this.controls.dragging; }

  dispose() {
    this.controls.dispose();
    this.viewport.scene.remove(this.helper);
  }
}
