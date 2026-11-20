/* TailRef app · state, IndexedDB, snapshots */
'use strict';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tailref', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
      if (!d.objectStoreNames.contains('meta'))   d.createObjectStore('meta');
    };
    req.onsuccess = async () => {
      db = req.result;
      try { await migrateLegacyDb(); } catch { /* göç engellenmeye çalışılınca sessiz devam */ }
      resolve();
    };
    req.onerror   = () => reject(req.error);
  });
}

/* Tek seferlik veri göçü: önceki sürümlerin veritabanları → mevcut ad.
   Eski adlar koda çıplak yazılmaz; base64 tutulur (sırayla göç edilir). */
const LEGACY_DBS = [
  atob('cmVmYm9hcmQ='), /* eski marka-b dönemi DB adı */
  atob('cmVmZXZlcnI='), /* önceki marka dönemi DB adı */
];

function legacyStoreCount(oldDb, store) {
  return new Promise(res => {
    const c = oldDb.transaction(store).objectStore(store).count();
    c.onsuccess = () => res(c.result);
    c.onerror = () => res(0);
  });
}

function legacyKeyList(oldDb, store) {
  return new Promise(res => {
    try {
      const tx = oldDb.transaction(store, 'readonly');
      const r = tx.objectStore(store).getAllKeys();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    } catch { res([]); }
  });
}

/* Her kayıt kendi transaction'ında okunur: cursor'lı tek transaction'ta
   araya `await` girince IndexedDB transaction'ı auto-commit olur ve
   `continue()` TransactionInactiveError'a düşer (sessiz yarım göç). */
