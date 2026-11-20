/* =========================================================
   61-perf-diag.js — Ctrl+Alt+P gizli teşhis paneli
   ---------------------------------------------------------
   Kullanıcı dostu, sade Türkçe ölçüm paneli. Her zamanki
   Alt+P geliştirici HUD'ı (32-ink-perf.js) yerinde kalır;
   bu panel onun SAYAÇLARINI okuyup insan diline çevirir
   (commit ms → "fırça gecikmesi" gibi). Ayrıca 3D ve kayıt
   tarafını da ekler.

   Kontratlar:
   • Görüntüye kapalıyken SIFIR dokunuş: panel yalnız
     Ctrl+Alt+P ile üretilir; kapalıyken zamanlayıcı da yok.
   • Açıkken bile ölçüm pahalıdır: saniyede ~2 tick, dizi
     push'ları ve birkaç nesne okuması. Panel açıkken FPS
     düşmemeli (gates/smoke ölçer).
   • pointer-events: none — çizimi asla engellemez.
   • Konum: sol alt köşe. Yalnız oturum içinde kalır
     (kalıcılık yok); Ayarlar'a gereksiz kalabalık olmasın.

   Okunan kaynaklar:
   • 3D  : __pose3dDebug.viewport._renderTimes → gerçek FPS;
           renderer.info (draw call, üçgen, doku/geometri),
           window.tailrefPose3dPerf.level() → kalite + mod
   • 2D  : inkPerf.counters → commit MS son penceresi
           (medyan), dabs; inkState katman sayısı
   • Bildirimen: __tailrefLastSaveStats { ms, kb }
   • Bellek: performance.memory.usedJSHeapSize
   ========================================================= */
'use strict';

window.tailrefPerfDiagToggle = function tailrefPerfDiagToggle(force) {
  const el = tailrefPerfDiagEnsure();
  const on = typeof force === 'boolean' ? force : el.hidden;
  el.hidden = !on;
  el.dataset.on = String(on);
  if (on) {
    tailrefPerfDiagStart();
  } else {
    tailrefPerfDiagStop();
  }
  return on;
};

const PERF_DIAG_INTERVAL = 500;          // saniyede ~2 tick
const tailrefPerfDiagState = {
  timer: 0,
  hist: [],                              // grafik: {fps|null} örnekleri
  maxHist: 120,                          // 60 sn pencere (0.5s adım)
  canvas: null,
};

function tailrefPerfDiagEnsure() {
  let el = document.getElementById('perfDiag');
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.id = 'perfDiag';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  el.dataset.on = 'false';
  el.style.cssText = [
    'position:fixed', 'left:14px', 'bottom:14px', 'z-index:12000',
    'min-width:252px', 'max-width:320px', 'padding:10px 12px',
    'border-radius:12px', 'font:12px/1.5 system-ui,sans-serif',
    'color:var(--text,#e8e8f0)', 'pointer-events:none',
    'background:color-mix(in srgb, var(--bg,#101018) 82%, transparent)',
    'border:1px solid var(--border,rgba(255,255,255,.14))',
    'box-shadow:0 8px 28px rgba(0,0,0,.35)',
    'backdrop-filter:blur(18px) saturate(150%)',
    '-webkit-backdrop-filter:blur(18px) saturate(150%)',
    'user-select:none',
  ].join(';');
  el.innerHTML = `
    <div data-head style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">
      <b style="letter-spacing:.01em">Diagnostics</b>
      <span style="opacity:.65">close: Ctrl+Alt+P</span>
    </div>
    <div data-summary style="margin:2px 0 8px;font-weight:600"></div>
    <canvas data-graph width="240" height="40" style="display:block;width:100%;height:40px;border-radius:6px;margin-bottom:8px;opacity:.9"></canvas>
    <div data-rows style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;white-space:nowrap"></div>
    <div data-stamp style="margin-top:6px;opacity:.6;font-size:11px"></div>`;
  document.body.appendChild(el);
  tailrefPerfDiagState.canvas = el.querySelector('[data-graph]');
  /* Yapı damgası: hangi paket koşuyor? (tek örnek kilidi yüzünden eski
     pencerede kalındığında tespit için.) */
  const _stampEl = el.querySelector('[data-stamp]');
  try {
    const api = window.tailref;
    if (_stampEl && api && typeof api.getBuildStamp === 'function') {
      api.getBuildStamp().then(stamp => {
        if (stamp) _stampEl.textContent = 'Build: ' + stamp;
      }).catch(() => {});
    }
  } catch { /* dev modda sessiz */ }
  return el;
}

/* ---- veri toplayıcıları ---- */

function diagVp() {
  return window.__pose3dDebug?.viewport || null;
}

