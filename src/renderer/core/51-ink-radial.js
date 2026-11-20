/* TailRef app · sağ tık dairesel hızlı panel (Apple tarzı cam disk)
   --------------------------------------------------------------
   Yapı:
     inkRadial (saydam taşıyıcı)
     ├─ inkRadialDisk   240px cam disk (blur + doygunluk)
     │   ├─ merkez: .inkRadialColor  → hover'da büyüyüp ton yaprakları;
     │   │                     çekirdek tık: tam renk çarkı
     │   ├─ 4 araç yuvası: Fırça (üst + son-fırçalar kapsülü),
     │   │   Silgi (sağ), Boya kovası (alt), Damlalık (sol)
     ├─ inkRadialDock   disk altında ayrı cam yuva: önizleme + ad +
     │                  Boyut/Opaklık/Yumuşatma sürgüleri
   Açılış: sağ tık / orta tık — yalnızca gerçek tuş basışında.
   WACOM KORUMASI: kalem ucu halen temasta (vuruş sürüyor) ya da
   az önce kalktıysa, Windows'un "uzun basma = sağ tık" sinyali
   menüyü ASLA açmaz (kullanıcı şikayeti: çizim sırasında menü). */

const INK_RADIAL_KEY = 'tailref-recent-brushes-v1';
const INK_RADIAL_SLOTS = 6;          // kapsüldeki son fırça sayısı
const INK_RADIAL_DISK = 240;         // cam disk çapı
const INK_RADIAL_RADIUS = 88;        // araç yuvası merkezi yarıçapı
const INK_RADIAL_WHEEL = 148;        // merkez klasik renk çarkı çapı
const INK_RADIAL_RECENT_MAX = 12;
const INK_RADIAL_TOP_PAD = 60;       // kapsül üst taşmasına pay
const INK_RADIAL_CONTACT_HUSH = 300; // kalem kalkışı sonrası sessizlik ms

const inkRadialUi = {
  open: false,
  root: null,
  disk: null,
  dock: null,
  color: null,
  colorDisc: null,
  wheelCanvas: null,
  slotButtons: { brush: null, eraser: null, fill: null, dropper: null },
  capsule: null,
  capsuleButtons: [],
  brushBtn: null,
  preview: null,
  name: null,
  rows: [],
  recent: null,
  /* Çark öz-durumu: çarkın yazdığı hex elle eşleşen (h,s,v). Hex 8-bit
     olduğundan OKLCH geri çözümü ±1 LSB'de sallanır; sürüklemede her
     karede yeniden türetim çift yönlü titremeye yol açıyordu
     (kullanıcı raporu 09.11: halkayı çevirirken üçgen, üçgeni
     sürüklerken halka oynuyordu). */
  wheelSt: null,
  wheelStHex: '',
  bound: false,
};

const inkRadialContact = { down: false, id: null, lastUp: 0 };
/* Orta tuş pan sürüklemesi radial'i susturur: bırakınca gelen auxclick
   gerçek bir menü isteği değildir (kullanıcı kaydırma yaptı). */
let inkRadialAuxHushUntil = 0;
function inkRadialHushClicks(ms) {
  const until = Date.now() + (Number.isFinite(ms) ? ms : 400);
  if (until > inkRadialAuxHushUntil) inkRadialAuxHushUntil = until;
}

/* =========================================================
   son kullanılan fırçalar
   ========================================================= */
function inkRadialLoadStored() {
  if (!inkRadialUi.recent) inkRadialLoadStoredDo();
}
function inkRadialLoadStoredDo() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(INK_RADIAL_KEY) || '[]'); } catch { stored = []; }
  inkRadialUi.recent = Array.isArray(stored) ? stored.filter(id => typeof id === 'string' && id) : [];
}

function inkRadialValidBrushes() {
  /* Motorun gerçek fırça dizisi (hazır + içe aktarılan uçlar). */
  let brushes = [];
  try { brushes = inkState().brushes || []; } catch { brushes = []; }
  if (!brushes.length && typeof inkDefaultBrushes === 'function') {
    try { brushes = inkDefaultBrushes() || []; } catch { brushes = []; }
  }
  return brushes.filter(b => b && b.id);
}

