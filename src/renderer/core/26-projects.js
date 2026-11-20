/* TailRef app · ProjectState + TailRefWorkspaceManager
   Her pano kendi tahtasını, seçimini, geri alma geçmişini, kamera
   transformunu ve 3D poz verisini izole tutar. Üstteki sekme şeridi
   panolar arasında geçiş yapar; kapanan pano hem bellekten hem de
   IndexedDB'den güvenle silinir. */
'use strict';

const PROJECT_INDEX_KEY = 'workspace';
const PROJECT_RECORD_PREFIX = 'project:';
const PROJECT_SCHEMA_VERSION = 1;
/* Manuel modda açılan .tail/yedek yalnızca bu oturum için yüklenir. Bayrak
   sayfa yenilenince bir kez okunur; uygulama kapanınca oturumla birlikte
   silinir. Böylece kaydetmeden çıkınca bir sonraki açılış boş olur. */
const MANUAL_OPEN_ONCE_KEY = 'tailref-manual-open-once';
/* Aynı oturumda açıkça bir .tail/yedek dosyası açıldı mı? "Açılışta temiz
   başla" ayarı kapalı olsa bile, kullanıcının az önce açtığı dosya yeniden
   yüklemede arşivlenip silinmemeli. Oturumla birlikte sona erer. */
const OPENED_FILE_ONCE_KEY = 'tailref-opened-file-once';
/* Aynı anda açılabilecek en fazla pano sayısı. Her pano ayrı tahta, ayrı
   geri alma yığını ve ayrı görsel kümesi tuttuğu için üst sınır var. */
const MAX_PROJECTS = 10;

function cloneJSON(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function emptyBoardSnapshot() {
  return {
    items: [],
    view: { x: 0, y: 0, scale: 1 },
    // Yeni pano tam opak arka planla açılır (%100).
    bg: 1,
    groupTitles: {},
    groupImportant: {},
    groupParents: {},
    links: [],
    trash: [],
    ink: null,
  };
}

/** Manuel mod seçilince açılışta auto modun yüklediği panoları temizler.
    Boş "Pano 1" ile sıfırdan başlatır; kaydedilmemiş veri geri gelmez. */
function resetToEmptyBoard() {
  if (!workspaceManager || !workspaceManager.ready) return;
  workspaceManager._enqueue(async () => {
    const ids = workspaceManager.order.slice();
    for (const id of ids) {
      workspaceManager.projects.delete(id);
    }
    workspaceManager.order.length = 0;
    const fresh = new ProjectState({
      name: 'Board 1',
      snapshot: emptyBoardSnapshot(),
      fresh: true,
    });
    workspaceManager.projects.set(fresh.id, fresh);
    workspaceManager.order.push(fresh.id);
    workspaceManager.activeId = fresh.id;
    await workspaceManager.activate(fresh.id, { initial: true });
    workspaceManager._renderTabs();
  });
}

/* =========================================================
   3D köprüsü · kamera transformu ve rig pozu
   ========================================================= */

/** Kısa, kendiliğinden kaybolan bildirim (pano sınırı vb.). */
let projectNoticeEl = null;
let projectNoticeTimer = null;
function showProjectNotice(text, ms = 3200) {
  if (!text) return;
  if (!projectNoticeEl) {
    projectNoticeEl = document.createElement('div');
    projectNoticeEl.id = 'projectNotice';
    projectNoticeEl.setAttribute('role', 'status');
    projectNoticeEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(projectNoticeEl);
  }
  projectNoticeEl.textContent = text;
  projectNoticeEl.classList.add('is-visible');
  clearTimeout(projectNoticeTimer);
  projectNoticeTimer = setTimeout(() => {
    projectNoticeEl.classList.remove('is-visible');
  }, ms);
}

/* Global toast kanalı — Ayarlar'daki bildirimler (4b.8 bulgusu: toast()
   hiçbir yerde tanımlı değildi, typeof guard'ları mesajları sessizce
   atlıyordu; eylemler çalışıyordu). Var olan showProjectNotice kanalını
   yeniden kullanır; ileti gösterim anında geçerli dile çözülür
   (bilinmeyen/dinamik anahtarlar aynen geçer — canvas-editor.toast ile
   aynı kural). Sözlükte olmayan anahtar __t'ten İngilizce döner. */
window.toast = function toast(message, ms) {
  if (typeof message !== 'string' || !message) return;
  try { showProjectNotice(__t(message), typeof ms === 'number' ? ms : 3200); }
  catch { try { showProjectNotice(message, typeof ms === 'number' ? ms : 3200); } catch { /* sessiz */ } }
};

/* Çok büyük tahtalarda (yanlışlıkla binlerce öğe) arayüz kilitlenmeden önce
   bir kez uyar: kullanıcı Ayarlar → "Son kayda dön" ile temiz yedeğe dönebilir. */
const OVERLOAD_ITEM_WARN = 3000;
/* Ana süreçteki sağlık eşiğiyle aynı: bu sayının üstündeki tahta "bozuk"
   sayılır ve bir sonraki sağlıklı yedek denenir. */
const OVERLOAD_SAFE_ITEMS = 1500;
let overloadWarnedAt = 0;
function maybeWarnOverload() {
  if (!Array.isArray(state.items) || state.items.length < OVERLOAD_ITEM_WARN) return;
  const now = Date.now();
  if (now - overloadWarnedAt < 60000) return;
  overloadWarnedAt = now;
  showProjectNotice(
    `This board has ${state.items.length} items and the app may slow down. ` +
    'If needed, you can return to the previous clean backup via Settings → "Revert to last save".',
    9000
  );
}

/* =========================================================
   Yeni pano adı sorma kutusu
   ---------------------------------------------------------
   `+` veya Ctrl+Shift+N'ye basınca açılır. Ad yazıp Enter'a
   basılır; boş bırakılırsa önerilen "Pano N" kullanılır.
   Esc / dışına tıklama → iptal (pano açılmaz).
   ========================================================= */

let namingOpen = false;

function promptProjectName(suggested, anchor) {
  return new Promise(resolve => {
    const popover = document.getElementById('projectNamePopover');
    const input = document.getElementById('projectNameInput');
    const okBtn = document.getElementById('projectNameOk');
    const cancelBtn = document.getElementById('projectNameCancel');
    if (!popover || !input || namingOpen) {
      resolve(suggested || null);
      return;
    }
    namingOpen = true;

    const finish = value => {
      if (!namingOpen) return;
      namingOpen = false;
      popover.hidden = true;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const accept = () => {
      const value = String(input.value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
      finish(value || suggested || '');
    };
    const onOutside = event => {
      if (popover.contains(event.target)) return;
      finish(null);
    };
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        accept();
      }
    };

    input.value = suggested || '';
    input.placeholder = suggested || 'Board name';
    popover.hidden = false;

    // Çapanın (+ düğmesi) altına yerleştir; ekran dışına taşırma.
    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const width = popover.offsetWidth || 236;
    const height = popover.offsetHeight || 108;
    const margin = 8;
    let left = rect ? rect.right - width : (window.innerWidth - width) / 2;
    let top = rect ? rect.bottom + 8 : 76;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, (rect ? rect.top : 120) - height - 8);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;

    okBtn.onclick = accept;
    cancelBtn.onclick = () => finish(null);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => {
      try { input.focus(); input.select(); } catch { /* sessiz */ }
    }, 0);
  });
}

