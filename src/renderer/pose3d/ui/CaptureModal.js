import { BACKGROUNDS, describeSize, memoryWarning } from '../capture/CapturePresets.js';

/* Capture modalı: ölçek/pass/arka plan seçimi, önizleme ve hedef eylemleri.
   RenderExporter'ı sarar; tahtaya gönderim BoardBridge üzerinden yapılır. */

const MAX_PREVIEW_WIDTH = 1440;

export class CaptureModal {
  constructor({ panel, exporter, board, hud, guides }) {
    this.panel = panel;
    this.exporter = exporter;
    this.board = board;
    this.hud = hud;
    this.guides = guides;

    this.root = document.querySelector('#poseCapture');
    this.settings = {
      scale: 2,
      preset: null,
      background: 'scene',
      passes: ['beauty'],
      matte: false,
      guides: false,
    };
    this.previewUrl = null;
    this.previewPass = 'beauty';
    this._previewTimer = null;
    this._busy = false;
    this._abort = new AbortController();
    this.signal = this._abort.signal;
    this._onKeyDown = event => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    document.addEventListener('keydown', this._onKeyDown, { capture: true, signal: this.signal });
    this.bind();
    this.sync();
  }

  get isOpen() { return !!this.root && !this.root.hidden; }
  get busy() { return this._busy; }

  bind() {
    if (!this.root) return;
    const $ = selector => this.root.querySelector(selector);
    const opts = { signal: this.signal };

    $('#poseCaptureClose')?.addEventListener('click', () => this.close(), opts);

    [...this.root.querySelectorAll('[data-scale]')].forEach(button => {
      button.addEventListener('click', () => {
        this.settings.scale = Number(button.dataset.scale) || 1;
        this.settings.preset = null;
        this.changed();
      }, opts);
    });
    [...this.root.querySelectorAll('[data-preset]')].forEach(button => {
      button.addEventListener('click', () => {
        this.settings.preset = button.dataset.preset;
        this.changed();
      }, opts);
    });

    const background = $('#poseCaptureBg');
    if (background) {
      background.addEventListener('change', () => {
        this.settings.background = BACKGROUNDS.includes(background.value) ? background.value : 'scene';
        this.changed();
      }, opts);
    }

    [...this.root.querySelectorAll('[data-pass]')].forEach(button => {
      button.addEventListener('click', () => this.togglePass(button.dataset.pass), opts);
    });

    const matte = $('#poseCaptureMatte');
    if (matte) matte.addEventListener('change', () => { this.settings.matte = matte.checked; this.changed(); }, opts);

    const guides = $('#poseCaptureGuides');
    if (guides) guides.addEventListener('change', () => { this.settings.guides = guides.checked; this.changed(); }, opts);

    $('#poseCapturePreview')?.addEventListener('click', () => this.preview(), opts);
    $('#poseCaptureCopy')?.addEventListener('click', () => this.run('clipboard'), opts);
    $('#poseCaptureBoard')?.addEventListener('click', () => this.run('board'), opts);
    $('#poseCaptureSave')?.addEventListener('click', () => this.run('disk'), opts);
  }

  togglePass(pass) {
    if (!pass) return;
    const current = this.settings.passes;
    if (current.includes(pass)) {
      if (current.length === 1) return; /* en az bir pass kalmalı */
      this.settings.passes = current.filter(item => item !== pass);
    } else {
      this.settings.passes = this.orderPasses([...current, pass]);
    }
    this.changed();
  }

  /* Pass sırası her zaman sabit: beauty önce. */
  orderPasses(passes) {
    const order = ['beauty', 'alpha', 'depth', 'normal', 'wireframe'];
    return order.filter(pass => passes.includes(pass));
  }

