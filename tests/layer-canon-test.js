'use strict';
/* FAZ 7 · K5 probe — katman yığını referans uygulama sözleşmesi kanalı: K1 sürükle-bırak
   (DataTransfer + inkDocReorderLayer), K2 "İçeriği Temizle" ≠ "Sil"
   (stroke boşaltma + undo, düğüm korunur), K3 Katman Özellikleri diyaloğu
   (tek Uygula tek undo), K4 etkin satır kontrastı. Gerçek Electron +
   CDP (ink-shortcut-test.js kalıbı).
   node tests/layer-canon-test.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9374;
const APP_PORT = 5232;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const desc = d.exception && d.exception.description || d.text || 'eval';
    throw new Error(desc + '  [@script satır ' + d.lineNumber + ':' + d.columnNumber + ']');
  }
  return r.result.value;
};

const results = [];
const mouse = async (ws, type, x, y) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    pointerType: 'mouse',
  });
};
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};

/* Menüyü UI yoluyla açar ve istenen girdiyi tıklar. Menü, satırın
   seçimiyle açılır; layerId verilmezse etkin katman hedeflenir. */
const clickMenuAction = async (ws, action, layerId) => {
  const expr = '(() => { ' +
    'const list = document.getElementById("inkLayerList"); ' +
    'let row = null; ' +
    (layerId ? 'row = list.querySelector(".inkLayerRow[data-layer-id=\\"" + ' + JSON.stringify(layerId) + ' + "\\"]");' : '') +
    ' if (!row) row = list.querySelector(".inkLayerRow"); ' +
    'if (row && typeof inkDocSelectLayer === "function") inkDocSelectLayer(row.dataset.layerId); ' +
    'if (typeof inkLayerMenuOpen !== "function") return "no-fn"; ' +
    'inkLayerMenuOpen(row, row ? row.dataset.layerId : null); ' +
    'const menu = document.getElementById("dpLayerMenu"); ' +
    'if (!menu || menu.hidden) return "menu-hidden"; ' +
    'const btn = menu.querySelector("[data-layer-action=\\"" + ' + JSON.stringify(action) + ' + "\\"]"); ' +
    'if (!btn) return "missing"; ' +
    'const disabled = btn.disabled; ' +
    'if (!disabled) btn.click(); ' +
    'return { disabled, actions: [...menu.querySelectorAll("[data-layer-action]")].map(b => b.dataset.layerAction) }; ' +
  '})()';
  return evaluate(ws, expr);
};