/* =========================================================
   Kurtarma yardımcıları (ana süreçle ortak)
   ========================================================= */
/** Diskteki pano kayıtlarının görselsiz kopyasını üretir.
    Geri yükleme/sıfırlama öncesi emniyet kopyası ve arşiv için kullanılır.
    Blob'lara dokunmaz: 5670 görselde bile hızlı kalır. */
async function captureStoredBoards() {
  try {
    const index = await idbGet('meta', PROJECT_INDEX_KEY);
    const projects = [];
    if (index && Array.isArray(index.projects)) {
      for (const meta of index.projects) {
        if (!meta || !meta.id) continue;
        const record = await idbGet('meta', PROJECT_RECORD_PREFIX + meta.id);
        if (record) projects.push(record);
      }
    }
    const legacyRaw = await idbGet('meta', 'state');
    let legacy = null;
    try { legacy = legacyRaw ? JSON.parse(legacyRaw) : null; } catch { legacy = null; }
    if (!projects.length && !legacy) return null;
    return {
      version: 2,
      kind: 'emergency',
      createdAt: new Date().toISOString(),
      state: legacy,
      workspace: projects.length
        ? { schema: PROJECT_SCHEMA_VERSION, activeId: index.activeId, projects }
        : null,
      images: [],
    };
  } catch (error) {
    console.warn('board records could not be read', error);
    return null;
  }
}

/** Geri yükleme öncesi mevcut durumu yedekler (yanlış yedeğe karşı emniyet).
    `includeLive`: manuel modda olduğu gibi, henüz diske yazılmamış canlı
    tahtayı da kopyaya kat (görseller IDB'de kaldığı için hızlıdır). */
async function saveEmergencyCopy(includeLive = false) {
  const api = window.tailref;
  if (!api || !api.saveEmergency) return null;
  let payload = null;
  if (includeLive && workspaceManager && workspaceManager.ready) {
    if (workspaceManager.activeProject) workspaceManager.activeProject.capture();
    payload = {
      version: 2,
      kind: 'emergency',
      createdAt: new Date().toISOString(),
      state: createStateSnapshot(),
      workspace: workspaceManager.serializeWorkspace(),
      images: [],
    };
  }
  if (!payload) payload = await captureStoredBoards();
  if (!payload) return null;
  try {
    const result = await api.saveEmergency(JSON.stringify(payload));
    return result && result.ok ? result.file : null;
  } catch {
    return null;
  }
}

/** "Temiz başlat": panoları arşive yazıp IndexedDB'yi boşaltır.
    Görseller de silinir; arşivde panoların (öğe) kaydı kalır. */
async function archiveAndWipeBoards() {
  const api = window.tailref;
  let archivePath = '';
  const payload = await captureStoredBoards();
  if (payload && api && api.saveArchive) {
    try {
      const result = await api.saveArchive(JSON.stringify(payload));
      if (result && result.ok) archivePath = result.path;
    } catch { /* arşiv yazılamazsa yine de sıfırla */ }
  }
  /* YALNIZCA pano kayıtları silinir: 'state' (eski tek tahta), pano
     indeksi ve 'project:*' kayıtları. Önceden TÜM meta anahtarları
     siliniyordu; bu, arşive de girmeyen özel fırça kütüphanesini
     (ink:brushes), FX presetlerini ve native fırça önizlemelerini
     kalıcı olarak yok ediyordu. Görseller pano verisidir, silinir. */
  const isBoardMetaKey = key => {
    const k = String(key);
    return k === 'state' || k === PROJECT_INDEX_KEY || k.startsWith(PROJECT_RECORD_PREFIX);
  };
  for (const [key] of await idbEntries('meta')) {
    if (!isBoardMetaKey(key)) continue;
    await idbDel('meta', key);
  }
  for (const [key] of await idbEntries('images')) {
    await idbDel('images', key);
  }
  return archivePath;
}

/** Aktif 3D görünümünü serileştirilebilir bir nesneye çevirir. */
function captureCameraTransform() {
  const dbg = window.__pose3dDebug;
  if (!dbg || !dbg.cameraManager) return null;
  const cm = dbg.cameraManager;
  const persp = cm.persp;
  const ortho = cm.ortho;
  if (!persp || !ortho) return null;
  return {
    mode: cm.mode === 'orthographic' ? 'orthographic' : 'perspective',
    target: (cm.activeControls && cm.activeControls.target)
      ? cm.activeControls.target.toArray()
      : (cm.controls && cm.controls.target ? cm.controls.target.toArray() : [0, 0, 0]),
    persp: {
      position: persp.position.toArray(),
      up: persp.up.toArray(),
      fov: persp.fov,
      near: persp.near,
      far: persp.far,
    },
    ortho: {
      position: ortho.position.toArray(),
      up: ortho.up.toArray(),
      scale: ortho.userData ? ortho.userData.orthoScale : 2.4,
      zoom: ortho.zoom,
      near: ortho.near,
      far: ortho.far,
    },
  };
}