  open() {
    if (!this.root) return false;
    this.panel.dataset.capture = 'open';
    this.root.hidden = false;
    this.sync();
    this.root.querySelector('#poseCaptureBoard')?.focus({ preventScroll: true });
    this._schedulePreview(180);
    return true;
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    delete this.panel.dataset.capture;
    /* Odak modal içinde kalırsa dock ipucu takılı kalıyor. */
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  changed() {
    this.sync();
    this._schedulePreview(420);
  }

  sync() {
    if (!this.root) return;
    const $ = selector => this.root.querySelector(selector);

    [...this.root.querySelectorAll('[data-scale]')].forEach(button => {
      const active = !this.settings.preset && Number(button.dataset.scale) === this.settings.scale;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    [...this.root.querySelectorAll('[data-preset]')].forEach(button => {
      const active = this.settings.preset === button.dataset.preset;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    [...this.root.querySelectorAll('[data-pass]')].forEach(button => {
      button.setAttribute('aria-pressed', this.settings.passes.includes(button.dataset.pass) ? 'true' : 'false');
    });

    const background = $('#poseCaptureBg');
    if (background) background.value = this.settings.background;
    const matte = $('#poseCaptureMatte');
    if (matte) matte.checked = this.settings.matte;
    const guides = $('#poseCaptureGuides');
    if (guides) guides.checked = this.settings.guides;

    const matteRow = $('#poseCaptureMatteRow');
    if (matteRow) matteRow.hidden = !this.settings.passes.includes('alpha');

    const size = this.exporter.resolve(this.settings);
    const info = $('#poseCaptureInfo');
    if (info) {
      info.textContent = describeSize(size) + (size.clamped ? __t(' · clamped to {limit}px', { limit: size.limit }) : '');
    }

    const warn = $('#poseCaptureWarn');
    const warning = memoryWarning(size);
    if (warn) {
      warn.hidden = !warning;
      warn.textContent = warning ? warning.text : '';
      warn.dataset.level = warning ? warning.level : '';
    }

    const disabled = this._busy;
    ['#poseCaptureCopy', '#poseCaptureBoard', '#poseCaptureSave', '#poseCapturePreview'].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = disabled;
    });
    this.root.setAttribute('aria-busy', disabled ? 'true' : 'false');
  }

  _schedulePreview(delay = 350) {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.preview(), delay);
  }

  /* Önizleme: hedef oranını korur, en fazla 1440 px genişlikte üretir. */
  async preview() {
    if (!this.root || !this.isOpen || this._busy) return null;
    const size = this.exporter.resolve(this.settings);
    const ratio = Math.min(1, MAX_PREVIEW_WIDTH / size.width);
    const pass = this.settings.passes[0] || 'beauty';
    this.previewPass = pass;
    const hint = this.root.querySelector('#poseCapturePreviewHint');
    if (hint) hint.textContent = __t('Preparing preview…');

    const result = await this.exporter.capture({
      pass,
      background: this.settings.background,
      matte: this.settings.matte,
      guides: false,
      scale: 1,
      width: Math.max(16, Math.round(size.width * ratio)),
      height: Math.max(16, Math.round(size.height * ratio)),
    });
    if (result) this._setPreview(result.blob);
    else if (hint) hint.textContent = __t('Preview failed');
    return result;
  }

  _setPreview(blob) {
    if (!this.root) return;
    const image = this.root.querySelector('#poseCapturePreviewImg');
    const hint = this.root.querySelector('#poseCapturePreviewHint');
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = blob ? URL.createObjectURL(blob) : null;
    if (image) {
      if (this.previewUrl) {
        image.src = this.previewUrl;
        image.hidden = false;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
      }
    }
    if (hint) hint.hidden = !!this.previewUrl;
  }

  /* Son ayarlarla hızlı yakalama: modal açılmadan tahtaya gönderir. */
  async quick() {
    return this.run('board', { quick: true });
  }

  async run(target = 'board', { quick = false } = {}) {
    if (this._busy) return { ok: false, busy: true };
    this._busy = true;
    this.sync();

    try {
      const passes = this.settings.passes.length ? [...this.settings.passes] : ['beauty'];
      const results = [];
      for (const pass of passes) {
        const result = await this.exporter.capture({
          ...this.settings,
          pass,
          guides: this.settings.guides && pass === 'beauty',
        });
        if (result) results.push(result);
      }

      if (!results.length) {
        this.hud?.flash(__t('Could not capture image'));
        return { ok: false, results };
      }

      if (!quick) this._setPreview((results.find(r => r.pass === 'beauty') || results[0]).blob);

      if (target === 'clipboard') {
        const primary = results.find(result => result.pass === 'beauty') || results[0];
        const ok = await this.exporter.copyToClipboard(primary);
        this.hud?.flash(ok
          ? __t('Copied to clipboard · {w}×{h}', { w: primary.width, h: primary.height })
          : __t('Could not copy to clipboard'));
        return { ok, results };
      }

      if (target === 'disk') {
        let saved = 0;
        let canceled = false;
        for (const result of results) {
          const response = await this.exporter.saveToDisk(result);
          if (response?.ok) saved++;
          if (response?.canceled) canceled = true;
        }
        this.hud?.flash(saved
          ? __t('{n} images saved', { n: saved })
          : (canceled ? __t('Save canceled') : __t('Could not save image')));
        return { ok: saved > 0, saved, canceled, results };
      }

      const ok = await this.board?.sendResults(results);
      this.hud?.flash(ok
        ? (results.length > 1 ? __t('{n} images added to board', { n: results.length }) : __t('Image added to board'))
        : __t('Could not add to board'));
      return { ok: !!ok, results };
    } catch (error) {
      console.error('Görüntü yakalama hatası', error);
      this.hud?.flash(__t('Capture failed'));
      return { ok: false, error };
    } finally {
      this._busy = false;
      this.sync();
    }
  }

  dispose() {
    clearTimeout(this._previewTimer);
    this._previewTimer = null;
    this._abort?.abort();
    this._abort = null;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    this._busy = false;
  }
}