/* Fare/pen girdisi sentetik üreteci (ink-smoke.js kalıbı). */
const PEN_HELPER = `
window.__inkPen = function (pts) {
  const editor = typeof inkEditorIsOpen === 'function' && inkEditorIsOpen();
  const editorLayer = editor ? inkLayerById(inkEditorUi.layerId) : null;
  const fit = editor ? inkEditorUi.fit : null;
  const mapPoint = p => {
    if (!editor || !editorLayer || !fit || !fit.w || !fit.h) return p;
    const world = screenToWorld({ x: p.x, y: p.y });
    const local = inkWorldToLocal(editorLayer, world);
    return Object.assign({}, p, {
      x: fit.x + local.x * fit.w,
      y: fit.y + local.y * fit.h,
    });
  };
  const mapped = pts.map(mapPoint);
  const first = mapped[0];
  const target = document.elementFromPoint(first.x, first.y) || stage;
  const surface = editor ? document.getElementById('inkEditorCanvas') : window;
  const pid = 4000 + Math.floor(Math.random() * 500);
  const mk = (type, p, pressure) => new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: pid, pointerType: 'pen', isPrimary: true,
    pressure, clientX: p.x, clientY: p.y,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
  });
  target.dispatchEvent(mk('pointerdown', first, first.p));
  for (let i = 1; i < mapped.length; i += 1) {
    surface.dispatchEvent(mk('pointermove', mapped[i], mapped[i].p));
  }
  surface.dispatchEvent(mk('pointerup', mapped[mapped.length - 1], mapped[mapped.length - 1].p));
  return true;
};
window.__inkPenLine = function (x0, y0, x1, y1, n) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push({
      x: Math.round(x0 + (x1 - x0) * t),
      y: Math.round(y0 + (y1 - y0) * t),
      p: 0.15 + 0.85 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
    });
  }
  return window.__inkPen(pts);
};
`;

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-layerprobe-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], { cwd: ROOT, env, stdio: 'ignore' });
  let page = null; const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
    } catch { /* bekle */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('pencere açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(4000);

  /* --- yükleme: welcome kapat → çizim modu (tuval modalı dahil).
     Welcome diyaloğu init() sonrası asenkron açılır; yavaş yüklemde
     4 sn'de henüz görünür olmayabilir — görünürlük için bekle. */
  const welcomeClosed = await evaluate(ws, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 24; i++) {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
        await sleep(300);
        const w2 = document.getElementById('persistenceWelcome');
        if (!w2 || w2.hidden) return true;
        await sleep(400);
        continue;
      }
      await sleep(400);
    }
    return false;
  })()`);
  await sleep(900);
  await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
  await sleep(900);
  let boot = await evaluate(ws, `(() => {
    if (document.body.classList.contains('mode-draw')) return 'draw';
    const modal = document.getElementById('newCanvasModal');
    if (modal && !modal.hidden) {
      const wEl = document.getElementById('newCanvasW');
      const hEl = document.getElementById('newCanvasH');
      const nameEl = document.getElementById('newCanvasName');
      if (wEl && !wEl.value) wEl.value = '900';
      if (hEl && !hEl.value) hEl.value = '700';
      if (nameEl && !nameEl.value) nameEl.value = 'Katman Kanalı';
      const form = document.getElementById('newCanvasForm');
      const submit = document.getElementById('newCanvasCreate');
      if (submit) submit.click(); else if (form) form.requestSubmit();
      return 'submitted';
    }
    return 'unknown';
  })()`);
  /* Unknown ise bir kez daha dene: modeDrawBtn click diyalog yarışına
     denk gelebilir; welcome kapalıyken tekrar güvenli. */
  for (let i = 0; i < 3 && boot === 'unknown'; i++) {
    await sleep(700);
    await evaluate(ws, `document.getElementById('modeDrawBtn')?.click()`);
    await sleep(900);
    boot = await evaluate(ws, `(() => {
      if (document.body.classList.contains('mode-draw')) return 'draw';
      const modal = document.getElementById('newCanvasModal');
      if (modal && !modal.hidden) {
        const wEl = document.getElementById('newCanvasW');
        const hEl = document.getElementById('newCanvasH');
        const nameEl = document.getElementById('newCanvasName');
        if (wEl && !wEl.value) wEl.value = '900';
        if (hEl && !hEl.value) hEl.value = '700';
        if (nameEl && !nameEl.value) nameEl.value = 'Katman Kanalı';
        const form = document.getElementById('newCanvasForm');
        const submit = document.getElementById('newCanvasCreate');
        if (submit) submit.click(); else if (form) form.requestSubmit();
        return 'submitted';
      }
      return 'unknown';
    })()`);
  }
  await sleep(1800);
  const inDraw = await evaluate(ws, `document.body.classList.contains('mode-draw')`);
  check('çizim moduna giriş (modal yolu dahil)', !!inDraw, `yol=${boot}`);

  if (inDraw) {
    /* sentetik kalem vuruşu yardımcısı (ink-smoke kalıbı) + eski yol kapısı */
    await evaluate(ws, PEN_HELPER);
    await evaluate(ws, 'window.__TailRef_INK_LEGACY_TEST__ = true; true');
    await evaluate(ws, `(() => {
      if (typeof inkState === 'function') { inkState().tool = 'brush'; if (typeof inkSyncUI === 'function') inkSyncUI(); }
    })()`);

    /* ---------------------------------------------------------------
       Liman: panelden 2 ek katman (UI menü yolu ile) */
    let menuCheck = null;
    for (let i = 0; i < 2; i += 1) {
      menuCheck = await clickMenuAction(ws, 'add', null);
      await sleep(220);
    }
    const beforeDnD = await evaluate(ws, `(() => {
      const list = document.getElementById('inkLayerList');
      return [...list.querySelectorAll('.inkLayerRow')].map(r => ({
        id: r.dataset.layerId,
        name: r.querySelector('.inkLayerName') ? r.querySelector('.inkLayerName').textContent.trim() : '',
        draggable: r.draggable === true,
      }));
    })()`);
    check('menü "Yeni katman" işler · satırlar draggable', beforeDnD.length >= 3 && beforeDnD.every(r => r.draggable),
      beforeDnD.map(r => r.name).join(' | '));

    /* ---------------------------------------------------------------
       K1 · sürükle-bırak: alt satırı en üst satırın ÜSTÜNE bırak */
    const dragExpr = '(() => { ' +
      'const list = document.getElementById("inkLayerList"); ' +
      'const rows = [...list.querySelectorAll(".inkLayerRow")]; ' +
      'const dragRow = rows[rows.length - 1]; ' +
      'const target = rows[0]; ' +
      'const dt = new DataTransfer(); ' +
      'dragRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })); ' +
      'const rect = target.getBoundingClientRect(); ' +
      'const above = rect.top + rect.height * 0.25; ' +
      'target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: above + ' +
      '0.3' + ', dataTransfer: dt })); ' +
      'const cls1 = { dragging: dragRow.classList.contains("is-dragging"), above: target.classList.contains("is-drop-above") }; ' +
      'target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: above, dataTransfer: dt })); ' +
      'dragRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); ' +
      'const after = [...list.querySelectorAll(".inkLayerRow")].map(r => r.dataset.layerId); ' +
      'return { cls: cls1, after, dragged: dragRow.dataset.layerId, target: target.dataset.layerId }; ' +
    '})()';
    const dnd = await evaluate(ws, dragExpr);
    check('K1 · dragstart işaretçisi + dragover üst-gösterge',
      dnd.cls.dragging === true && dnd.cls.above === true, JSON.stringify(dnd.cls));
    check('K1 · bırakma sonrası sürüklenen en üstte · göstergeler temiz',
      dnd.after[0] === dnd.dragged && !dnd.after.includes(undefined),
      `${dnd.after[0]} / ${dnd.dragged}`);

    /* K1 ikinci düşüş: en altakini ikinci satırın ALTINA */
    const dragExpr2 = '(() => { ' +
      'const list = document.getElementById("inkLayerList"); ' +
      'const rows = [...list.querySelectorAll(".inkLayerRow")]; ' +
      'const dragRow = rows[rows.length - 1]; ' +
      'const target = rows[0]; ' +
      'const dt = new DataTransfer(); ' +
      'dragRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })); ' +
      'const rect = target.getBoundingClientRect(); ' +
      'const below = rect.top + rect.height * 0.85; ' +
      'target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: below, dataTransfer: dt })); ' +
      'const belowMark = target.classList.contains("is-drop-below"); ' +
      'target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: below, dataTransfer: dt })); ' +
      'dragRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); ' +
      'const after = [...list.querySelectorAll(".inkLayerRow")].map(r => r.dataset.layerId); ' +
      'return { belowMark, after, dragged: dragRow.dataset.layerId }; ' +
    '})()';
    const dnd2 = await evaluate(ws, dragExpr2);
    check('K1 · alt-gösterge + altdan girişte 1. sıraya iniş',
      dnd2.belowMark === true && dnd2.after[1] === dnd2.dragged, `sıra=${dnd2.after.length}`);

    /* ---------------------------------------------------------------
       K2 · vuruş üret (CDP fare zinciri; ink-rotate kalıbı) → menü →  */
    const geo = await evaluate(ws, `(() => {
      const open = typeof inkEditorIsOpen === 'function' && inkEditorIsOpen();
      const ui = inkEditorUi;
      const fit = ui.fit || (typeof inkEditorComputeFit === 'function' ? inkEditorComputeFit() : null);
      const rect = ui.canvas ? ui.canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      return { open, fit, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    })()`);
    check('K2 önkoşul · editör açık + fit hazır', !!geo.open && !!geo.fit, JSON.stringify(geo.rect).slice(0, 60));
    const atP = t => [geo.rect.left + geo.fit.x + geo.fit.w * (0.38 + 0.25 * t),
      geo.rect.top + geo.fit.y + geo.fit.h * (0.42 + 0.16 * t)];
    await evaluate(ws, `(() => { if (typeof inkState === 'function') inkState().color = '#ff0000'; })()`);
    {
      const [sx, sy] = atP(0);
      await mouse(ws, 'mouseMoved', sx, sy);
      await sleep(140);
      await mouse(ws, 'mousePressed', sx, sy);
      await sleep(220);
      for (const t of [0.33, 0.66]) {
        const [mx, my] = atP(t);
        await mouse(ws, 'mouseMoved', mx, my);
        await sleep(90);
      }
      const [ex, ey] = atP(1);
      await mouse(ws, 'mouseReleased', ex, ey);
      await sleep(700);
    }
    const prep = await evaluate(ws, `(() => {
      const id = inkState().activeLayerId;
      const layer = inkLayerById(id);
      return { id, strokes: layer ? (layer.strokes || []).length : -1, locked: layer ? !!layer.locked : true };
    })()`);
    check('K2 · vuruş katmandayken menü girdisi eklenir',
      prep.strokes > 0 && !prep.locked, JSON.stringify(prep));
    if (prep.strokes > 0) {
      const menuInfo = await clickMenuAction(ws, 'clear-content', prep.id);
      /* clickMenuAction menus are refreshed at open; actions list check separate below */
      await sleep(400);
      const cleared = await evaluate(ws, '(() => { const l = inkLayerById(' + JSON.stringify(prep.id) + '); return { exists: !!l, strokes: l ? (l.strokes || []).length : -1, rows: document.getElementById("inkLayerList").querySelectorAll(".inkLayerRow").length }; })()');
      check('K2 · İçeriği Temizle: vuruşlar sıfır · DÜĞÜM korunur',
        cleared.exists === true && cleared.strokes === 0, JSON.stringify(cleared));
      const undoOk = await evaluate(ws, `(() => {
        if (typeof undo === 'function') { undo(); return { strokes: (inkLayerById(${JSON.stringify(prep.id)}) || { strokes: [] }).strokes.length }; }
        return { strokes: -1 };
      })()`);
      await sleep(300);
      check('K2 · undo vuruşları geri getirir', undoOk.strokes > 0, `strokes=${undoOk.strokes}`);

      /* K6 · Anlaşılırlık: küçük görsel boyayı TAŞIMALI (boya-sınırına
         kırpma; tam tuval sığdırma 1-2 piksellik nokta üretirdi),
         footer düğmeleri metin etiketli olmalı ve maske ipucu şeridi
         kapalıyken görünmez olmalı. */
      await sleep(900); // asenkron raster + yeniden kuyruk (≤3 deneme) yetişsin
      const k6 = await evaluate(ws, `(() => {
        const l = inkLayerById(${JSON.stringify(prep.id)});
        const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${prep.id}"]');
        const c = row ? row.querySelector('.inkLayerThumb') : null;
        let nz = -1;
        if (c) {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          nz = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 24) nz += 1;
        }
        const del = document.getElementById('btnInkDeleteLayer');
        const label = (del || {}).textContent || '';
        const hint = document.getElementById('inkLayerMaskHint');
        return { strokes: (l.strokes || []).length, thumbNZ: nz,
          delLabel: label, hintHidden: !hint ? null : hint.hidden,
          labels: [...document.querySelectorAll('#inkLayerActions-last')].length };
      })()`);
      check('K6 · küçük görsel boyayı taşır (boya-sınırı kırpma)',
        k6.thumbNZ > 20, JSON.stringify(k6));
      check('K6 · footer düğmeleri metin etiketli (Sil/Delete okunur)',
        /^(Sil|Delete)$/.test(k6.delLabel.trim()) && k6.delLabel.trim().length <= 24, JSON.stringify(k6.delLabel));
      check('K6 · maske ipucu şeridi düzende gizli',
        k6.hintHidden === true, `hintHidden=${k6.hintHidden}`);
      await evaluate(ws, `(() => { const l = inkLayerById(${JSON.stringify(prep.id)}); if (l) l.strokes = []; if (typeof inkBumpPaintEpoch === 'function') inkBumpPaintEpoch(${JSON.stringify(prep.id)}, 'mutation'); if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel(); })()`);
      await sleep(200);

      /* K8 · kırpma maskesi görsel işareti: kullanıcı raporu — "create
         clipping mask dediğimde simge çıkmıyor". UI yolu: klip
         yapabilen (altında taban olan) ÜSTTEKİ satırı seç, düğmeye
         tıkla, satır sınıfı + bükük ok rozetini doğrula, geri bırak. */
      const clipTarget = await evaluate(ws, `(() => {
        const rows = [...document.querySelectorAll('#inkLayerList .inkLayerRow')];
        const row = rows.find(r => r.querySelector('.inkLayerClip'));
        return { id: row ? row.dataset.layerId : null };
      })()`);
      if (clipTarget.id) {
        await evaluate(ws, `(() => {
          if (typeof inkDocSelectLayer === 'function') inkDocSelectLayer(${JSON.stringify(clipTarget.id)});
          if (typeof inkSyncLayersPanel === 'function') inkSyncLayersPanel();
          const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${clipTarget.id}"]');
          const btn = row && row.querySelector('.inkLayerClip');
          if (btn) btn.click();
        })()`);
        await sleep(250);
        const k8 = await evaluate(ws, `(() => {
          const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${clipTarget.id}"]');
          const arrow = row ? row.querySelector('.inkLayerClipArrow') : null;
          const rect = arrow ? arrow.getBoundingClientRect() : null;
          const l = inkLayerById(${JSON.stringify(clipTarget.id)}) || {};
          return { on: row ? row.classList.contains('is-clip-member') : false,
            hasArrow: !!arrow, w: rect ? Math.round(rect.width) : 0,
            flag: !!l.clip, title: arrow ? arrow.getAttribute('title') : '' };
        })()`);
        check('K8 · klip rozeti satırda görünür (is-clip-member + bükük ok)',
          k8.on && k8.hasArrow && k8.w >= 10 && k8.flag && !!k8.title, JSON.stringify(k8));
        await evaluate(ws, `(() => {
          const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${clipTarget.id}"]');
          const btn = row && row.querySelector('.inkLayerClip');
          if (btn) btn.click();
        })()`);
        await sleep(200);
        const k8off = await evaluate(ws, `(() => {
          const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${clipTarget.id}"]');
          const l = inkLayerById(${JSON.stringify(clipTarget.id)}) || {};
          return { gone: row ? !row.querySelector('.inkLayerClipArrow') : false, flag: !!l.clip };
        })()`);
        check('K8 · klip bırakılınca rozet kalkar', k8off.gone && !k8off.flag, JSON.stringify(k8off));
      } else {
        check('K8 · klip rozeti satırda görünür (is-clip-member + bükük ok)',
          false, 'klip yapabilen satır yok (taban şartı)');
      }

      /* K8 · maske kanca + mini görsel: kullanıcı raporu — "maske yapınca
         hiçbir bildirim yok". UI yolu: inkDocAddMask → çift + doldurulmuş
         mini görsel doğrulanır, sonra maske silinir. */
      await evaluate(ws, `(() => {
        if (typeof inkDocAddMask === 'function') inkDocAddMask(${JSON.stringify(prep.id)}, 'reveal');
        if (typeof inkDocToggleMaskEdit === 'function') inkDocToggleMaskEdit(${JSON.stringify(prep.id)});
      })()`);
      await sleep(300);
      const k8m = await evaluate(ws, `(() => {
        const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${prep.id}"]');
        const pair = row ? row.querySelector('.inkLayerMaskPair') : null;
        const th = pair ? pair.querySelector('.inkLayerMaskThumb') : null;
        let nz = -1;
        if (th) {
          const d = th.getContext('2d').getImageData(0, 0, th.width, th.height).data;
          nz = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) nz += 1;
        }
        const l = inkLayerById(${JSON.stringify(prep.id)}) || {};
        return { hasPair: !!pair, hasThumb: !!th, whiteNZ: nz,
          hasMask: !!l.mask, editing: (inkState().maskEditId === l.id) };
      })()`);
      check('K8 · maske kanca + mini görsel satırda görünür',
        k8m.hasPair && k8m.hasThumb && k8m.whiteNZ > 300 && k8m.hasMask, JSON.stringify(k8m));
      await evaluate(ws, `(() => { if (typeof inkDocRemoveMask === 'function') inkDocRemoveMask(${JSON.stringify(prep.id)}); })()`);
      await sleep(200);
      const k8mOff = await evaluate(ws, `(() => {
        const row = document.querySelector('#inkLayerList .inkLayerRow[data-layer-id="${prep.id}"]');
        return { gone: row ? !row.querySelector('.inkLayerMaskPair') : false };
      })()`);
      check('K8 · maske silinince kanca çifti kalkar', k8mOff.gone, JSON.stringify(k8mOff));
    }

    /* K2 ayrım kanıtı: aynı menüdeki girdiler ayrıştırılabilir */
    const actionList = await evaluate(ws, `(() => {
      const list = document.getElementById('inkLayerList');
      const row = list.querySelector('.inkLayerRow');
      if (row) inkDocSelectLayer(row.dataset.layerId);
      if (typeof inkLayerMenuOpen !== 'function') return [];
      inkLayerMenuOpen(row, row ? row.dataset.layerId : null);
      const menu = document.getElementById('dpLayerMenu');
      const items = [...menu.querySelectorAll('[data-layer-action]')]
        .map(b => ({ a: b.dataset.layerAction, label: b.textContent.trim() }));
      inkLayerMenuClose();
      return items;
    })()`);
    const distinct = new Set(actionList.map(i => i.a));
    check('K2 · "İçeriği Temizle" ve "Sil" ayrı girdiler',
      distinct.has('clear-content') && distinct.has('delete'),
      actionList.filter(i => i.a === 'clear-content' || i.a === 'delete').map(i => i.a).join(' + '));

    /* K10 · sağ-tık menüsü imlecin olduğu yerde açılır: kullanıcı raporu —
       "layera sağ tıklayınca panel en solda açılıyor". UI yolu: satıra
       clientX/Y'li contextmenu dispatch → menünün sol/üst koordinatı imleç
       noktasının yakınındadır (≤4px), ekranın en soluna fırlamaz. */
    const ctxPos = await evaluate(ws, `(() => {
      const list = document.getElementById('inkLayerList');
      const row = list.querySelector('.inkLayerRow');
      const rect = row.getBoundingClientRect();
      const x = Math.round(rect.right - 12);
      const y = Math.round(rect.top + 10);
      const ev = new MouseEvent('contextmenu', { bubbles: true,
        cancelable: true, clientX: x, clientY: y });
      row.dispatchEvent(ev);
      const menu = document.getElementById('dpLayerMenu');
      if (!menu || menu.hidden) return { ok: false };
      const left = Math.round(parseFloat(menu.style.left));
      const top = Math.round(parseFloat(menu.style.top));
      const w = Math.round(menu.offsetWidth);
      const h = Math.round(menu.offsetHeight);
      /* Uçuk kontrol değil, davranış kontrolü: menü (a) tamamen ekran
         içinde, (b) imlecin yatay bandında imleci kapatmadan — hatta
         yapıştığında bile kenarından temas eder, kayana ezilmez. */
      const inViewport = left >= 0 && top >= 0 &&
        left + w <= window.innerWidth + 1 &&
        top + h <= window.innerHeight + 1;
      const hugsPointer = (x >= left - 4 && x <= left + w + 4) &&
        (y >= top - 4 && y <= top + h + 4);
      const res = { ok: true, x, y, left, top, w, h,
        vw: window.innerWidth, vh: window.innerHeight,
        inViewport, hugsPointer };
      if (typeof inkLayerMenuClose === 'function') inkLayerMenuClose();
      return res;
    })()`);
    check('K10 · sağ-tık menüsü imleç yakınında ve ekran içi açılır',
      ctxPos.ok && ctxPos.inViewport && ctxPos.hugsPointer,
      JSON.stringify(ctxPos));

    /* ---------------------------------------------------------------
       K3 · Özellikler diyaloğu */
    const rowForProps = await evaluate(ws, `inkState().activeLayerId || (document.querySelector('.inkLayerRow') || {}).dataset.layerId || null`);
    const propOpen = await evaluate(ws, `(() => {
      const list = document.getElementById('inkLayerList');
      const row = list.querySelector('.inkLayerRow');
      if (row && typeof inkDocSelectLayer === 'function') inkDocSelectLayer(row.dataset.layerId);
      const result = { has: typeof inkLayerPropsOpen === 'function' };
      if (result.has) inkLayerPropsOpen(row ? row.dataset.layerId : null);
      const dialog = document.getElementById('inkLayerPropsDialog');
      result.open = !!dialog && !dialog.hidden;
      result.aria = dialog ? dialog.getAttribute('aria-modal') : null;
      result.title = (document.getElementById('inkLayerPropsTitle') || {}).textContent || '';
      result.rowForProps = ${JSON.stringify(rowForProps)};
      return result;
    })()`);
    check('K3 · diyaloğ açılıyor · aria-modal', propOpen.open === true && propOpen.aria === 'true', propOpen.title || propOpen.rowForProps);

    const propApply = await evaluate(ws, `(() => {
      const dlg = document.getElementById('inkLayerPropsDialog');
      if (!dlg || dlg.hidden) return { ok: false };
      const layerId = dlg.dataset.layerId;
      const before = { name: inkLayerById(layerId).name, op: inkLayerById(layerId).opacity, bl: inkLayerById(layerId).blend, al: !!inkLayerById(layerId).alphaLock };
      document.getElementById('inkPropsName').value = 'Pantere Adım';
      const op = document.getElementById('inkPropsOpacity');
      op.value = '62';
      op.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('inkPropsBlend').value = 'multiply';
      document.getElementById('inkPropsAlpha').checked = true;
      document.getElementById('inkLayerPropsForm').requestSubmit();
      const layer = inkLayerById(layerId);
      return { ok: !dlg.hidden ? false : true, layerId,
        name: layer.name, op: layer.opacity, bl: layer.blend, al: layer.alphaLock,
        before, canClip: typeof inkCanToggleClip === 'function' && inkCanToggleClip(layerId) };
    })()`);
    check('K3 · Uygula alanları katman yazar ve pencere kaparır',
      propApply.ok === true && propApply.name === 'Pantere Adım' &&
      Math.abs(propApply.op - 0.62) < 0.005 && propApply.bl === 'multiply' && propApply.al === true,
      JSON.stringify({ name: propApply.name, op: propApply.op, bl: propApply.bl, al: propApply.al, canClip: propApply.canClip }));

    const propUndo = await evaluate(ws, (() => {
      const expr = `(() => {
        if (typeof undo === 'function') undo();
        const l = inkLayerById(${JSON.stringify(propApply.layerId)});
        return { name: l ? l.name : null, op: l ? l.opacity : null,
          bl: l ? l.blend : null, al: l ? !!l.alphaLock : null };
      })()`;
      return expr;
    })());
    await sleep(300);
    check('K3 · işlem tek undo kaydına iner (ad kollanılan adı geri alır… çünkü başlangıç kaydı)',
      propUndo.name !== 'Pantere Adım' || propUndo.bl !== 'multiply',
      JSON.stringify(propUndo));

    const escClose = await evaluate(ws, `(() => {
      const row = document.querySelector('.inkLayerRow');
      if (row && typeof inkDocSelectLayer === 'function') inkDocSelectLayer(row.dataset.layerId);
      inkLayerPropsOpen(row ? row.dataset.layerId : null);
      const dlg = document.getElementById('inkLayerPropsDialog');
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { open: !dlg.hidden };
    })()`);
    check('K3 · Escape diyaloğu kapatır', escClose.open === false);

    /* ---------------------------------------------------------------
       K4 · etkin satır kontrastı */
    const k4 = await evaluate(ws, `(() => {
      const row = document.querySelector('.inkLayerRow.active') || document.querySelector('.inkLayerRow');
      if (row) row.classList.add('active');
      const cs = getComputedStyle(row, '::before');
      const bg = getComputedStyle(row).backgroundColor;
      /* Chromium color-mix'i "color(srgb ... / a)" veya "rgba(...)" olarak
         dized olarak çıkarabilir; ikisini de ayrıştır. */
      let a = 0;
      const rgbaMatch = bg.match(/rgba?\\(([^)]+)\\)/);
      if (rgbaMatch) a = Number((rgbaMatch[1].split(',')[3] || '1').trim()) || 0;
      const colorMatch = bg.match(/color\\(([^)]+)\\)/);
      if (!rgbaMatch && colorMatch) {
        const slash = colorMatch[1].split('\\/');
        a = slash.length > 1 ? Number(slash[1].trim()) || 0 : 1;
      }
      row.blur();
      return { bg: bg, bgAlpha: a, barWidth: parseFloat(cs.width) || 0, active: row.classList.contains('active') };
    })()`);
    check('K4 · etkin satır: zemin saydamlığı kontrastlı + sol bar >= 3px',
      k4.bgAlpha >= 0.08 && k4.barWidth >= 3, JSON.stringify(k4));
  }

  const pass = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\nLAYER-CANON TEST: ${pass}/${total} ✓`);
  try { await evaluate(ws, `window.close()`); } catch { /* sessiz */ }
  await sleep(300);
  try { app.kill(); } catch { /* sessiz */ }
  process.exit(pass === total ? 0 : 1);
})().catch(e => {
  console.error('PROBE HATA:', e && e.stack || e);
  process.exit(2);
});