/** Kayıtlı kamera transformunu 3D görünümüne uygular. */
function applyCameraTransform(transform) {
  if (!transform) return false;
  const dbg = window.__pose3dDebug;
  if (!dbg || !dbg.cameraManager) return false;
  const cm = dbg.cameraManager;
  try {
    const mode = transform.mode;
    if ((mode === 'perspective' || mode === 'orthographic') && cm.mode !== mode) {
      cm.setMode(mode);
    }
    const persp = transform.persp;
    if (persp) {
      if (Array.isArray(persp.position)) cm.persp.position.fromArray(persp.position);
      if (Array.isArray(persp.up)) cm.persp.up.fromArray(persp.up);
      if (Number.isFinite(persp.fov)) cm.persp.fov = persp.fov;
      if (Number.isFinite(persp.near)) cm.persp.near = persp.near;
      if (Number.isFinite(persp.far)) cm.persp.far = persp.far;
      cm.persp.updateProjectionMatrix();
    }
    const ortho = transform.ortho;
    if (ortho) {
      if (Array.isArray(ortho.position)) cm.ortho.position.fromArray(ortho.position);
      if (Array.isArray(ortho.up)) cm.ortho.up.fromArray(ortho.up);
      if (Number.isFinite(ortho.scale)) cm.ortho.userData.orthoScale = ortho.scale;
      if (Number.isFinite(ortho.zoom)) cm.ortho.zoom = ortho.zoom;
      if (Number.isFinite(ortho.near)) cm.ortho.near = ortho.near;
      if (Number.isFinite(ortho.far)) cm.ortho.far = ortho.far;
      cm.ortho.updateProjectionMatrix();
    }
    if (Array.isArray(transform.target)) {
      cm.controls.target.fromArray(transform.target);
      cm.orthoControls.target.fromArray(transform.target);
    }
    cm.syncFrustum();
    cm.controls.update();
    cm.orthoControls.update();
    if (cm.viewport && typeof cm.viewport.invalidate === 'function') cm.viewport.invalidate();
    return true;
  } catch (error) {
    console.warn('camera transform could not be applied', error);
    return false;
  }
}

/** Rig pozunu ve parça görünürlüğünü serileştirir. 9 Kasım: çoklu
    karakter — her karakter kendi kaydıyla `characters` listesine girer;
    üst düzey alanlar (bones/parts) geriye uyumluluk için etkin karakterin
    verisini taşımaya devam eder. */
function capturePose3d() {
  const dbg = window.__pose3dDebug;
  if (!dbg || !dbg.rig) return null;
  const parts = dbg.sceneGraph && Array.isArray(dbg.sceneGraph.partStates)
    ? dbg.sceneGraph.partStates
    : [];
  const characters = typeof dbg.characterList === 'function'
    ? (dbg.characterList() || [])
    : [];
  return {
    rigSignature: dbg.rig.signature || null,
    modelName: dbg.character && dbg.character.name ? dbg.character.name : null,
    bones: dbg.rig.snapshotJSON(),
    parts: parts.map(part => ({
      index: part.index,
      name: part.name,
      visible: part.visible !== false,
    })),
    activeId: dbg.activeCharacterId || characters[0]?.id || 'female',
    characters,
  };
}

/** Kayıtlı rig pozunu uygular: hem eskisi (tek karakter hem çoklu
    karakter formatı). */
function applyPose3d(pose) {
  if (!pose) return false;
  const dbg = window.__pose3dDebug;
  if (!dbg) return false;
  try {
    const manager = dbg.characterManager;
    if (Array.isArray(pose.characters) && pose.characters.length && manager) {
      pose.characters.forEach(rec => manager.restoreCharacter(rec));
    }
    /* Üst düzey (etkin karakter / eski kayıt) alanları da uygula. */
    if (Array.isArray(pose.bones) && dbg.rig) dbg.rig.restoreJSON(pose.bones);
    if (Array.isArray(pose.parts) && dbg.sceneGraph) {
      pose.parts.forEach(part => {
        if (part && Number.isInteger(part.index)) {
          dbg.sceneGraph.setPartVisible(part.index, part.visible !== false);
        }
      });
    }
    if (dbg.viewport && typeof dbg.viewport.invalidate === 'function') dbg.viewport.invalidate();
    return true;
  } catch (error) {
    console.warn('Could not apply the 3D pose', error);
    return false;
  }
}

/* =========================================================
   ProjectState
   ========================================================= */

/**
 * Tek bir panonun izole durumu.
 *
 * - `snapshot`: tahta öğeleri, görünüm, arka plan, gruplar, bağlantılar, çöp.
 * - `cameraTransform`: 3D kamera modu/konumu/hedefi (persp + ortho).
 * - `pose3d`: rig kemik pozları, parça görünürlüğü ve model adı.
 * - `undoStack` / `redoStack` / `selection`: oturum içi pano geçmişi.
 */
class ProjectState {
  constructor(options = {}) {
    this.id = options.id || ('prj_' + newId());
    this.name = options.name || 'New Board';
    this.createdAt = Number.isFinite(options.createdAt) ? options.createdAt : Date.now();
    this.updatedAt = Number.isFinite(options.updatedAt) ? options.updatedAt : Date.now();
    this.snapshot = cloneJSON(options.snapshot) || emptyBoardSnapshot();
    this.cameraTransform = options.cameraTransform || null;
    this.pose3d = options.pose3d || null;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.needsFit = !!options.needsFit;
    this.fresh = !!options.fresh;
  }

  /** Panodaki görsel öğeleri (konumlarıyla birlikte). */
  get referenceImages() {
    const list = [];
    for (const item of this.snapshot.items || []) {
      if (item && item.kind === 'image' && item.imageId) list.push(item);
    }
    return list;
  }

  get itemCount() {
    return Array.isArray(this.snapshot.items) ? this.snapshot.items.length : 0;
  }

  get isEmpty() {
    const trash = Array.isArray(this.snapshot.trash) ? this.snapshot.trash.length : 0;
    return this.itemCount === 0 && trash === 0;
  }

  /**
   * Canlı tahtayı bu panoya kopyalar. `boardJSON` verilirse hazır bir
   * anlık görüntü kullanılır (kayıt kuyruğundaki eski kareler için).
   */
  capture(boardJSON) {
    let snapshot = null;
    if (typeof boardJSON === 'string') {
      try { snapshot = JSON.parse(boardJSON); } catch { snapshot = null; }
    } else if (boardJSON && typeof boardJSON === 'object') {
      snapshot = boardJSON;
    }
    this.snapshot = cloneJSON(snapshot) || cloneJSON(createStateSnapshot());
    const camera = captureCameraTransform();
    if (camera) this.cameraTransform = camera;
    const pose = capturePose3d();
    if (pose) this.pose3d = pose;
    this.undoStack = undoStack.slice();
    this.redoStack = redoStack.slice();
    this.selection = [...selection];
    this.updatedAt = Date.now();
    return this;
  }

  /** Bu panoyu canlı tahtaya uygular. Derin kopya sayesinde anlık
      görüntü ile canlı `state` birbirinin referansını paylaşmaz. */
  apply() {
    restoreSnapshot(cloneJSON(this.snapshot) || emptyBoardSnapshot());
    // Pano değişti: önceki panonun raster geri al kopyaları geçersiz.
    if (typeof inkUndoRasterDropAll === 'function') inkUndoRasterDropAll();
    undoStack = Array.isArray(this.undoStack) ? this.undoStack.slice() : [];
    redoStack = Array.isArray(this.redoStack) ? this.redoStack.slice() : [];
    selection = new Set(Array.isArray(this.selection) ? this.selection : []);
    selectionOrder = [...selection];
    editingId = null;
    return this;
  }

