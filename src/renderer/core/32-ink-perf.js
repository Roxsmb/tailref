/* TailRef app · çizim performans sayaçları ve HUD
   ------------------------------------------------------------------
   Faz 0 — ölçüm altyapısı.

   Amaç: çizim motorunda yapılan her iyileştirmenin etkisini sayı ile
   görebilmek. Sayaçlar kapalıyken de ucuzdur (düz sayı artırımı);
   zaman ölçümü yalnızca commit / yeniden raster gibi "seyrek" işlerde
   yapılır, damla (dab) döngüsünde performance.now() çağrılmaz.

   • `inkPerfCount(name, n)`        sayaç artır
   • `inkPerfSpan(name, ms)`        süre ölçümü (count + toplam + max)
   • `Alt+P`                        HUD'ı aç/kapat
   • `inkPerfReset()`               sayaçları sıfırla
   • `scripts/ink-bench.js`         aynı sayaçları okuyup rapor üretir

   Ölçülen olaylar: commit (vuruşu katmana işleme), rebuild (katmanı tam
   yeniden raster), dirty (kısmi raster), undoSnap (geri al anlık görüntüsü),
   dabs / pathStrokes (damla ve yol çizimi), tint / stamp isabet oranı.
   ========================================================= */
'use strict';

const inkPerf = {
  hud: false,
  el: null,
  raf: 0,
  lastHudAt: 0,
  frame: { last: 0, fps: 0, frames: 0, acc: 0 },
  counters: Object.create(null),
};

function inkPerfReset() {
  inkPerf.counters = Object.create(null);
  inkPerf.frame.fps = 0;
  inkPerf.frame.frames = 0;
  inkPerf.frame.acc = 0;
  inkPerf.frame.last = 0;
}

/** Sayaç artır. `name` örn. 'dabs', 'tileCreates', 'tintHits'. */
function inkPerfCount(name, n = 1) {
  inkPerf.counters[name] = (inkPerf.counters[name] || 0) + n;
}

/** Süre ölçümü: nameCount / nameMs / nameMaxMs alanlarını günceller.
    Ayrıca son 10 ölçümü "Recent" penceresine yazar: teşhis paneli
    (Ctrl+Alt+P) "şu an" değerini tüm-oturum ortalaması yerine bu
    pencereden okur. */
function inkPerfSpan(name, ms) {
  if (!(ms >= 0)) return;
  const c = inkPerf.counters;
  c[name + 'Count'] = (c[name + 'Count'] || 0) + 1;
  c[name + 'Ms'] = (c[name + 'Ms'] || 0) + ms;
  if (ms > (c[name + 'MaxMs'] || 0)) c[name + 'MaxMs'] = ms;
  const recentKey = name + 'Recent';
  const recent = c[recentKey] || (c[recentKey] = []);
  recent.push(ms);
  if (recent.length > 10) recent.shift();
}

function inkPerfAvg(name) {
  const c = inkPerf.counters;
  const n = c[name + 'Count'] || 0;
  return n ? (c[name + 'Ms'] || 0) / n : 0;
}

function inkPerfSnapshot() {
  const c = inkPerf.counters;
  const ink = typeof inkState === 'function' ? inkState() : null;
  let strokes = 0;
  let points = 0;
  let attached = 0;
  let global = 0;
  if (ink) {
    for (const layer of ink.layers) {
      strokes += layer.strokes ? layer.strokes.length : 0;
      if (layer.strokes) {
        for (const s of layer.strokes) points += s.points ? s.points.length : 0;
      }
      if (layer.kind === 'attached') attached++;
      else global++;
    }
  }
  const mem = typeof performance !== 'undefined' && performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1048576)
    : null;
  const stamp = typeof inkStampCacheInfo === 'function' ? inkStampCacheInfo() : null;
  return {
    counters: { ...c },
    avg: {
      commitMs: inkPerfAvg('commit'),
      rebuildMs: inkPerfAvg('rebuild'),
      undoSnapMs: inkPerfAvg('undoSnap'),
      dirtyMs: inkPerfAvg('dirty'),
      glMs: inkPerfAvg('glPreview'),
    },
    fps: Math.round(inkPerf.frame.fps * 10) / 10,
    layers: ink ? ink.layers.length : 0,
    attachedLayers: attached,
    globalLayers: global,
    strokes,
    points,
    tiles: inkRuntime ? inkRuntime.tiles.size : 0,
    itemCanvases: inkRuntime ? inkRuntime.itemCanvases.size : 0,
    dirtyLayers: typeof inkDirty !== 'undefined' ? inkDirty.layers.size : 0,
    stamp,
    heapMb: mem,
  };
}

/* =========================================================
   HUD
   ========================================================= */