/** Panelde gösterilecek fırçalar: gerçek son kullanılanlar, eksikse
    hazır fırçalarla tamamlanır. */
function inkRadialRecentList() {
  if (!inkRadialUi.recent) inkRadialLoadStoredDo();
  const brushes = inkRadialValidBrushes();
  const out = [];
  for (const id of inkRadialUi.recent || []) {
    const b = brushes.find(item => item.id === id);
    if (b && !out.some(x => x.id === b.id)) out.push(b);
  }
  for (const b of brushes) {
    if (out.length >= INK_RADIAL_SLOTS) break;
    if (!out.some(x => x.id === b.id)) out.push(b);
  }
  return out.slice(0, INK_RADIAL_SLOTS);
}

/** Bir fırçayı son kullanılanların başına taşır. */
function inkRadialTouch(brushId) {
  const brushes = inkRadialValidBrushes();
  if (!brushes.some(b => b.id === brushId)) return;
  if (!inkRadialUi.recent) inkRadialLoadStoredDo();
  const next = [brushId]
    .concat((inkRadialUi.recent || []).filter(id => id !== brushId))
    .slice(0, INK_RADIAL_RECENT_MAX);
  inkRadialUi.recent = next;
  try { localStorage.setItem(INK_RADIAL_KEY, JSON.stringify(next)); } catch { /* sessiz */ }
  if (inkRadialUi.open) inkRadialRender();
}

/* =========================================================
   merkez klasik renk çarkı (ton halkası + OKLCH üçgeni)
   Paneldeki büyük çarkla aynı matematik: 56-ink-color durum
   dönüşümleri + 31-ink-ui halka/üçgen çizimleri yeniden
   kullanılır; küçük çarkın geometri nesnesi aynı şablonla
   kurulur (dış /775 iç / üçgen halka-8).
   ========================================================= */
let inkRadialWheelMode = null;   // null | 'ring' | 'tri'
let inkRadialWheelId = null;     // pointer pointerId

function inkRadialWheelGeometry() {
  const c = inkRadialUi.wheelCanvas;
  if (!c) return null;
  const css = INK_RADIAL_WHEEL;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.round(css * dpr));
  if (c.width !== px || c.height !== px) {
    c.width = px;
    c.height = px;
  }
  const outer = css / 2 - 4;
  const inner = outer * 0.775;
  const triR = inner - Math.max(7, css * 0.045);
  const cx = css / 2;
  const cy = css / 2;
  const h3 = triR * Math.sqrt(3) / 2;
  return {
    css, dpr, px, cx, cy, outer, inner, triR,
    A: { x: cx - triR / 2, y: cy - h3 },
    B: { x: cx - triR / 2, y: cy + h3 },
    C: { x: cx + triR, y: cy },
  };
}

function inkRadialWheelState() {
  /* Sürükleme boyu durum hex'ten YENİDEN TÜRETİLMEZ: hex 8-bit olduğundan
     OKLCH geri çözümü (hue araması) düşük chromada gürültüye açıktı —
     her karede yeniden türetim çift yönlü titremeydi. Çarkın kendi
     yazdığı hex için durum önbellekten okunur; renk dışarıdan değişince
     (örnekleyici/panel/palet) hex eşleşmesi kırılır ve durum tek kez
     türetilir (aynı hex → aynı sonuç, tekrar tekrar türetimde sallanmaz). */
  let hex = '';
  try { hex = String(inkState().color || '').toLowerCase(); } catch { hex = ''; }
  const cached = inkRadialUi.wheelSt;
  if (cached && inkRadialUi.wheelStHex === hex) return cached;
  let next = { h: 35, s: 0.72, v: 0.86 };
  try {
    if (typeof inkHexToWheelState === 'function') next = inkHexToWheelState(hex);
  } catch { /* durum henüz hazır değil */ }
  inkRadialUi.wheelSt = typeof inkWheelClampStateStable === 'function'
    ? inkWheelClampStateStable(next) : next;
  inkRadialUi.wheelStHex = hex;
  return inkRadialUi.wheelSt;
}