  /** IndexedDB / yedek dosyası için düz kayıt. */
  toRecord() {
    return {
      schema: PROJECT_SCHEMA_VERSION,
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      state: this.snapshot,
      cameraTransform: this.cameraTransform,
      pose3d: this.pose3d,
    };
  }

  serialize() {
    return this.toRecord();
  }

  static deserialize(record) {
    if (!record || typeof record !== 'object') return null;
    return new ProjectState({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      snapshot: record.state || record.snapshot,
      cameraTransform: record.cameraTransform || record.camera_transform || null,
      pose3d: record.pose3d || null,
    });
  }
}

/* =========================================================
   TailRefWorkspaceManager
   ========================================================= */

class TailRefWorkspaceManager {
  constructor() {
    this.projects = new Map();
    this.order = [];
    this.activeId = null;
    this.ready = false;
    this.default3d = null;
    this.pending3d = null;
    this.tabHost = null;
    this.addButton = null;
    this.renamingId = null;
    this._queue = Promise.resolve();
    this._bound3d = false;
  }

  /** Etkin pano nesnesi; yoksa null. */
  get activeProject() {
    return this.projects.get(this.activeId) || null;
  }

  /* ---------- başlangıç ---------- */

  async bootstrap() {
    this._mountUI();
    this._bind3d();
    await this._load();
    if (window.__pose3dDebug) this._sync3dDefaults();
    await this.activate(this.activeId, { initial: true });
    this.ready = true;
    if (!this.default3d && window.__pose3dDebug) this._sync3dDefaults();
    const active = this.projects.get(this.activeId);
    if (active) this._apply3d(active);
    this._renderTabs();
  }

  _mountUI() {
    this.tabHost = document.getElementById('projectTabs');
    this.addButton = document.getElementById('btnNewProject');

    if (this.tabHost) {
      this.tabHost.addEventListener('click', event => this._onTabClick(event));
      this.tabHost.addEventListener('dblclick', event => this._onTabDoubleClick(event));
      this.tabHost.addEventListener('auxclick', event => {
        if (event.button !== 1) return;
        const tab = event.target.closest('.projTab');
        if (!tab) return;
        event.preventDefault();
        this.closeProjectTab(tab.dataset.projectId);
      });
    }

    if (this.addButton) {
      // + artık önce isim sorar (boş bırakılırsa "Pano N").
      this.addButton.addEventListener('click', () => this.requestNewProject());
    }

    window.addEventListener('keydown', event => {
      if (typeof modeIsDraw === 'function' && modeIsDraw()) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (String(event.key || '').toLowerCase() !== 'n') return;
      event.preventDefault();
      this.requestNewProject();
    });
  }

  /** `+` / Ctrl+Shift+N: panoyu hemen açar; ad otomatik verilir (Pano N).
      Yeniden adlandırma sekme başlığına çift tıklayarak yapılır. */
  async requestNewProject() {
    if (this._atProjectLimit()) {
      this.notifyProjectLimit();
      return null;
    }
    if (namingOpen) return null;
    return this.createProject(this._nextProjectName(''));
  }

  _bind3d() {
    if (this._bound3d) return;
    this._bound3d = true;
    window.addEventListener('tailref-3d-ready', () => {
      if (!this.default3d) this._sync3dDefaults();
      if (!this.ready) return;
      const active = this.projects.get(this.activeId);
      if (active) this._apply3d(active);
    });
  }

  _sync3dDefaults() {
    if (!window.__pose3dDebug) return;
    this.default3d = {
      camera: captureCameraTransform(),
      pose: capturePose3d(),
    };
  }

  _apply3d(project) {
    if (!project || this.activeId !== project.id) return;
    if (!window.__pose3dDebug) {
      this.pending3d = { id: project.id };
      return;
    }
    const camera = project.cameraTransform || (this.default3d && this.default3d.camera) || null;
    const pose = project.pose3d || (this.default3d && this.default3d.pose) || null;
    if (camera) applyCameraTransform(camera);
    if (pose) applyPose3d(pose);
    this.pending3d = null;
  }

  /* ---------- yükleme / göç ---------- */

