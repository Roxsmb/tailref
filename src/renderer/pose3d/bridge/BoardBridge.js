/* 3D yakalamalarını 2D tahtaya taşır.
   `pose-capture` olayı app.js (22-init.js) tarafından dinlenir; tahtaya
   ekleme bitince `pose-capture-done` ile geri bildirim verilir.
   `pose-screenshot` eski dinleyiciler için korunur. */

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export class BoardBridge {
  constructor({ prefix = 'tailref-pose', timeout = 15000 } = {}) {
    this.prefix = prefix;
    this.timeout = timeout;
    this.sent = 0;
    this.lastCount = 0;
    this._active = new Set();
  }

  fileName(result = {}) {
    return `${this.prefix}-${result.pass || 'beauty'}-${stamp()}.png`;
  }

  toFile(result = {}) {
    if (!result?.blob) return null;
    return new File([result.blob], result.name || this.fileName(result), { type: 'image/png' });
  }

  /* Tek görsel. */
  sendImage(blob, meta = {}) {
    return this.sendResults([{ ...meta, blob }]).then(ok => ok);
  }

  /* Sonuç dizisi → tek `pose-capture` olayı (çoklu pass tek seferde eklenir). */
  sendResults(results = []) {
    const files = results.map(result => this.toFile(result)).filter(Boolean);
    if (!files.length) return Promise.resolve(false);

    const token = `pose-capture-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const detail = {
      token,
      files,
      passes: results.map(result => ({
        pass: result.pass,
        width: result.width,
        height: result.height,
      })),
    };

    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        this._active.delete(finish);
        clearTimeout(timer);
        window.removeEventListener('pose-capture-done', onDone);
        resolve(ok);
      };
      const onDone = event => {
        if (event.detail?.token !== token) return;
        this.lastCount = Number(event.detail.count) || 0;
        if (event.detail.ok) this.sent += files.length;
        finish(!!event.detail.ok);
      };
      const timer = setTimeout(() => finish(false), this.timeout);
      this._active.add(finish);
      window.addEventListener('pose-capture-done', onDone);
      window.dispatchEvent(new CustomEvent('pose-capture', { detail }));
    });
  }

  /* Bekleyen tahtaya ekleme isteklerini iptal eder. */
  dispose() {
    [...this._active].forEach(finish => finish(false));
    this._active.clear();
    this.sent = 0;
    this.lastCount = 0;
  }
}