function inkPerfEnsureHud() {
  if (inkPerf.el && inkPerf.el.isConnected) return inkPerf.el;
  const el = document.createElement('div');
  el.id = 'inkPerfHud';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  document.body.appendChild(el);
  inkPerf.el = el;
  return el;
}

function inkPerfHudLines() {
  const s = inkPerfSnapshot();
  const c = s.counters;
  const pct = (hit, total) => total ? Math.round((hit / total) * 100) : 0;
  const tintHit = c.tintHits || 0;
  const tintMiss = c.tintMisses || 0;
  const tintTotal = tintHit + tintMiss;
  const stampHit = c.stampHits || 0;
  const stampMiss = c.stampMisses || 0;
  const stampTotal = stampHit + stampMiss;
  const fmt = ms => (Math.round(ms * 10) / 10).toFixed(1);
  return [
    'ink perf · Alt+P',
    'fps ' + s.fps.toFixed(1) + '  heap ' + (s.heapMb == null ? '—' : s.heapMb + ' MB'),
    'commit ' + fmt(s.avg.commitMs) + ' ms  (max ' + fmt(c.commitMaxMs || 0) + ')  ×' + (c.commitCount || 0),
    'dab ' + (c.dabs || 0) + '  path ' + (c.pathStrokes || 0) + ' live ' + (c.liveDabs || 0),
    'preview ' + fmt(s.avg.glMs) + ' ms  gpu dabs ' + (c.glDabs || 0) +
      '  textures' + (typeof inkDabGlStats === 'function' ? inkDabGlStats().textures : 0),
    'damga %' + pct(stampHit, stampTotal) + '  (' + stampHit + '/' + stampTotal + ')  atlas ' + (s.stamp ? s.stamp.size : 0),
    'rebuild ' + fmt(s.avg.rebuildMs) + ' ms  (max ' + fmt(c.rebuildMaxMs || 0) + ')  ×' + (c.rebuildCount || 0),
    'kirli ' + fmt(s.avg.dirtyMs) + ' ms  ×' + (c.dirtyFlushes || 0) + '  bekleyen ' + s.dirtyLayers,
    'undo snap ' + fmt(s.avg.undoSnapMs) + ' ms  ' + Math.round((c.undoSnapBytes || 0) / 1024) + ' KB',
    'restore ' + fmt(inkPerfAvg('restoreDiff')) + ' ms  incremental ' +
      (c.incrementalRestores || 0) + ' / full ' + (c.fullRestores || 0),
    'tint %' + pct(tintHit, tintTotal) + '  (' + tintHit + '/' + tintTotal + ')',
    'layer ' + s.layers + ' stroke ' + s.strokes + '  points ' + s.points + '  karo ' + s.tiles,
  ];
}

function inkPerfUpdateHud(now) {
  if (!inkPerf.hud) return;
  inkPerf.frame.frames++;
  inkPerf.frame.acc += now - (inkPerf.frame.last || now);
  inkPerf.frame.last = now;
  if (inkPerf.frame.acc >= 500) {
    inkPerf.frame.fps = (inkPerf.frame.frames * 1000) / inkPerf.frame.acc;
    inkPerf.frame.frames = 0;
    inkPerf.frame.acc = 0;
  }
  if (now - inkPerf.lastHudAt < 220) return;
  inkPerf.lastHudAt = now;
  const el = inkPerfEnsureHud();
  el.textContent = inkPerfHudLines().join('\n');
}

function inkPerfFrameLoop(now) {
  if (!inkPerf.hud) { inkPerf.raf = 0; return; }
  inkPerfUpdateHud(typeof now === 'number' ? now : performance.now());
  inkPerf.raf = requestAnimationFrame(inkPerfFrameLoop);
}

function inkPerfToggleHud(force) {
  const on = typeof force === 'boolean' ? force : !inkPerf.hud;
  inkPerf.hud = on;
  const el = inkPerfEnsureHud();
  el.hidden = !on;
  if (on) {
    inkPerf.lastHudAt = 0;
    inkPerf.frame.last = 0;
    if (!inkPerf.raf) inkPerf.raf = requestAnimationFrame(inkPerfFrameLoop);
    inkPerfUpdateHud(performance.now());
  } else if (inkPerf.raf) {
    cancelAnimationFrame(inkPerf.raf);
    inkPerf.raf = 0;
  }
  return on;
}

/* Alt+P: HUD. Diğer kısayolları etkilememek için yalnızca Alt basılıyken. */
window.addEventListener('keydown', e => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.code !== 'KeyP') return;
  e.preventDefault();
  inkPerfToggleHud();
}, true);

/* Testler ve scripts/ink-bench.js için küçük köprü. */
window.__inkPerf = {
  snapshot: inkPerfSnapshot,
  reset: inkPerfReset,
  toggle: inkPerfToggleHud,
  hudLines: inkPerfHudLines,
  avg: inkPerfAvg,
};