  async _load() {
    /* Bu oturumda açıkça dosya açıldıysa (içe aktarma + reload), "temiz
       başlat" ayarı dosyayı silmemeli. */
    let openedFileThisSession = false;
    try { openedFileThisSession = sessionStorage.getItem(OPENED_FILE_ONCE_KEY) === '1'; }
    catch { /* sessiz */ }
    /* Manuel mod: diskteki panolar açılışta yüklenmez. Yalnızca aynı oturumda
       açıkça .tail/yedek dosyası seçildiyse bir kez okunur; aksi halde boş
       "Pano 1" ile başlanır. Kaydetmeden çıkınca hiçbir şey geri gelmez. */
    if (!isPersistenceAuto()) {
      let loadOnce = false;
      /* Bayrak oturum boyunca kalır: kullanıcı sekmeyi yenilerse (Ctrl+R)
         az önce açtığı pano boşalmamalı. Uygulama kapanınca sessionStorage
         zaten silinir; yeni açılış yine boş başlar. */
      try { loadOnce = sessionStorage.getItem(MANUAL_OPEN_ONCE_KEY) === '1'; }
      catch { /* sessiz */ }
      if (!loadOnce) {
        const project = new ProjectState({
          name: 'Board 1',
          snapshot: emptyBoardSnapshot(),
          fresh: true,
        });
        this.projects.set(project.id, project);
        this.order.push(project.id);
        this.activeId = project.id;
        return;
      }
    }

    /* Ayar: açılışta son panoları geri yükle. Anahtar yoksa/bozuksa
       eski davranış geçerli (panolar geri yüklenir). '0' → temiz
       başlat: önceki oturumun panoları arşive yazılıp IndexedDB
       boşaltılır (kurtarma akışının emniyet ilkesiyle aynı; veri
       sessizce kaybolmaz) ve tek boş pano açılır. Kurtarma yedeği bu
       açılışta uygulandıysa (kullanıcı açıkça "son kayda dön" dedi)
       temiz başlatma devre dışı bırakılır. */
    let restoreBoards = true;
    try { restoreBoards = localStorage.getItem('tailref-restore-boards') !== '0'; }
    catch { /* sessiz — mevcut davranış */ }
    if (!restoreBoards && !this._recoveryRestoredThisBoot && !openedFileThisSession) {
      let archivePath = null;
      try { archivePath = await archiveAndWipeBoards(); }
      catch (error) { console.warn('boot clean start could not archive', error); }
      const project = new ProjectState({
        name: 'Board 1',
        snapshot: emptyBoardSnapshot(),
        fresh: true,
      });
      this.projects.set(project.id, project);
      this.order.push(project.id);
      this.activeId = project.id;
      if (archivePath) {
        try { showProjectNotice(__t('Previous boards are in the archive') + ': ' + archivePath, 9000); }
        catch { /* sessiz */ }
      }
      return;
    }

    let index = null;
    try {
      index = await idbGet('meta', PROJECT_INDEX_KEY);
    } catch (error) {
      console.warn('board index could not be read', error);
    }

    if (index && Array.isArray(index.projects) && index.projects.length) {
      const seen = new Set();
      for (const entry of index.projects) {
        const id = typeof entry === 'string' ? entry : (entry && entry.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        let record = null;
        try {
          record = await idbGet('meta', PROJECT_RECORD_PREFIX + id);
        } catch (error) {
          console.warn('board record could not be read', id, error);
        }
        if (!record) continue;
        const project = ProjectState.deserialize({ ...record, id: record.id || id });
        if (!project) continue;
        if (!project.name && entry && entry.name) project.name = entry.name;
        this.projects.set(id, project);
        this.order.push(id);
      }
      if (this.order.length) {
        this.activeId = this.projects.has(index.activeId) ? index.activeId : this.order[0];
        await this._dedupeCustomBrushes();
        return;
      }
    }

    await this._migrateLegacy();
    await this._dedupeCustomBrushes();
  }

  /* Eski bir hata yüzünden her panoda biriken birebir aynı özel
     fırçaları temizler. Yalnızca gerçekten değişen kayıtlar yeniden
     yazılır; ikinci açılışta hiçbir yazma olmaz. */
  async _dedupeCustomBrushes() {
    if (typeof inkDedupeCustomBrushes !== 'function') return;
    for (const project of this.projects.values()) {
      const ink = project && project.snapshot && project.snapshot.ink;
      if (!ink) continue;
      if (!inkDedupeCustomBrushes(ink)) continue;
      if (!isPersistenceAuto()) continue;
      try {
        await idbPut('meta', PROJECT_RECORD_PREFIX + project.id, project.toRecord());
      } catch (error) {
        console.warn('brush cleanup could not be written', project.id, error);
      }
    }
  }

  /** Eski tek tahtalı `meta/state` kaydını ilk panoya taşır. */
  async _migrateLegacy() {
    let snapshot = null;
    try {
      const raw = await idbGet('meta', 'state');
      if (raw) snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      console.warn('old board could not be read', error);
    }

    const project = new ProjectState({
      name: 'Board 1',
      snapshot: snapshot || emptyBoardSnapshot(),
      needsFit: !hasFiniteView(snapshot && snapshot.view),
    });
    this.projects.set(project.id, project);
    this.order.push(project.id);
    this.activeId = project.id;
    try {
      if (isPersistenceAuto()) await idbPut('meta', PROJECT_RECORD_PREFIX + project.id, project.toRecord());
    } catch (error) {
      console.warn('migration record could not be written', error);
    }
    await this._writeIndex();
  }

  async _writeIndex() {
    /* Manuel modda pano indeksi diske yazılmaz. */
    if (!isPersistenceAuto()) return;
    const projects = this.order
      .map(id => this.projects.get(id))
      .filter(Boolean)
      .map(project => ({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
      }));
    return idbPut('meta', PROJECT_INDEX_KEY, {
      schema: PROJECT_SCHEMA_VERSION,
      activeId: this.activeId,
      projects,
    });
  }

  /* ---------- sekme yaşam döngüsü ---------- */

  _enqueue(task) {
    const next = this._queue.then(task, task);
    this._queue = next.catch(() => {});
    return next;
  }

  switchTo(id) {
    if (!this.projects.has(id)) return Promise.resolve(false);
    return this._enqueue(async () => {
      if (!this.ready) return false;
      /* Zaten etkin sekmeye tıklamak DOM'u yeniden kurmamalı: aksi halde
         çift tıklamanın ikinci tıklaması yeni düğüm üretir ve
         yeniden adlandırma girişi hemen kaybolur. */
      if (id === this.activeId) return true;
      await this._commitActive();
      await this.activate(id);
      return true;
    });
  }

  createProject(name) {
    if (this._atProjectLimit()) {
      this.notifyProjectLimit();
      return Promise.resolve(null);
    }
    return this._enqueue(async () => {
      if (!this.ready) return null;
      if (this._atProjectLimit()) {
        this.notifyProjectLimit();
        return null;
      }
      await this._commitActive();
      const project = new ProjectState({
        name: this._nextProjectName(name),
        snapshot: emptyBoardSnapshot(),
        fresh: true,
      });
      this.projects.set(project.id, project);
      this.order.push(project.id);
      this.activeId = project.id;
      try {
        if (isPersistenceAuto()) await idbPut('meta', PROJECT_RECORD_PREFIX + project.id, project.toRecord());
      } catch (error) {
        console.warn('the new board could not be saved', error);
      }
      await this._writeIndex();
      await this.activate(project.id, { initial: true });
      return project;
    });
  }

  renameProject(id, name) {
    const project = this.projects.get(id);
    if (!project) return Promise.resolve(false);
    const next = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 64);
    if (!next) {
      this._renderTabs();
      return Promise.resolve(false);
    }
    project.name = next;
    project.updatedAt = Date.now();
    if (id === this.activeId) project.capture();
    return this._enqueue(async () => {
      try {
        if (isPersistenceAuto()) await idbPut('meta', PROJECT_RECORD_PREFIX + id, project.toRecord());
        await this._writeIndex();
      } catch (error) {
        console.warn('board name could not be saved', error);
      }
      this._renderTabs();
      return true;
    });
  }