function diagFps3d(now) {
  const vp = diagVp();
  if (!vp) return null;
  const times = vp._renderTimes || [];
  let i = times.length - 1, count = 0;
  while (i >= 0 && now - times[i] <= 1000) { count++; i--; }
  if (count <= 0) return 0;              // 3D açık, ama son 1 sn kare çizilmedi → boşta
  return count;                          // son 1 sn çizilen kare sayısı ≈ FPS
}

function diag3dInfo() {
  const vp = diagVp();
  if (!vp) return null;
  const r = vp.renderer?.info || null;
  const calls = r?.render?.calls ?? null;
  const tris = r?.render?.triangles ?? null;
  const tex = r?.memory?.textures ?? null;
  const geo = r?.memory?.geometries ?? null;
  const quality = window.tailrefPose3dPerf?.level
    ? String(window.tailrefPose3dPerf.level()) : null;
  const mode = String((() => { try { return localStorage.getItem('tailref-q3d-level') || 'auto'; } catch { return 'auto'; } })());
  const levelLbl = { low: 'Low', medium: 'Medium', high: 'High', auto: '' }[quality] || quality;
  const modeNote = mode !== 'auto' ? __t(' · manual') : __t(' · Auto');
  return { calls, tris, tex, geo, quality: quality ? levelLbl + modeNote : null };
}

function diagBrush() {
  const c = inkPerf.counters || {};
  const recent = c.commitRecent;
  const fmt = ms => (Math.round(ms * 10) / 10).toFixed(1);
  if (!recent || !recent.length) return { commit: null, dabs: c.dabs || 0 };
  const s = recent.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const max = s[s.length - 1];
  return { commit: { med, max }, dabs: c.dabs || 0 };
}

function diagSummary(fps3d, brush) {
  const parts = [];
  let status = null;
  if (fps3d != null) {
    /* Talep-temelli döngü: boştayken nadir tekil kareler düşer (1-5 FPS
       saniye başı kare sayısı olarak). Gerçek kasma SÜREKLI düşük akışla
       gelir; nadir kareler = bekleme. */
    if (fps3d < 8) status = 'Idle — 3D idle (measured on movement)';
    else status = fps3d >= 45 ? 'Currently smooth' : fps3d >= 25 ? 'Currently medium' : 'Currently stuttering';
  } else if (brush?.commit) {
    const med = brush.commit.med;
    status = med >= 34 ? 'Currently stuttering (drawing)' : med >= 17 ? 'Currently medium (drawing)' : 'Currently smooth';
  } else {
    return 'Idle — measured when you draw or switch to 3D';
  }
  parts.push(status);
  if (brush?.commit) parts.push(`brush ${brush.commit.med.toFixed(1)} ms`);
  if (fps3d != null && fps3d >= 8) parts.push(`${fps3d} FPS`);
  const heap = diagHeap();
  if (heap != null) parts.push(`bellek ${heap} MB`);
  return parts.join(' · ');
}

function diagHeap() {
  try {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
  } catch { return null; }
}

