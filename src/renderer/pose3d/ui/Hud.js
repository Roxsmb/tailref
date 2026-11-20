/* HUD durum makinesi: IDLE → MOVING → FADED, sunum modu ve chip metinleri. */
export class Hud {
  constructor({ panel, canvas }) {
    this.panel = panel;
    this.canvas = canvas;
    this.presentation = false;
    this.cameraLabel = document.querySelector('#poseCamChip');
    this.statusLabel = document.querySelector('#poseStatusChip');
    this._idleTimer = null;
    this._wakeTimer = null;
    this._statusTimer = null;
    this._abort = new AbortController();
    this.signal = this._abort.signal;
    this._statusBase = undefined;
    panel.dataset.nav = 'idle';
    panel.dataset.presentation = 'off';
    this.bind();
  }

  bind() {
    const canvas = this.canvas;
    const navigate = () => this.navigate();
    const signal = this.signal;

    canvas.addEventListener('pointerdown', navigate, { signal });
    canvas.addEventListener('wheel', navigate, { passive: true, signal });
    canvas.addEventListener('pointermove', event => {
      if (event.buttons) navigate();
      else if (this.panel.dataset.nav !== 'moving') this.wake();
    }, { signal });
    canvas.addEventListener('pointerup', () => this.scheduleIdle(), { signal });
    canvas.addEventListener('pointerleave', () => this.scheduleIdle(), { signal });
    canvas.addEventListener('pointerenter', () => this.scheduleIdle(), { signal });

    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.presentation) {
        this.setPresentation(false);
        event.stopPropagation();
      }
    }, { capture: true, signal });
  }

  navigate() {
    clearTimeout(this._idleTimer);
    clearTimeout(this._wakeTimer);
    this.panel.dataset.nav = 'moving';
  }

  scheduleIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this.panel.dataset.nav === 'moving') this.panel.dataset.nav = 'faded';
    }, 250);
  }

  wake() {
    clearTimeout(this._idleTimer);
    this.panel.dataset.nav = 'idle';
  }

  maybeWake() {
    // Geriye dönük yardımcı: HUD artık herhangi bir harekette uyanır.
    this.wake();
  }

  setPresentation(on) {
    this.presentation = !!on;
    this.panel.dataset.presentation = on ? 'on' : 'off';
    const button = document.querySelector('#btnPose3dPresentation');
    if (button) button.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) this.wake();
  }

  togglePresentation() {
    this.setPresentation(!this.presentation);
  }

  setCameraLabel(text) {
    if (this.cameraLabel) this.cameraLabel.textContent = text;
  }

  setStatus(text) {
    this._statusBase = text || '';
    clearTimeout(this._statusTimer);
    if (this.statusLabel) this.statusLabel.textContent = text || '';
  }

  /* Kısa bildirim: durum chip'inde gösterip temel metne döner. */
  flash(text, duration = 2400) {
    clearTimeout(this._statusTimer);
    if (this._statusBase === undefined) this._statusBase = this.statusLabel?.textContent || '';
    if (this.statusLabel) this.statusLabel.textContent = text || '';
    this._statusTimer = setTimeout(() => {
      if (this.statusLabel) this.statusLabel.textContent = this._statusBase || '';
    }, duration);
  }

  dispose() {
    clearTimeout(this._idleTimer);
    clearTimeout(this._wakeTimer);
    clearTimeout(this._statusTimer);
    this._abort?.abort();
    this._abort = null;
  }
}
