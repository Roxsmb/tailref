'use strict';
/* ======================================================================
   backup-health.js — yedek sağlık denetimi (ana süreç)
   ======================================================================
   Bir yedeğin "geri dönülebilir" sayılması için içeriğine bakmak gerekir:
   kaç öğe, kaç görsel, dosya makul boyutta mı? Bu iş JSON.parse ister ve
   200 MB'a kadar dosyalarda ana süreçte SENKRON parse, kurtarma kutusu
   açılırken uygulamayı saniyelerce donduruyordu (P1).

   Çözüm: parse işi worker_threads'e taşınır. Worker `eval` ile bu modülün
   içinden üretilir (ayrı dosya/asar yolu sorunu yok); sayaç fonksiyonu tek
   kaynaktan gelir. Worker kurulamazsa aynı işlem içinde okunur (eski
   davranışa güvenli düşüş); parse takılırsa istek zaman aşımına düşer ve
   yedek "sağlıksız" işaretlenir — asla sonsuz bekleme yok.
   ====================================================================== */

const fsDefault = require('fs');
const pathDefault = require('path');
const { Worker: NodeWorker } = require('worker_threads');

const DEFAULTS = {
  maxBytes: 200 * 1024 * 1024,
  maxItems: 1500,
  maxImages: 300,
  /* Tek dosya parse'ı için üst sınır. 200 MB JSON yavaş diskte bile bunun
     altında kalır; takılan worker sonsuza kadar kuyruk tıkamaz. */
  timeoutMs: 15000,
};

/** Yedek içeriğindeki öğe/görsel sayısı. Worker kaynağına string olarak
    gömülür; dış kapsama referans vermemelidir. */
function countBackupContent(parsed) {
  const images = Array.isArray(parsed.images) ? parsed.images.length : 0;
  let workspaceItems = 0;
  const workspace = parsed.workspace;
  if (workspace && Array.isArray(workspace.projects)) {
    for (const record of workspace.projects) {
      const snapshot = record && (record.state || record.snapshot);
      if (snapshot && Array.isArray(snapshot.items)) workspaceItems += snapshot.items.length;
    }
  }
  const legacyItems = parsed.state && Array.isArray(parsed.state.items)
    ? parsed.state.items.length : 0;
  /* İki yol aynı panoyu temsil edebilir: toplamak çift sayar. Yalnız birini
     okumak ise boş bir `workspace.projects` dizisiyle sınırın atlanmasına izin
     verir. Sağlık kapısı için güvenli olan büyük değerdir. */
  return { items: Math.max(workspaceItems, legacyItems), images };
}

const WORKER_SOURCE = `
'use strict';
const fs = require('fs');
const { parentPort } = require('worker_threads');
const countBackupContent = ${countBackupContent.toString()};
parentPort.on('message', msg => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'close') { try { parentPort.close(); } catch { /* sessiz */ } return; }
  let reply;
  try {
    const parsed = JSON.parse(fs.readFileSync(msg.file, 'utf8'));
    reply = { id: msg.id, kind: 'ok', counts: countBackupContent(parsed) };
  } catch (error) {
    reply = { id: msg.id, kind: 'error', code: String(error && error.code || 'parse') };
  }
  try { parentPort.postMessage(reply); } catch { /* kapanmış olabilir */ }
});
`;

class BackupInspector {
  constructor(options = {}) {
    const fs = options.fs || fsDefault;
    const path = options.path || pathDefault;
    this.fs = fs;
    this.path = path;
    this.WorkerImpl = options.Worker || NodeWorker;
    this.maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULTS.maxBytes;
    this.maxItems = Number.isFinite(options.maxItems) ? options.maxItems : DEFAULTS.maxItems;
    this.maxImages = Number.isFinite(options.maxImages) ? options.maxImages : DEFAULTS.maxImages;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULTS.timeoutMs;
    this.useWorker = options.useWorker !== false;
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.disposed = false;
  }

  _ensureWorker() {
    if (!this.useWorker || this.disposed) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new this.WorkerImpl(WORKER_SOURCE, {
        eval: true,
        filename: this.path.join(__dirname, 'backup-health.js'),
      });
      if (typeof worker.unref === 'function') worker.unref();
      worker.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        const req = this.pending.get(msg.id);
        if (!req) return;
        this.pending.delete(msg.id);
        clearTimeout(req.timer);
        req.resolve(msg);
      });
      worker.on('error', (error) => this._dropWorker(error));
      worker.on('exit', () => this._dropWorker(new Error('worker-exit')));
      this.worker = worker;
      return worker;
    } catch {
      /* Worker yok/açılamıyor: işlem içi yola düş. */
      this.useWorker = false;
      return null;
    }
  }

  _dropWorker(error) {
    const worker = this.worker;
    this.worker = null;
    for (const [id, req] of this.pending) {
      this.pending.delete(id);
      clearTimeout(req.timer);
      req.resolve({ id, kind: 'error', code: 'worker', error: String(error && error.message || error) });
    }
    try { if (worker) worker.terminate(); } catch { /* sessiz */ }
  }

  _askWorker(file) {
    const worker = this._ensureWorker();
    if (!worker) return null;
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        /* Takılan worker'ı bırak: sonraki istek arkasında kuyruğa girmesin. */
        this._dropWorker(new Error('worker-timeout'));
        resolve({ id, kind: 'timeout' });
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, timer });
      try {
        worker.postMessage({ id, file });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve({ id, kind: 'error', code: 'post', error: String(error && error.message || error) });
      }
    });
  }

  /** Aynı işlemde oku (worker yoksa). Yalnız güvenli düşüş yoludur. */
  _readInProcess(file) {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(file, 'utf8'));
      return { kind: 'ok', counts: countBackupContent(parsed) };
    } catch (error) {
      return { kind: 'error', code: String(error && error.code || 'parse') };
    }
  }

  /**
   * @param {string} file tam yol
   * @param {{size?:number}} [entry] bilinen boyut (stat tekrar edilmesin)
   * @returns {Promise<{ok:boolean,items:number,images:number,reason:string}>}
   */
  async inspect(file, entry = {}) {
    const info = { ok: false, items: 0, images: 0, reason: '' };
    let size = Number(entry.size);
    if (!Number.isFinite(size)) {
      try { size = this.fs.statSync(file).size; } catch { info.reason = 'missing'; return info; }
    }
    if (size > this.maxBytes) { info.reason = 'too-large'; return info; }
    let result = await this._askWorker(file);
    if (!result) result = this._readInProcess(file);
    if (!result || result.kind === 'timeout') { info.reason = 'timeout'; return info; }
    if (result.kind === 'error') { info.reason = 'corrupt'; return info; }
    const counts = result.counts || { items: 0, images: 0 };
    info.items = counts.items;
    info.images = counts.images;
    if (counts.items > this.maxItems) info.reason = 'too-many-items';
    else if (counts.images > this.maxImages) info.reason = 'too-many-images';
    else info.ok = true;
    return info;
  }

  dispose() {
    this.disposed = true;
    this._dropWorker(new Error('disposed'));
  }
}

module.exports = {
  BackupInspector,
  countBackupContent,
  DEFAULTS,
  WORKER_SOURCE,
};