function inkRadialWheelPaint() {
  const canvas = inkRadialUi.wheelCanvas;
  const g = inkRadialWheelGeometry();
  if (!canvas || !g) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const st = inkRadialWheelState();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, g.px, g.px);
  /* Panel çarkıyla aynı üretimler: halka piksel tablosu + üçgen OKLCH karışımı. */
  if (typeof inkWheelRing === 'function') ctx.drawImage(inkWheelRing(g), 0, 0);
  if (typeof inkWheelTriangle === 'function') ctx.drawImage(inkWheelTriangle(g, st.h), 0, 0);
  if (typeof inkWheelHandle === 'function') {
    const a = st.h * Math.PI / 180;
    const hr = (g.outer + g.inner) / 2;
    inkWheelHandle(
      ctx,
      (g.cx + Math.cos(a) * hr) * g.dpr,
      (g.cy + Math.sin(a) * hr) * g.dpr,
      7.5 * g.dpr,
      typeof inkWheelPureCorner === 'function' ? inkWheelPureCorner(st.h).hex : '#fff'
    );
    const p = typeof inkWheelSvPoint === 'function' ? inkWheelSvPoint(g, st.s, st.v) : null;
    if (p) {
      inkWheelHandle(
        ctx, p.x * g.dpr, p.y * g.dpr, 7 * g.dpr,
        typeof inkWheelStateToHex === 'function'
          ? inkWheelStateToHex(st.h, st.s, st.v) : '#fff'
      );
    }
  }
}