  async closeProjectTab(id) {
    const project = this.projects.get(id);
    if (!project) return false;
    /* Ayar: kapatma onayı. tailref-close-confirm yoksa/bozuksa eski
       davranış geçerli (dolu panolarda onay sorulur). '0' = hiç
       sormadan kapat; gerçek davranış değişikliği ayar tarafından
       yönetilir. */
    let askOnClose = true;
    try { askOnClose = localStorage.getItem('tailref-close-confirm') !== '0'; }
    catch { /* sessiz — mevcut davranış */ }
    if (askOnClose && project.itemCount > 0) {
      /* appConfirm bloksuz (ana süreç diyaloğu) — soru+detay ayrı gösterilir. */
      const ok = await appConfirm(
        __t('"{name}" — close this board?', { name: project.name }),
        __t('The {count} items on this board and its 3D/camera data will be deleted.', { count: project.itemCount })
      );
      if (!ok) return false;
    }

    return this._enqueue(async () => {
      if (!this.projects.has(id)) return false;
      const wasActive = id === this.activeId;
      if (wasActive) await this._commitActive();

      const index = this.order.indexOf(id);
      this.projects.delete(id);
      if (index >= 0) this.order.splice(index, 1);
      try {
        if (isPersistenceAuto()) await idbDel('meta', PROJECT_RECORD_PREFIX + id);
      } catch (error) {
        console.warn('board record could not be deleted', error);
      }

      if (!this.order.length) {
        // Son sekme de kapandıysa boş bir pano ile devam et.
        const fresh = new ProjectState({
          name: 'Board 1',
          snapshot: emptyBoardSnapshot(),
          fresh: true,
        });
        this.projects.set(fresh.id, fresh);
        this.order.push(fresh.id);
        this.activeId = fresh.id;
        try {
          if (isPersistenceAuto()) await idbPut('meta', PROJECT_RECORD_PREFIX + fresh.id, fresh.toRecord());
        } catch { /* sessiz */ }
        await this.activate(fresh.id, { initial: true });
      } else if (wasActive) {
        const nextIndex = Math.min(index < 0 ? 0 : index, this.order.length - 1);
        this.activeId = this.order[nextIndex];
        await this.activate(this.activeId);
      } else {
        await this._writeIndex();
        this._renderTabs();
      }

      // Bu panoya özel görseller artık hiçbir panoda kullanılmıyorsa silinir.
      // Manuel modda diskteki otomatik panolara ait görselleri yanlışlıkla
      // silmemek için çöp toplama çalıştırılmaz.
      if (isPersistenceAuto()) {
        try { await gcImages(); } catch { /* sessiz */ }
      }
      return true;
    });
  }

  /** Aktif panoyu canlı tahtadan kaydeder. Sekme değişiminden önce çağrılır. */
  async _commitActive() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveInFlight) {
      try { await saveInFlight; } catch { /* sessiz */ }
    }
    pendingStateJSON = null;
    pendingProjectRecord = null;

    const project = this.projects.get(this.activeId);
    if (!project) return;
    project.capture();
    /* Manuel modda hiçbir pano diske yazılmaz; yalnızca bellekteki durum
       güncellenir. Böylece kaydetmeden çıkınca açılış yine boş olur. */
    if (!isPersistenceAuto()) return;
    try {
      await idbPut('meta', PROJECT_RECORD_PREFIX + project.id, project.toRecord());
      await idbPut('meta', 'state', JSON.stringify(project.snapshot));
      await this._writeIndex();
    } catch (error) {
      console.warn('the board could not be saved', error);
    }
  }

  /** Kayıt kuyruğundan gelen (gecikmeli) pano kaydını yazar. */
  async persistStaged(staged) {
    /* Manuel mod: otomatik kayıt kuyruğu diske hiçbir şey yazmaz. */
    if (!isPersistenceAuto()) return;
    if (!staged || !staged.record) return;
    const project = this.projects.get(staged.id);
    if (!project) return;
    // Sekme değişimi bu kayıttan daha yeni bir durum yazdıysa eskisini ezme.
    if (project.id === this.activeId && project.updatedAt > (staged.record.updatedAt || 0)) return;
    try {
      await idbPut('meta', PROJECT_RECORD_PREFIX + project.id, staged.record);
      await this._writeIndex();
    } catch (error) {
      console.warn('board could not be written', error);
    }
  }

  /** Panoyu canlı tahtaya uygular ve 3D durumunu geri yükler. */
  async activate(id) {
    const project = this.projects.get(id);
    if (!project) return;

    this.activeId = id;
    project.apply();
    this._resetBoardDom();
    purgeExpiredTrash({ render: false, save: false });

    const items = Array.isArray(state.items) ? state.items.slice() : [];
    const imageTotal = items.filter(item => item && item.kind === 'image' && item.imageId).length;
    let imageDone = 0;
    if (imageTotal && countEl) countEl.textContent = `Loading images... 0/${imageTotal}`;

    await mapInBatches(items, INIT_IMAGE_CONCURRENCY, async item => {
      if (!item || item.kind !== 'image' || !item.imageId) return;
      try {
        const result = await loadImage(item.imageId);
        if (result.status !== 'ok') {
          console.warn('board image not ready', item.imageId, result.status);
        }
      } catch (error) {
        console.warn('board image could not be loaded', item.imageId, error);
      } finally {
        imageDone++;
        if (imageTotal && countEl) {
          countEl.textContent = `Loading images... ${imageDone}/${imageTotal}`;
        }
      }
    });

    // Silinmiş fotoğraflara bağlı okları temizle.
    if (Array.isArray(state.links) && state.links.length) {
      const ids = new Set(state.items.map(item => item.id));
      state.links = state.links.filter(link => ids.has(link.from) && ids.has(link.to));
    }
    project.snapshot.links = cloneJSON(state.links);
    project.snapshot.trash = cloneJSON(state.trash);

    applyView();
    applyBackdrop();
    syncAll();
    if (typeof inkRebuildAll === 'function') inkRebuildAll();
    syncSelection();
    if (project.needsFit && state.items.length) {
      project.needsFit = false;
      fitAll();
      // fitAll canlı görünümü değiştirir; pano kaydına da yansıt.
      project.snapshot.view = cloneJSON(state.view);
    }

    if (!this.default3d && window.__pose3dDebug) this._sync3dDefaults();
    this._apply3d(project);

    updateTrashUI(true);
    this._renderTabs();

    if (isPersistenceAuto()) {
      try {
        await idbPut('meta', 'state', JSON.stringify(project.snapshot));
        await this._writeIndex();
      } catch (error) {
        console.warn('board index could not be written', error);
      }
    }

    window.dispatchEvent(new CustomEvent('tailref-project-changed', {
      detail: { id: project.id, name: project.name },
    }));
  }

  _resetBoardDom() {
    selection.clear();
    selectionOrder = [];
    editingId = null;
    elMap.clear();
    groupFrameEls.clear();
    for (const el of world.querySelectorAll('.item, .item-leaving')) el.remove();
    if (groupFramesEl) groupFramesEl.replaceChildren();
    linkNodes.clear();
    if (linkLayerEl) linkLayerEl.replaceChildren();
    if (marqueeEl) marqueeEl.hidden = true;
    document.querySelectorAll('#snapGuides .sg').forEach(guide => { guide.hidden = true; });
    if (typeof inkResetDom === 'function') inkResetDom();
  }

  /* ---------- sekme şeridi ---------- */

  _nextProjectName(preferred) {
    const clean = String(preferred || '').trim();
    if (clean) return clean.replace(/\s+/g, ' ').slice(0, 64);
    const used = new Set([...this.projects.values()].map(project => project.name));
    let n = 1;
    while (used.has(`Board ${n}`)) n++;
    return `Board ${n}`;
  }

  _renderTabs() {
    if (!this.tabHost) return;
    const fragment = document.createDocumentFragment();
    for (const id of this.order) {
      const project = this.projects.get(id);
      if (!project) continue;

      const tab = document.createElement('div');
      tab.className = 'projTab' + (id === this.activeId ? ' is-active' : '');
      tab.dataset.projectId = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', id === this.activeId ? 'true' : 'false');

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'projTabLabel';
      label.textContent = project.name;
      label.title = project.name + ' — ' + __t('Double-click to rename');
      label.dataset.action = 'switch';
      tab.appendChild(label);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'projTabClose';
      close.dataset.action = 'close';
      close.setAttribute('aria-label', __t('"{name}" — close board', { name: project.name }));
      close.title = __t('Close board');
      close.textContent = '×';
      tab.appendChild(close);

      fragment.appendChild(tab);
    }
    this.tabHost.replaceChildren(fragment);
    const active = this.tabHost.querySelector('.projTab.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this._updateAddButton();
  }

  /* ---------- pano sınırı ---------- */

  _atProjectLimit() {
    return this.order.length >= MAX_PROJECTS;
  }

  _updateAddButton() {
    const button = this.addButton;
    if (!button) return;
    const full = this._atProjectLimit();
    button.disabled = full;
    button.classList.toggle('is-full', full);
    button.setAttribute('aria-disabled', full ? 'true' : 'false');
    button.title = full
      ? __t('At most {n} boards can be open', { n: MAX_PROJECTS })
      : __t('New board (Ctrl+Shift+N)');
  }

  notifyProjectLimit() {
    showProjectNotice(__t('At most {n} boards can be open. Close one to open a new board.', { n: MAX_PROJECTS }));
  }

  _onTabClick(event) {
    const tab = event.target.closest('.projTab');
    if (!tab) return;
    const id = tab.dataset.projectId;
    if (!id) return;
    if (event.target.closest('[data-action="close"]')) {
      event.stopPropagation();
      this.closeProjectTab(id);
      return;
    }
    this.switchTo(id);
  }

  _onTabDoubleClick(event) {
    if (event.target.closest('[data-action="close"]')) return;
    const tab = event.target.closest('.projTab');
    if (!tab) return;
    const id = tab.dataset.projectId;
    if (!id) return;
    event.preventDefault();
    this._beginRename(id);
  }

  _beginRename(id) {
    const project = this.projects.get(id);
    if (!project || !this.tabHost) return;
    const tab = [...this.tabHost.querySelectorAll('.projTab')]
      .find(node => node.dataset.projectId === id);
    if (!tab) return;
    const label = tab.querySelector('.projTabLabel');
    if (!label) return;

    this.renamingId = id;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'projTabRename';
    input.value = project.name;
    input.maxLength = 64;
    input.setAttribute('aria-label', 'Board name');
    label.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      const value = input.value;
      this.renamingId = null;
      this._renderTabs();
      if (commit) this.renameProject(id, value);
    };

    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', event => event.stopPropagation());
  }

  /* ---------- dışa aktarım / GC ---------- */

  /** Yedek dosyası için tüm panoları serileştirir. */
  serializeWorkspace() {
    return {
      schema: PROJECT_SCHEMA_VERSION,
      activeId: this.activeId,
      projects: this.order
        .map(id => this.projects.get(id))
        .filter(Boolean)
        .map(project => project.toRecord()),
    };
  }
}