/* mini grafik: son örnekler (0,5 sn adım) — 60 FPS üst sınırlı */
function diagDrawGraph(now) {
  const cv = tailrefPerfDiagState.canvas;
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const css = getComputedStyle(document.body);
  const colText = css.getPropertyValue('--text') || '#e8e8f0';
  const colDim = css.getPropertyValue('--border') || 'rgba(255,255,255,.2)';
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = colDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 1); ctx.lineTo(w - 1, h - 1); ctx.stroke();
  /* ölçek: 60 FPS üst sınır */
  const max = 60;
  ctx.strokeStyle = colText;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let began = false, any = false;
  const hist = tailrefPerfDiagState.hist;
  for (let i = 0; i < hist.length; i++) {
    const v = hist[i];
    if (v == null) { began = false; continue; }
    any = true;
    const x = w - (hist.length - 1 - i) * (w / (tailrefPerfDiagState.maxHist - 1));
    const y = h - 2 - Math.min(v, max) / max * (h - 4);
    if (!began) { ctx.moveTo(x, y); began = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (!any) {
    ctx.fillStyle = colDim;
    ctx.font = '10px system-ui';
    ctx.fillText('idle', 6, h - 8);
  }
}

/* ---- panel güncelleyici ---- */
function tailrefPerfDiagUpdate() {
  const el = document.getElementById('perfDiag');
  if (!el || el.hidden) return;
  const now = performance.now();
  const fps3d = diagFps3d(now);
  const brush = diagBrush();
  const info = diag3dInfo();

  /* grafik örneği: 3D varsa gerçek FPS; yoksa null (çizgi kırılır). */
  const hist = tailrefPerfDiagState.hist;
  hist.push(fps3d);
  if (hist.length > tailrefPerfDiagState.maxHist) hist.shift();
  diagDrawGraph(now);

  el.querySelector('[data-summary]').textContent = diagSummary(fps3d, brush);

  const rows = el.querySelector('[data-rows]');
  const lines = [];
  /* FPS satırı: 3D açıkken gerçek kare hızı (yalnız çizilen kareler);
     0 = talep-temelli döngü boşta, kare çizilmiyor */
  if (fps3d != null) lines.push(['3D FPS', fps3d >= 8 ? String(fps3d) : 'idle']);
  if (brush.commit) {
    lines.push(['Brush (stroke processing)', `${brush.commit.med.toFixed(1)} ms ort · max ${brush.commit.max.toFixed(1)} ms`]);
  }
  lines.push(['Brush dabs (session)', String(brush.dabs)]);
  if (info) {
    lines.push(['3D draw load',
      `draw call ${info.calls ?? '—'} · triangles ${info.tris == null ? '—' : info.tris.toLocaleString('en-US')}`]);
    lines.push(['3D VRAM', `doku ${info.tex ?? '—'} · geometri ${info.geo ?? '—'}`]);
    if (info.quality) lines.push(['3D quality', info.quality]);
  }
  const heap = diagHeap();
  if (heap != null) lines.push(['Bellek (JS)', `${heap} MB`]);
  const save = window.__tailrefLastSaveStats || null;
  lines.push(['Last record', save ? `${save.ms} ms · ${save.kb} KB` : 'no records yet']);
  /* Açılış damgaları: zayıf makinelerde hangi aşamanın ağır olduğunu
     panelde görünür kılar (kullanıcı raporu için). */
  const bootMarks = (window.__bootMarks || []).slice(0, 20);
  if (bootMarks.length) lines.push(['Boot stamps', bootMarks.join(' · ')]);
  try {
    const api = window.inkV5Settings;
    const tile = api?.tileSizeResolved ? Number(api.tileSizeResolved()) : 0;
    const mode = api ? String(api.tileSize?.() || 'auto') : 'auto';
    const tileLbl = mode !== 'auto'
      ? ({ '128': 'Small (128)', '256': 'Orta (256)', '512': 'Large (512)' }[mode] || mode)
      : (tile ? `Otomatik → ${tile <= 128 ? 'Small' : tile <= 256 ? 'Medium' : 'Large'}` : 'Auto');
    lines.push(['Karo', tileLbl]);
  } catch { /* sessiz */ }
  /* Ctrl+Z teşhis: son tuş vuruşu + son undo/redo çağrısı + yığın durumu.
     "Tuş ulaştı mı?" ve "undo çağrıldı mı?" gözle doğrulanır. */
  try {
    const dbg = window.__undoDebug;
    if (dbg) {
      const lastKey = dbg.keys[dbg.keys.length - 1] || null;
      if (lastKey) {
        lines.push(['Last key',
          `${lastKey.ctrl ? 'Ctrl+' : ''}${lastKey.key} · trusted: ${lastKey.trusted ? 'keyboard ✓' : 'synthetic ✗'}` +
          ` · target: ${lastKey.target || '—'}`]);
      }
      const lastCall = dbg.calls[dbg.calls.length - 1] || null;
      lines.push(['Last undo call',
        lastCall ? `${lastCall.name} · stack: ${lastCall.stack}` : 'never called']);
      if (Array.isArray(window.__inkFrameJank)) {
        const j = window.__inkFrameJank;
        lines.push(['Frame cuts (25 ms+)', `${j.length} records` +
          (j.length ? ` · last: ${j[j.length - 1].ms} ms` : '')]);
      }
    }
  } catch { /* sessiz */ }

  rows.innerHTML = '';
  for (const [k, v] of lines) {
    const a = document.createElement('span');
    a.style.cssText = 'opacity:.65';
    a.textContent = k;
    const b = document.createElement('span');
    b.style.cssText = 'text-align:right;overflow:hidden;text-overflow:ellipsis';
    b.textContent = v;
    rows.append(a, b);
  }
}

function tailrefPerfDiagStart() {
  if (tailrefPerfDiagState.timer) return;
  tailrefPerfDiagState.hist = [];
  tailrefPerfDiagUpdate();
  tailrefPerfDiagState.timer = setInterval(tailrefPerfDiagUpdate, PERF_DIAG_INTERVAL);
}

function tailrefPerfDiagStop() {
  if (!tailrefPerfDiagState.timer) return;
  clearInterval(tailrefPerfDiagState.timer);
  tailrefPerfDiagState.timer = 0;
  tailrefPerfDiagState.hist = [];
}

/* Kısayol: Ctrl+Alt+P. Dev HUD'un Alt+P kuralıyla çakışmaz — o işleyici
   Ctrl basılıyken zaten çıkış yapar (32-ink-perf.js:187). */
window.addEventListener('keydown', e => {
  if (!e.ctrlKey || !e.altKey || e.metaKey) return;
  if (e.code !== 'KeyP' || e.repeat) return;
  e.preventDefault();
  tailrefPerfDiagToggle();
}, true);

/* Sayfa kapanırken zamanılayıcıyı bırak (temizlik). */
window.addEventListener('pagehide', () => tailrefPerfDiagStop());