function inkRadialWheelLocal(event) {
  const c = inkRadialUi.wheelCanvas;
  const g = inkRadialWheelGeometry();
  if (!c || !g || !event) return null;
  const rect = c.getBoundingClientRect();
  if (!rect.width) return null;
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

/** Hedef kimliğini çартам zondan döner: halka / üçgen / hiçbiri. */
function inkRadialWheelZone(x, y, g) {
  const d = Math.hypot(x - g.cx, y - g.cy);
  if (d >= g.inner - 2 && d <= g.outer + 2) return 'ring';
  if (typeof inkWheelBary === 'function') {
    const b = inkWheelBary(x, y, g);
    if (Math.min(b.a, b.b, b.c) >= -0.02) return 'tri';
  }
  return null;
}

/** Seçilen zondan ton/doygunluk üretip motora yazar (kaydetmek sürükleyi bitirir). */
function inkRadialWheelApply(x, y, save) {
  const g = inkRadialWheelGeometry();
  if (!g) return;
  const zone = inkRadialWheelZone(x, y, g);
  if (!zone) return;
  const st = inkRadialWheelState();
  let h = st.h;
  let s = st.s;
  let v = st.v;
  if (zone === 'ring') {
    let deg = Math.atan2(y - g.cy, x - g.cx) * 180 / Math.PI;
    h = ((deg % 360) + 360) % 360;
  } else {
    const b = inkWheelBary(x, y, g);
    const sum = b.a + b.b + b.c || 1;
    const na = Math.max(0, b.a / sum);
    const nb = Math.max(0, b.b / sum);
    const nc = Math.max(0, b.c / sum);
    s = clamp(nc, 0, 1);
    v = clamp(na + nc, s, 1);
  }
  const hex = inkWheelStateToHex(h, s, v);
  /* Öz-durum önbelleği: çarkın yazdığı hex ile yazdığı durum çifti
     elle eşleşir → ilk boya yeniden türetmez, titreme olmaz. */
  inkRadialUi.wheelSt = { h, s, v };
  inkRadialUi.wheelStHex = hex;
  if (typeof inkSetColor === 'function') inkSetColor(hex, !!save);
  inkRadialSyncColor();
}


/* =========================================================
  dock: önizleme + sürgüler
   ========================================================= */
/** Mini fırça karosu: motorun gerçek damla üretimiyle küçük
    vuruş önizlemesi (52-native-brush-library kartlarıyla aynı üretim). */
function inkRadialTile(brush, css) {
  const canvas = document.createElement('canvas');
  if (brush && typeof renderStrokePreview === 'function') {
    try {
      renderStrokePreview(canvas, brush, {
        width: css || 20,
        height: css || 20,
        dpr: Math.min(2, window.devicePixelRatio || 1),
        sizePx: clamp(Number(brush.size) * 0.16 + 1.5, 2, (css || 20) * 0.55),
      });
      return canvas;
    } catch { /* çizilemezse boş karo kalır */ }
  }
  return canvas;
}
function inkRadialPaintPreview(brush) {
  const canvas = inkRadialUi.preview;
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 90, h = 24;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!brush) return;
  let color = '#f2f2f2';
  try { color = inkState().color || color; } catch { /* varsayılan */ }
  const y0 = Math.round(h * 0.55 * dpr);
  const amp = Math.round(h * 0.9 * dpr);
  const size = Math.max(3, Math.min(14, Math.round((Number(brush.size) || 8) * 0.35))) * dpr;
  const step = Math.max(2, size * 0.55);
  let prev = null;
  for (let x = Math.round(8 * dpr); x <= Math.round(w * dpr) - 8 * dpr; x += step) {
    const t = (x / (w * dpr)) * Math.PI * 3.1;
    const y = y0 - Math.sin(t) * amp * 0.22;
    if (prev) {
      ctx.beginPath();
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      const g = ctx.createLinearGradient(prev[0], prev[1], x, y);
      g.addColorStop(0, color);
      g.addColorStop(1, color);
      ctx.strokeStyle = g;
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = [x, y];
  }
}

function inkRadialSliderRow(labelText, key) {
  const conf = {
    size: { min: 1, max: 400, step: 1 },
    opacity: { min: 0, max: 100, step: 1 },
    smoothing: { min: 0, max: 95, step: 1 },
  }[key];

  const row = document.createElement('label');
  row.className = 'inkRadialRow';

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(conf.min);
  input.max = String(conf.max);
  input.step = String(conf.step);
  input.setAttribute('aria-label', labelText);

  const out = document.createElement('output');

  input.addEventListener('input', () => {
    const value = Number(input.value) || 0;
    try {
      const ink = inkState();
      if (key === 'size') {
        ink.size = clamp(value, typeof INK_MIN_SIZE === 'number' ? INK_MIN_SIZE : 1,
          typeof INK_MAX_SIZE === 'number' ? INK_MAX_SIZE : 400);
      } else if (key === 'opacity') {
        ink.opacity = clamp(value / 100, 0, 1);
      } else {
        ink.smoothing = clamp(value / 100, 0, 0.95);
      }
    } catch { return; }
    if (typeof inkSyncUI === 'function') inkSyncUI();
    else if (typeof inkEditorInvalidate === 'function') inkEditorInvalidate();
    inkRadialSyncSliders();
  });
  input.addEventListener('change', () => {
    if (typeof scheduleSave === 'function') scheduleSave();
  });

  row.append(label, input, out);
  return { row, input, out, key };
}

/* =========================================================
   DOM
   ========================================================= */
function inkRadialBuild() {
  if (inkRadialUi.root) return inkRadialUi.root;

  const root = document.createElement('div');
  root.className = 'inkRadial';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Quick brush panel');

  /* --- cam disk --- */
  const disk = document.createElement('div');
  disk.className = 'inkRadialDisk';

  /* 4 araç yuvası — üstte fırça, sağda silgi, altta boya kovası, solda damlalık */
  const mkSlot = (pos, title, iconId, key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkRadialSlot pos-' + pos + (key === 'brush' ? ' is-brush' : '');
    btn.title = title;
    btn.setAttribute('aria-label', title);
    if (key !== 'brush' && typeof inkIcon === 'function') {
      btn.innerHTML = inkIcon(iconId);
    }
    btn.addEventListener('click', event => {
      event.preventDefault();
      if (key === 'brush') {
        if (typeof inkSetTool === 'function') inkSetTool('brush');
      } else if (typeof inkSetTool === 'function') {
        inkSetTool(key);
      }
      setTimeout(inkRadialClose, 150);
    });
    disk.appendChild(btn);
    inkRadialUi.slotButtons[key] = btn;
    return btn;
  };
  mkSlot('n', 'Brush', 'ink-brush', 'brush');
  mkSlot('e', 'Eraser', 'ink-eraser', 'eraser');
  mkSlot('s', 'Paint bucket', 'ink-fill', 'fill');
  mkSlot('w', 'Eyedropper', 'ink-dropper', 'dropper');
  inkRadialUi.brushBtn = inkRadialUi.slotButtons.brush;

  /* Fırça kapsülü (son fırçalar + adları) — üst yuvanın üstünde açılır.
     bridge: yuva ↔ kapsül arası Pointer geçişi koparmayan görünmez eşik */
  const bridge = document.createElement('span');
  bridge.className = 'inkRadialBridge';
  const capsule = document.createElement('div');
  capsule.className = 'inkRadialCapsule';
  capsule.hidden = false;
  inkRadialUi.capsule = capsule;
  inkRadialUi.capsuleButtons = [];
  for (let i = 0; i < INK_RADIAL_SLOTS; i += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inkRadialSub';
    /* Karo + ad: hangi fırça hangisi sorusunu bulûtlaştırmayan başlıklar */
    const subName = document.createElement('span');
    subName.className = 'inkRadialSubName';
    btn.append(subName);
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const brushId = btn.dataset.brushId;
      if (brushId && typeof inkRadialSelect === 'function') inkRadialSelect(brushId);
      setTimeout(inkRadialClose, 140);
    });
    capsule.appendChild(btn);
    inkRadialUi.capsuleButtons.push(btn);
  }
  disk.append(bridge, capsule);

  /* merkez renk diski: düz swatch; hover'da (is-color) klasik çark açılır */
  const color = document.createElement('div');
  color.className = 'inkRadialColor';
  color.title = 'Color — open the core: full color wheel';
  const core = document.createElement('button');
  core.type = 'button';
  core.className = 'inkRadialColorDisc';
  core.title = 'Open color wheel';
  core.setAttribute('aria-label', 'Open color wheel');
  core.addEventListener('click', event => {
    event.preventDefault();
    if (typeof inkOpenColorWheel === 'function') {
      inkOpenColorWheel(color);
    }
  });
  color.appendChild(core);
  /* klasik çark: ton halkası + OKLCH üçgeni (panel çarkıyla aynı çizim) */
  const wheel = document.createElement('canvas');
  wheel.className = 'inkRadialWheel';
  wheel.setAttribute('aria-label', 'Color wheel');
  color.appendChild(wheel);
  inkRadialUi.color = color;
  inkRadialUi.colorDisc = core;
  inkRadialUi.wheelCanvas = wheel;
  disk.appendChild(color);

  /* merkez hover: çarkı göster + yuvaları sönükleştir */
  color.addEventListener('pointerenter', () => {
    disk.classList.add('is-color');
    inkRadialWheelPaint();
  });
  color.addEventListener('pointerleave', () => {
    if (inkRadialWheelId === null) disk.classList.remove('is-color');
  });

  /* çark sürüklemesi: halka = ton, üçgen = doygunluk/parlaklık */
  wheel.addEventListener('pointerdown', event => {
    const g = inkRadialWheelGeometry();
    if (!g) return;
    const local = inkRadialWheelLocal(event);
    if (!local || !inkRadialWheelZone(local.x, local.y, g)) return;
    event.preventDefault();
    event.stopPropagation();
    inkRadialWheelId = event.pointerId;
    inkRadialWheelMode = inkRadialWheelZone(local.x, local.y, g);
    try { wheel.setPointerCapture(event.pointerId); } catch { /* sessiz */ }
    disk.classList.add('is-color');
    inkRadialWheelApply(local.x, local.y, false);
  });
  wheel.addEventListener('pointermove', event => {
    if (inkRadialWheelId !== event.pointerId) return;
    const local = inkRadialWheelLocal(event);
    if (local) inkRadialWheelApply(local.x, local.y, false);
  });
  const wheelEnd = event => {
    if (inkRadialWheelId !== event.pointerId) return;
    const local = inkRadialWheelLocal(event);
    if (local) inkRadialWheelApply(local.x, local.y, true);
    inkRadialWheelId = null;
    inkRadialWheelMode = null;
    try { wheel.releasePointerCapture(event.pointerId); } catch { /* sessiz */ }
    if (!color.matches(':hover')) disk.classList.remove('is-color');
  };
  wheel.addEventListener('pointerup', wheelEnd);
  wheel.addEventListener('pointercancel', wheelEnd);

  /* --- disk altı yuva: önizleme + ad + sürgüler --- */
  const dock = document.createElement('div');
  dock.className = 'inkRadialDock';
  const head = document.createElement('div');
  head.className = 'inkRadialHead';
  const preview = document.createElement('canvas');
  preview.className = 'inkRadialPreview';
  const name = document.createElement('div');
  name.className = 'inkRadialName';
  head.append(preview, name);
  const sliders = document.createElement('div');
  sliders.className = 'inkRadialSliders';
  inkRadialUi.rows = [
    inkRadialSliderRow('Size', 'size'),
    inkRadialSliderRow('Opacity', 'opacity'),
    inkRadialSliderRow('Smoothing', 'smoothing'),
  ];
  for (const item of inkRadialUi.rows) sliders.appendChild(item.row);
  dock.append(head, sliders);

  root.append(disk, dock);
  document.body.appendChild(root);

  inkRadialUi.root = root;
  inkRadialUi.disk = disk;
  inkRadialUi.dock = dock;
  inkRadialUi.preview = preview;
  inkRadialUi.name = name;
  return root;
}