/* =========================================================
   app.js entegrasyonu
   ========================================================= */

const workspaceManager = new TailRefWorkspaceManager();

/* Dil değişince "+ Yeni pano" düğmesinin başlığı tazelensin. */
if (window.L10N && window.L10N.onChange) {
  window.L10N.onChange(() => { try { workspaceManager._updateAddButton(); } catch { /* sessiz */ } });
}

/** Kayıt kuyruğu için aktif panonun anlık görüntüsünü hazırlar. */
function stageActiveProjectSave() {
  if (!workspaceManager || !workspaceManager.ready || !workspaceManager.activeId) return null;
  const project = workspaceManager.projects.get(workspaceManager.activeId);
  if (!project) return null;
  project.capture();
  return {
    id: project.id,
    json: JSON.stringify(project.snapshot),
    record: project.toRecord(),
  };
}

/** Kuyruğa alınmış pano kaydını IndexedDB'ye yazar. */
function persistStagedProject(staged) {
  if (!workspaceManager || !staged) return Promise.resolve();
  return workspaceManager.persistStaged(staged);
}

/** GC için tüm panolardaki ve (isteğe bağlı) geçmişlerindeki görsel
    kimliklerini toplar. `includeHistory=false`: yedek/dosya payload'ları
    geri al yığınlarını taşımadığı için onlara giren görselleri sayma. */
function collectWorkspaceImageIds(target, includeHistory = true) {
  const used = target instanceof Set ? target : new Set();
  if (!workspaceManager) return used;

  const addSnapshot = raw => {
    let snapshot = raw;
    if (typeof raw === 'string') {
      try { snapshot = JSON.parse(raw); } catch { return; }
    }
    if (!snapshot || typeof snapshot !== 'object') return;
    for (const item of snapshot.items || []) {
      if (item && item.kind === 'image' && item.imageId) used.add(item.imageId);
    }
    for (const entry of snapshot.trash || []) {
      const item = entry && entry.item;
      if (item && item.kind === 'image' && item.imageId) used.add(item.imageId);
    }
  };

  for (const project of workspaceManager.projects.values()) {
    addSnapshot(project.snapshot);
    if (!includeHistory) continue;
    for (const json of project.undoStack || []) addSnapshot(json);
    for (const json of project.redoStack || []) addSnapshot(json);
  }
  return used;
}

/** Bir yedek dosyasının içeriğini IndexedDB'ye yazar (panolar + görseller).
    Hem elle "Choose backup file" hem de açılıştaki otomatik kurtarma kullanır.
    `location.reload()` çağırmaz; sadece veriyi hazırlar. */
