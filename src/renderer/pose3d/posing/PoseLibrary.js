/* Poz kütüphanesi: kaydet/yükle, JSON içe-dışa aktarma.
   Kalıcılık: mevcut uygulama veritabanı ('tailref' → 'meta'), anahtar 'pose-presets'.
   Tarayıcı bağımlılığı yalnızca IndexedDB katmanında; serileştirme saf fonksiyon. */

const DB_NAME = 'tailref';
const DB_VERSION = 1;
const STORE = 'meta';
const KEY = 'pose-presets';
const MAX_PRESETS = 20;
const IDENTITY = [0, 0, 0, 1];

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function vector(value, size, fallback) {
  return Array.from({ length: size }, (_, index) => {
    const number = Number(Array.isArray(value) ? value[index] : NaN);
    return Number.isFinite(number) ? number : fallback[index];
  });
}

/* Gelen kaydı güvenli, sabit biçime çevirir. Geçersizse null. */
export function normalizePose(pose) {
  if (!pose || typeof pose !== 'object' || !Array.isArray(pose.bones)) return null;
  const bones = pose.bones
    .filter(bone => bone && (Array.isArray(bone.p) || Array.isArray(bone.q)))
    .map(bone => {
      const q = vector(bone.q, 4, IDENTITY);
      const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      return {
        id: typeof bone.id === 'string' ? bone.id : '',
        name: typeof bone.name === 'string' ? bone.name : '',
        p: vector(bone.p, 3, [0, 0, 0]),
        q: q.map(value => value / length),
      };
    });
  if (!bones.length) return null;
  /* Çoklu karakter kaydı (9 Kasım): her karakterin kendi kemik dizisi
     karakter kimliğiyle saklanır. Eski tek-karakter kayıtları olduğu
     gibi okunmaya devam eder (characters alanı yoksa uygulanır). */
  let characters = null;
  if (pose.characters && typeof pose.characters === 'object') {
    characters = {};
    for (const [charId, sub] of Object.entries(pose.characters)) {
      if (!sub || !Array.isArray(sub.bones) || !sub.bones.length) continue;
      characters[charId] = {
        label: typeof sub.label === 'string' ? sub.label : '',
        rigSignature: typeof sub.rigSignature === 'string' ? sub.rigSignature : '',
        bones: sub.bones
          .filter(bone => bone && (Array.isArray(bone.p) || Array.isArray(bone.q)))
          .map(bone => {
            const q = vector(bone.q, 4, IDENTITY);
            const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
            return {
              id: typeof bone.id === 'string' ? bone.id : '',
              name: typeof bone.name === 'string' ? bone.name : '',
              p: vector(bone.p, 3, [0, 0, 0]),
              q: q.map(value => value / length),
            };
          }),
      };
      if (!characters[charId].bones.length) delete characters[charId];
    }
    if (!Object.keys(characters).length) characters = null;
  }
  return {
    id: typeof pose.id === 'string' && pose.id ? pose.id : newId(),
    name: String(pose.name || 'Pose').trim().slice(0, 60) || 'Pose',
    createdAt: Number.isFinite(pose.createdAt) ? pose.createdAt : Date.now(),
    rigSignature: typeof pose.rigSignature === 'string' ? pose.rigSignature : '',
    bones,
    ...(characters ? { characters } : {}),
  };
}

export class PoseLibrary {
  constructor({ limit = MAX_PRESETS } = {}) {
    this.limit = limit;
    this.items = [];
    this._db = null;
    this._opening = null;
  }

  /* --- IndexedDB --- */

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => { this._db = request.result; resolve(this._db); };
      request.onerror = () => reject(request.error);
    });
    return this._opening;
  }

  async _read() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async _write(items) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(items, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* --- CRUD --- */

  async load() {
    const raw = await this._read();
    const list = Array.isArray(raw) ? raw : [];
    this.items = list
      .map(normalizePose)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.limit);
    return this.items;
  }

  find(id) {
    return this.items.find(pose => pose.id === id) || null;
  }

  async save(pose) {
    const normalized = normalizePose(pose);
    if (!normalized) throw new Error('Invalid pose record');
    await this.load();
    this.items = [normalized, ...this.items.filter(item => item.id !== normalized.id)]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.limit);
    await this._write(this.items);
    return normalized;
  }

  async remove(id) {
    await this.load();
    this.items = this.items.filter(pose => pose.id !== id);
    await this._write(this.items);
    return this.items.length;
  }

  async clear() {
    this.items = [];
    await this._write([]);
  }

  /* --- JSON --- */

  async exportJSON() {
    const presets = await this.load();
    return JSON.stringify({
      app: 'tailref-studio',
      kind: 'pose-presets',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    }, null, 2);
  }

  /* Metni ayrıştırır, aynı isim+imza kayıtlarını günceller. Kütüphanedeki toplam sayıyı döner. */
  async importJSON(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { return (await this.load()).length; }
    const incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.presets) ? parsed.presets : []);
    const merged = await this.load();
    incoming.forEach(raw => {
      const pose = normalizePose(raw);
      if (!pose) return;
      const index = merged.findIndex(item =>
        item.id === pose.id || (item.name === pose.name && item.rigSignature === pose.rigSignature));
      if (index >= 0) merged[index] = { ...pose, id: merged[index].id };
      else merged.push(pose);
    });
    this.items = merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, this.limit);
    await this._write(this.items);
    return this.items.length;
  }

  dispose() {
    if (this._db) this._db.close();
    this._db = null;
    this._opening = null;
  }
}