function inkRadialSyncColor() {
  if (!inkRadialUi.colorDisc) return;
  let hex = '#f2f2f2';
  try { hex = inkState().color || hex; } catch { /* varsayılan */ }
  inkRadialUi.colorDisc.style.background = hex;
  /* çark görünürse (is-color) tutamaçları da tazele */
  if (inkRadialUi.open && inkRadialUi.disk &&
      inkRadialUi.disk.classList.contains('is-color')) {
    inkRadialWheelPaint();
  }
}

function inkRadialSyncSliders() {
  if (!inkRadialUi.open) return;
  let ink;
  try { ink = inkState(); } catch { return; }
  for (const item of inkRadialUi.rows) {
    let value = 0;
    let text = '';
    if (item.key === 'size') {
      value = Math.round(ink.size);
      text = Math.round(ink.size) + ' px';
    } else if (item.key === 'opacity') {
      value = Math.round(ink.opacity * 100);
      text = Math.round(ink.opacity * 100) + '%';
    } else {
      value = Math.round(ink.smoothing * 100);
      text = Math.round(ink.smoothing * 100) + '%';
    }
    const min = Number(item.input.min) || 0;
    const max = Number(item.input.max) || 100;
    const pct = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0;
    item.input.value = String(value);
    item.input.style.setProperty('--fill', pct + '%');
    item.out.textContent = text;
  }
}