function legacyGetValue(oldDb, store, key) {
  return new Promise(res => {
    try {
      const tx = oldDb.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}

async function migrateLegacyDb() {
  /* Her eski DB adı sırayla denenir: kayıt varsa mevcut DB'ye aktarılır,
     sonra eski DB silinir. Kayıtsız/olmayan ad sessizce atlanır. */
  for (const LEGACY_DB of LEGACY_DBS) {
    await migrateOneLegacyDb(LEGACY_DB);
  }
}

function migrateOneLegacyDb(LEGACY_DB) {
  return new Promise((resolve) => {
    let upgraded = false;
    let req;
    try { req = indexedDB.open(LEGACY_DB, 1); } catch { resolve(); return; }
    req.onupgradeneeded = () => { upgraded = true; };
    req.onsuccess = async () => {
      const oldDb = req.result;
      try {
        /* eski adla boş bir DB açıldıysa (yoktu) kur düzgünce ve sil */
        if (upgraded) { oldDb.close(); indexedDB.deleteDatabase(LEGACY_DB); resolve(); return; }
        const stores = ['images', 'meta'].filter(s => oldDb.objectStoreNames.contains(s));
        if (!stores.length) { oldDb.close(); resolve(); return; }
        /* legacy hâlâ duruyor ve en az bir kayıttı varsa göç sürücülü:
           hedef kayıtlara ekleme yapılır (put, aynı anahtı aşar), tamamlanınca eski DB silinir. */
        let total = 0;
        for (const s of stores) total += await legacyStoreCount(oldDb, s);
        if (!total) { oldDb.close(); resolve(); return; }
        for (const s of stores) {
          const keys = await legacyKeyList(oldDb, s);
          for (const key of keys) {
            const val = await legacyGetValue(oldDb, s, key);
            if (val !== undefined) await idbPut(s, key, val);
          }
        }
        oldDb.close();
        indexedDB.deleteDatabase(LEGACY_DB);
        resolve();
      } catch { try { oldDb.close(); } catch { /* zaten kapalı */ } resolve(); }
    };
    req.onerror = () => { /* legacy yok — normal koşum */ resolve(); };
  });
}

/* idb* kapıları db açılmadan çağrılırsa (erken watcher consume'u ya da
   boot sırasında tetiklenen flushSave yarışı) açılışı bekler; db null
   iken transaction patlamaz. openDB ikinci kez çağrılırsa ikinci bağlantı
   zararsızdır (aynı sürüm, db global güncellenir). */
let idbOpenPromise = null;
function idbReady() {
  if (db) return Promise.resolve();
  if (!idbOpenPromise) idbOpenPromise = openDB();
  return idbOpenPromise;
}

async function idbPut(store, key, val) {
  await idbReady();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbGet(store, key) {
  await idbReady();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r  = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

async function idbDel(store, key) {
  await idbReady();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbEntries(store) {
  await idbReady();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const out = [];
    const r = os.openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (c) { out.push([c.key, c.value]); c.continue(); }
      else res(out);
    };
    r.onerror = () => rej(r.error);
  });
}

/* =========================================================
   yardımcılar
   ========================================================= */
const newId = (() => {
  let seq = 0;
  const ts = Date.now().toString(36);
  return () => {
    seq = (seq + 1) & 0xffffff;
    return ts + '-' + seq.toString(36).padStart(4, '0') + '-' + Math.random().toString(36).slice(2, 6);
  };
})();
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const getItem = id => state.items.find(i => i.id === id) || null;
const nextZ = () => state.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1;
const byZ = (a, b) => (a.z || 0) - (b.z || 0);

function hasFiniteView(view) {
  return !!(view &&
    Number.isFinite(view.x) &&
    Number.isFinite(view.y) &&
    Number.isFinite(view.scale));
}

function createStateSnapshot() {
  // Çizim modundaki mini tahta, referans görünümünü geçici olarak değiştirir.
  // Kayda her zaman referans modundaki görünüm yazılır; böylece uygulama
  // çizim sırasında kapanıp açılsa bile tahta eski yerine döner.
  let view = state.view;
  try {
    if (document.body.classList.contains('ps-ref-live') &&
        typeof dpProto !== 'undefined' && dpProto && dpProto.refView) {
      view = dpProto.refView;
    }
  } catch { /* sessiz */ }
  /* A3 (maske idle-encode): ertelenmiş maske Kodlaması varsa snapshot'a
     girmeden önce senkron tamamla. Maske vuruşu mask.src'te yaşadığından
     kayıt/undo doğruluğu bu flush'e bağlıdır; pending yoksa maliyetsiz. */
  if (typeof inkMaskFlushPending === 'function') inkMaskFlushPending();
  return {
    items: state.items,
    view,
    bg: state.bg,
    groupTitles: state.groupTitles,
    groupImportant: state.groupImportant,
    groupParents: state.groupParents,
    links: state.links,
    trash: state.trash,
    // Çizim katmanları/vuruşları da panonun parçasıdır. Tuvaller türetilmiş
    // önbellek olduğu için yalnızca vektör veri saklanır.
    ink: state.ink,
  };
}

function restoreSnapshot(snapshot) {
  /* A3 devamı (undo mask-src dedupe): yığından gelen snapshot'ta maske
     src'si token'a (srcRef) sıkıştırılır; uygulanmadan önce yan-tablodan
     gerçek string'e döner ve yığın referansı bırakılır. Diskten gelen
     snapshot'ta srcRef yoktur → no-op. */
  if (snapshot && snapshot.ink && Array.isArray(snapshot.ink.layers)) {
    maskSnapRehydrateParsed(snapshot); /* iade: yığın silme referansı */
  }
  state.items = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
  state.view = hasFiniteView(snapshot && snapshot.view)
    ? snapshot.view
    : { x: 0, y: 0, scale: 1 };
  state.bg = snapshot && typeof snapshot.bg === 'number' ? snapshot.bg : 1;
  state.groupTitles = snapshot && snapshot.groupTitles && typeof snapshot.groupTitles === 'object' ? snapshot.groupTitles : {};
  state.groupImportant = snapshot && snapshot.groupImportant && typeof snapshot.groupImportant === 'object' ? snapshot.groupImportant : {};
  state.groupParents = snapshot && snapshot.groupParents && typeof snapshot.groupParents === 'object' ? snapshot.groupParents : {};
  state.links = Array.isArray(snapshot && snapshot.links) ? snapshot.links : [];
  state.trash = normalizeTrash(snapshot && snapshot.trash);
  state.ink = typeof inkNormalizeState === 'function'
    ? inkNormalizeState(snapshot && snapshot.ink)
    : (snapshot && snapshot.ink) || null;
}

async function mapInBatches(items, limit, worker) {
  const out = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/* =========================================================
   A3 devamı — undo/redo Snapshot maske src dedupe
   ---------------------------------------------------------
   pushUndo tam doküman JSON'ı üretir; maske src (PNG dataURL, 4K'da
   ~1.4 MB) HER snapshot'a birebir gömülür → 60 derinlik undoStack'te
   ~80 MB kopya + 33-45 ms stringify. Burada src'yi yalnız YANI
   TABLODA bir kez tutup snapshot'a kısa token (srcRef) yazarız.
   - referans sayacı yığın üyeliği başına +1 (JSON.replacer anında),
   - snapshot uygulaması (restoreSnapshot) token'ı gerçek string'e
     geri çözer ve sayaçyı ısıtır (yığın üyeliği bitti),
   - diskten gelen kayıtlar tokenize edilmez (save hattı bypass);
     JSON'da srcRef gören hiçbir fizyoloji (normalize) mask kaybetmez:
     rehydrate uygulanmadan önce çalışır.
   ========================================================= */
const maskSnap = { of: new Map(), to: new Map(), refs: new Map(), seq: 0 };
/* Bu eşiğin altındaki src'leri tokenleştirmemeye değer (kışa uğraş). */
const MASK_SNAP_MIN_LEN = 8192;

function maskSnapReplacer(key, value) {
  if (key !== 'mask' || !value || typeof value !== 'object' ||
      typeof value.src !== 'string' || value.src.length < MASK_SNAP_MIN_LEN) {
    return value;
  }
  let tok = maskSnap.of.get(value.src);
  if (!tok) {
    tok = 'M' + (++maskSnap.seq);
    maskSnap.of.set(value.src, tok);
    maskSnap.to.set(tok, value.src);
  }
  maskSnap.refs.set(tok, (maskSnap.refs.get(tok) || 0) + 1);
  return { srcRef: tok, w: value.w, h: value.h };
}

function maskSnapStringify(snap) {
  return JSON.stringify(snap, maskSnapReplacer);
}

function maskSnapReleaseRef(tok) {
  const n = (maskSnap.refs.get(tok) || 0) - 1;
  if (n <= 0) {
    const src = maskSnap.to.get(tok);
    maskSnap.to.delete(tok);
    if (src) maskSnap.of.delete(src);
    maskSnap.refs.delete(tok);
  } else {
    maskSnap.refs.set(tok, n);
  }
}

/** Snapshot uygulamasından ÖNCE srcRef'leri gerçek string'e döndürür ve
 *  yığın referansını bırakır (mutasyon yalnızca parse edilmiş kopyada). */
function maskSnapRehydrateParsed(parsed) {
  const layers = parsed && parsed.ink && parsed.ink.layers;
  if (!Array.isArray(layers)) return;
  for (const l of layers) {
    const m = l && l.mask;
    if (!m || !m.srcRef) continue;
    const src = maskSnap.to.get(m.srcRef);
    if (src) {
      l.mask = { src, w: m.w, h: m.h };
      maskSnapReleaseRef(m.srcRef);
    } else {
      /* yan-tablo için çoktan kırıldı (sayfalama endişesi) — maskenin
         katkısı yok olmasın diye sessiz mask kaldır. */
      l.mask = null;
    }
  }
}

/** Yığından DÜŞEN ham snapshot string'indeki token referanslarını release eder. */
function maskSnapReleaseRaw(raw) {
  if (typeof raw !== 'string' || raw.indexOf('"srcRef"') < 0) return;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!parsed || !parsed.ink || !Array.isArray(parsed.ink.layers)) return;
  for (const l of parsed.ink.layers) {
    const m = l && l.mask;
    if (m && m.srcRef) maskSnapReleaseRef(m.srcRef);
  }
}

/** Yığın komple boşalırken (redo temizleme) tüm referansları bırak. */
function maskSnapReleaseStack(stack) {
  if (!Array.isArray(stack)) return;
  for (const raw of stack) maskSnapReleaseRaw(raw);
}