async function importBackupPayload(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('Invalid backup');
  /* Gelecekteki bir sürümün dosyasını yanlış okuyup veriyi bozmak yerine
     açıkça reddet. Sürüm alanı olmayan eski dosyalar kabul edilir. */
  const payloadVersion = Number(backup.version);
  if (Number.isFinite(payloadVersion) && payloadVersion > 2) {
    throw new Error('This file was created by a newer TailRef version (' + payloadVersion + ')');
  }
  const hasWorkspace = !!(backup.workspace &&
    Array.isArray(backup.workspace.projects) && backup.workspace.projects.length);
  const hasLegacyState = !!(backup.state && Array.isArray(backup.state.items));
  if (!hasWorkspace && !hasLegacyState) throw new Error('Invalid backup');

  let imageWriteFailures = 0;
  /* İçe aktarma sürerken görsel GC'si araya girmesin. */
  beginImageWrite();
  try {
    if (Array.isArray(backup.images)) {
      for (const image of backup.images) {
        if (!image || !image.id || !image.dataUrl) continue;
        try {
          const blob = await (await fetch(image.dataUrl)).blob();
          await idbPut('images', image.id, { blob, name: image.name || 'image', savedAt: Date.now() });
        } catch (error) {
          imageWriteFailures++;
          console.warn('backup image could not be written', image.id, error);
        }
      }
    }
  } finally {
    endImageWrite();
  }

  /* Dosya görsellerin eksiksiz olduğunu söylüyorsa ama panonun işaret
     ettiği bir görsel ne dosyada ne de bu cihazda varsa, açılış sessizce
     kırık görselle sonuçlanmasın: kullanıcı uyarılır. */
  if (backup.imagesComplete === true) {
    const referenced = new Set();
    const addItems = items => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (item && item.kind === 'image' && item.imageId) referenced.add(String(item.imageId));
      }
    };
    if (hasWorkspace) {
      for (const record of backup.workspace.projects) {
        addItems(record && record.state && record.state.items);
      }
    }
    if (hasLegacyState) addItems(backup.state.items);
    if (referenced.size) {
      const present = new Set();
      for (const [key] of await idbEntries('images')) present.add(String(key));
      for (const id of referenced) {
        if (!present.has(id)) imageWriteFailures++;
      }
    }
  }

  if (hasWorkspace) {
    const keep = new Set();
    const projects = [];
    for (const record of backup.workspace.projects) {
      if (!record || !record.id) continue;
      keep.add(PROJECT_RECORD_PREFIX + record.id);
      await idbPut('meta', PROJECT_RECORD_PREFIX + record.id, record);
      projects.push({
        id: record.id,
        name: record.name || 'Board',
        updatedAt: record.updatedAt || Date.now(),
      });
    }
    if (!projects.length) throw new Error('No valid board in the backup');
    let activeId = backup.workspace.activeId;
    if (!projects.some(project => project.id === activeId)) activeId = projects[0].id;
    await idbPut('meta', PROJECT_INDEX_KEY, {
      schema: PROJECT_SCHEMA_VERSION,
      activeId,
      projects,
    });
    const active = backup.workspace.projects.find(record => record && record.id === activeId);
    if (active && active.state) {
      await idbPut('meta', 'state', JSON.stringify(active.state));
    }
    // Yedekte olmayan eski pano kayıtlarını temizle.
    for (const [key] of await idbEntries('meta')) {
      if (String(key).startsWith(PROJECT_RECORD_PREFIX) && !keep.has(key)) {
        await idbDel('meta', key);
      }
    }
  } else {
    await idbPut('meta', 'state', JSON.stringify(backup.state));
    // Eski biçim yedeği: pano indeksini kaldır, göç ilk açılışta çalışsın.
    await idbDel('meta', PROJECT_INDEX_KEY);
    for (const [key] of await idbEntries('meta')) {
      if (String(key).startsWith(PROJECT_RECORD_PREFIX)) await idbDel('meta', key);
    }
  }
  /* Dosya açıldı: "açılışta temiz başla" ayarı bu oturumdaki yeniden
     yüklemede az önce açılan panoları arşivleyip silmemeli. */
  try { sessionStorage.setItem(OPENED_FILE_ONCE_KEY, '1'); } catch { /* sessiz */ }
  /* Manuel modda yüklenen dosya yalnızca bu oturum için geçerli: yeniden
     yüklemede bir kez okunur, sonraki uygulama açılışında hiçbir şey gelmez. */
  if (!isPersistenceAuto()) {
    try { sessionStorage.setItem(MANUAL_OPEN_ONCE_KEY, '1'); } catch { /* sessiz */ }
  }

  if (imageWriteFailures) {
    /* Eksik görselli açılan pano sessizce bozuk görünmesin. */
    setTimeout(() => {
      try {
        showProjectNotice(__t('Image could not be read') +
          ' (' + imageWriteFailures + ')', 9000);
      } catch { /* sessiz */ }
    }, 0);
  }
  return true;
}

/* Manuel moddan otomatiğe geçişte canlı çalışma alanında olmayan eski pano
   kayıtları IDB'de kalıyordu (görünmez ama yer kaplıyordu). Yalnızca
   indekste/listede karşılığı olmayan 'project:' kayıtları silinir; açık
   panolara ve başka anahtarlara (fırça kütüphanesi, FX presetleri)
   dokunulmaz. Ardından sahipsiz görseller GC ile temizlenir. */
async function pruneStaleStoredBoards() {
  if (!isPersistenceAuto()) return 0;
  if (!workspaceManager || !workspaceManager.ready) return 0;
  const keep = new Set(workspaceManager.order.map(id => PROJECT_RECORD_PREFIX + id));
  let removed = 0;
  for (const [key] of await idbEntries('meta')) {
    const k = String(key);
    if (!k.startsWith(PROJECT_RECORD_PREFIX)) continue;
    if (keep.has(k)) continue;
    await idbDel('meta', k);
    removed++;
  }
  if (removed && typeof gcImages === 'function') {
    try { await gcImages(); } catch { /* sessiz */ }
  }
  return removed;
}

/* Test ve hata ayıklama köprüsü. */
window.ProjectState = ProjectState;
window.pruneStaleStoredBoards = pruneStaleStoredBoards;
window.TailRefWorkspaceManager = TailRefWorkspaceManager;
window.MAX_PROJECTS = MAX_PROJECTS;
window.importBackupPayload = importBackupPayload;
window.__tailrefWorkspace = workspaceManager;