function inkRadialRender() {
  if (!inkRadialUi.open) return;

  /* kapsül: son fırçalar */
  const list = inkRadialRecentList();
  const capsule = inkRadialUi.capsule;
  if (capsule) {
    /* kapsül: yatay taş dizisi — son fırçalar sırayla */
    inkRadialUi.capsuleButtons.forEach((btn, index) => {
      const brush = list[index];
      if (!brush) { btn.hidden = true; btn.dataset.brushId = ''; return; }
      btn.hidden = false;
      btn.dataset.brushId = brush.id;
      btn.title = brush.name || brush.id;
      btn.setAttribute('aria-label', brush.name || brush.id);
      /* karo + fırça adı: yapraklar yerine okunur başlıklar */
      const subName = btn.querySelector('.inkRadialSubName');
      if (subName) subName.textContent = brush.name || brush.id;
      btn.replaceChildren(inkRadialTile(brush), ...(subName ? [subName] : []));
    });
  }

  /* üst yuva: geçerli fırça karo önizlemesi */
  let brushId = '';
  try { brushId = inkState().brushId; } catch { brushId = ''; }
  let tool = 'brush';
  try { tool = inkState().tool; } catch { tool = 'brush'; }
  /* alt merkez: geçerli fırça (ad + sürgü önizlemesi de bundan beslenir) */
  let brush = null;
  try { brush = inkGetBrush(brushId); } catch { brush = null; }
  const brushBtn = inkRadialUi.slotButtons.brush;
  if (brushBtn) {
    brushBtn.replaceChildren(inkRadialTile(brush));
  }
  for (const [key, btn] of Object.entries(inkRadialUi.slotButtons)) {
    if (!btn) continue;
    const active = (key === 'brush')
      ? (tool === 'brush' || tool === 'pencil')
      : key === tool;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  /* yuva: ad + sürgüler + renk tazelensin */
  if (inkRadialUi.name) inkRadialUi.name.textContent = brush ? brush.name : 'Brush';
  inkRadialPaintPreview(brush);
  inkRadialSyncSliders();
  inkRadialSyncColor();
  /* kapsülde aktif fırça işareti */
  if (capsule) {
    inkRadialUi.capsuleButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.brushId === brushId);
      btn.setAttribute('aria-pressed', btn.dataset.brushId === brushId ? 'true' : 'false');
    });
  }
}

/* =========================================================
   aç / kapat / seç
   ========================================================= */
function inkRadialIsOpen() {
  return !!inkRadialUi.open;
}

function inkRadialOpen(x, y) {
  if (typeof modeIsDraw === 'function' && !modeIsDraw()) return false;
  if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return false;
  const root = inkRadialBuild();
  /* Yerleşim: disk merkezi imlece; en alt (dock) ekrana sığdırılır.
     Üst pay: kapsül disk tepesinden taşar (INK_RADIAL_TOP_PAD). */
  root.hidden = false;
  const total = root.offsetHeight || (INK_RADIAL_DISK + 8 + 150);
  const pad = 10;
  const left = clamp(Number(x) - INK_RADIAL_DISK / 2, pad,
    Math.max(pad, window.innerWidth - INK_RADIAL_DISK - pad));
  const topMin = INK_RADIAL_TOP_PAD + pad - INK_RADIAL_DISK / 2 + 30;
  const top = clamp(Number(y) - INK_RADIAL_DISK / 2, Math.max(pad, topMin),
    Math.max(1, window.innerHeight - total - pad));
  root.style.left = Math.round(left) + 'px';
  root.style.top = Math.round(top) + 'px';
  inkRadialUi.open = true;
  inkRadialRender();
  // Geçişin çalışması için bir kare beklemeden sınıf eklenir.
  void root.offsetWidth;
  root.classList.add('is-open');
  // Panel açıkken fırça halkası ekranda başıboş kalmasın.
  if (typeof inkEditorClearCursorArea === 'function') inkEditorClearCursorArea();
  return true;
}

function inkRadialClose() {
  const root = inkRadialUi.root;
  inkRadialUi.open = false;
  if (inkRadialUi.disk) inkRadialUi.disk.classList.remove('is-color');
  // Kapanıştan sonra eski imleç konumunda halka yeniden doğmasın.
  if (typeof inkEditorUi !== 'undefined' && inkEditorUi) inkEditorUi.lastClient = null;
  if (typeof inkEditorClearCursorArea === 'function') inkEditorClearCursorArea();
  if (!root) return;
  root.classList.remove('is-open');
  root.hidden = true;
}

function inkRadialSelect(brushId) {
  const brushes = inkRadialValidBrushes();
  const brush = brushes.find(item => item.id === brushId);
  if (!brush) return;
  const tool = brush.id === 'ink-pencil' ? 'pencil' : 'brush';
  if (typeof inkSetTool === 'function') inkSetTool(tool, { brushId: brush.id });
  inkRadialTouch(brush.id);
  inkRadialRender();
}

/* =========================================================
   olaylar + WACOM teması nöbeti
   ========================================================= */
function inkRadialContactAllowed(event) {
  /* Gerçek tuş basışı mı? Kalem ucu temasta (çizim sürüyor) ya da
     az önce kalktıysa (Windows uzun basma → sağ tık sentezi) açılmaz. */
  if (event && (event.buttons & 1)) return false;
  if (inkRadialContact.down) return false;
  if (Date.now() - inkRadialContact.lastUp < INK_RADIAL_CONTACT_HUSH) return false;
  return true;
}

function inkRadialTargetOk(target) {
  if (!target) return true;
  /* Kendi sağ tık menüsü olan panellere dokunma. Referans panosu da
     hariç: kullanıcı isteği — çizim modunda pano üzerinde ne sağ tık
     ne sol tık (kalem uzun basışı sentezi) radyal menüyü açmaz. */
  return !target.closest(
    '#inkLayersPanel, #inkToolbox, .inkDock, .inkPanel, .v5-panel, .v5-toolbar, .v5-shell, #inkScopeBar, ' +
    '#nativeBrushLibrary, .nbContextMenu, #psReferencePanel, #v5OptionsBar, ' +
    '#inkLayerPropsDialog, #inkColorWheel, .v5-menu, #inkPowerSliders'
  );
}

/* v5 çizim kabuğunda gerçek tahta (#stage) referans panelinin
   dikdörtgenine kırpılır (ps-ref-live) — imleç mini panonun üzerindeyken
   olay hedefi panelin DOM ağacında DEĞİL, tahtada; closest() dışlaması
   bu yüzden işlemez. Kullanıcı raporu: sağ/orta tık mini panoda fırça
   menüsü açıyordu. Geometrik kapı: tık kırpma penceresinin içindeyse
   menü açılmaz (kullanıcı isteği: panoda hiçbir tık menü açmaz). */
function inkRadialRefApertureHit(event) {
  if (!event) return false;
  if (typeof modeIsDraw === 'function' && !modeIsDraw()) return false;
  if (!document.body.classList.contains('ps-ref-live')) return false;
  const rect = typeof dpApertureRect === 'function' ? dpApertureRect() : null;
  if (!rect) return false;
  return event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function inkRadialBind() {
  if (inkRadialUi.bound) return;
  inkRadialUi.bound = true;

  /* Kalem teması nöbeti: her pointerdown (uç teması) menü açılışını
     hush moduna sokar; kalkıştan 300ms sonra hafifler. */
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return; // yalnız uç/ağır basış
    inkRadialContact.down = true;
    inkRadialContact.id = event.pointerId;
  }, true);
  const contactEnd = event => {
    if (event.button !== 0 && event.pointerId !== inkRadialContact.id) return;
    inkRadialContact.down = false;
    inkRadialContact.lastUp = Date.now();
    inkRadialContact.id = null;
  };
  document.addEventListener('pointerup', contactEnd, true);
  document.addEventListener('pointercancel', contactEnd, true);

  document.addEventListener('contextmenu', event => {
    if (typeof modeIsDraw === 'function' && !modeIsDraw()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('.inkRadial')) {
      event.preventDefault();
      return;
    }
    if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return;
    if (target && target.closest('input, textarea, [contenteditable="true"], select')) return;
    if (!inkRadialTargetOk(target)) return;
    /* Mini referans panosu: menü açılmaz; yalnız doğal menü yutulur. */
    event.preventDefault();
    event.stopPropagation();
    if (inkRadialRefApertureHit(event)) return;
    if (!inkRadialContactAllowed(event)) return;
    inkRadialOpen(event.clientX, event.clientY);
  }, true);

  /* Orta tık (kalem tuşu / fare tekeri) de menüyü açar. Pan sürüklemesi
     yapıldıysa bırakışın auxclick'i menü isteği değildir — susturulur. */
  document.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    if (Date.now() < inkRadialAuxHushUntil) return;
    if (typeof modeIsDraw === 'function' && !modeIsDraw()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (typeof inkEditorIsOpen === 'function' && !inkEditorIsOpen()) return;
    if (target && target.closest('input, textarea, [contenteditable="true"], select')) return;
    if (!inkRadialTargetOk(target)) return;
    /* Mini referans panosu: menü açılmaz; orta tık autoscroll da yutulur. */
    event.preventDefault();
    event.stopPropagation();
    if (inkRadialRefApertureHit(event)) return;
    if (!inkRadialContactAllowed(event)) return;
    inkRadialOpen(event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!inkRadialUi.open) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && inkRadialUi.root && inkRadialUi.root.contains(target)) return;
    inkRadialClose();
  }, true);

  /* Escape = en üstteki UI'ı iptal et (uygulama geneli kural). Radial
     açıkken Escape yalnızca menüyü kapatır ve olayı yutar. */
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !inkRadialUi.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inkRadialClose();
  }, true);

  window.addEventListener('blur', () => {
    if (inkRadialUi.open) inkRadialClose();
  });

  window.addEventListener('resize', () => {
    if (inkRadialUi.open) inkRadialClose();
  });
}

inkRadialBind();
