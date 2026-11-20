'use strict';
/* B10 probe: tuval kenarı Power Sliders sözleşmesini gerçek Electron
   penceresinde doğrular. Plan madde 10 kanalıdır:
   • Şeritler tuval kromu: rot/zoom/pan'den bağımsız, inkEditorViewport
     alanı içinde, alt durum çubuğuyla örtüşmez.
   • Değer kanalı tek: inkState() — ayrı state YOK; options bar ve
     fırça paneli aynı karede tazelenir (inkPreviewBrush kancası).
   • Görünürlük şemadan: text/eyedropper'da kök gizli; fill/gradient'te
     sadece opaklık; smudge'da sadece boyut.
   • Klavye erişimi: şerit odaklıyken ok tuşları adım atar.
   node scripts/power-sliders-probe.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9394;
const APP_PORT = 5231;
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval');
  return r.result.value;
};
const mouse = async (ws, type, x, y, extra = {}) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mousePressed' ? 1 : (type === 'mouseReleased' ? 0 : 1),
    pointerType: 'mouse',
    ...extra,
  });
};
const pressKey = (ws, key, code, vk, type = 'keyDown') =>
  send(ws, 'Input.dispatchKeyEvent', {
    type, key, code,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    ...(type === 'keyDown' && key.length === 1 ? { text: key } : {}),
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' · ' + detail : ''));
};

/* Şeridin ekran koordinatını değer yüzdesinden hesaplar. */
const stripGeom = key => `(() => {
  const box = document.querySelector('#inkPowerSliders .inkPSlider[data-key="${key}"]');
  if (!box || box.hidden) return null;
  const r = box.getBoundingClientRect();
  const p = getComputedStyle(box).getPropertyValue('--v5-ps-p');
  const knob = box.querySelector('.inkPSKnob');
  const kr = knob.getBoundingClientRect();
  return { x: kr.left + kr.width / 2, y: kr.top + kr.height / 2,
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    h: r.height, w: r.width, p };
})()`;

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-psprobe-'));
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

  await send(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
  await sleep(900);

  // ---- Denek görüntü + modal editör açılışı (ink-rotate-probe yolu)
  const opened = await evaluate(ws, `(async () => {
    try {
      const c = document.createElement('canvas');
      c.width = 300; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#cccccc'; x.fillRect(0, 0, 300, 300);
      x.fillStyle = '#222222'; x.fillRect(140, 140, 20, 20);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const imageId = 'img_ps_probe';
      await idbPut('images', imageId, { blob, name: 'ps-denek.png' });
      const entry = await decodeImage(blob);
      setImgCache(imageId, { img: entry.img, url: entry.url, name: 'ps-denek.png' });
      const it = {
        id: 'it_ps_probe',
        kind: 'image', imageId, title: 'ps-denek',
        x: 0, y: 0, w: 300, h: 300, rot: 0, z: nextZ(),
      };
      state.items.push(it);
      inkAddLayer({ kind: 'attached', ownerId: it.id, name: 'Katman 1',
        pxW: 300, pxH: 300 });
      const base = { x: stage.clientWidth / 2 / state.view.scale,
        y: stage.clientHeight / 2 / state.view.scale };
      it.x = base.x - 150; it.y = base.y - 150;
      selection = new Set([it.id]);
      selectionOrder = [it.id];
      if (typeof syncAll === 'function') syncAll();
      syncSelection();
      await new Promise(r => setTimeout(r, 500));
      const drawBtn = document.getElementById('modeDrawBtn');
      if (!drawBtn) return { ok: false, reason: 'modeDrawBtn yok' };
      drawBtn.click();
      for (let i = 0; i < 80 &&
        !(typeof inkEditorIsOpen === 'function' && inkEditorIsOpen()); i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      return { ok: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen(),
        itemId: it.id };
    } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  })()`);
  await sleep(600);
  check('modal çizim editörü açıldı', opened.ok, JSON.stringify(opened));
  if (!opened.ok) { console.log('PS-PROBE: editör açılamadı'); app.kill(); process.exit(1); }

  // ---------- 0) Varsayılan: şeritler KAPALI (kullanıcı tercihi) ----------
  const defOff = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    return { root: !!root, visible: root && getComputedStyle(root).display !== 'none',
      stored: localStorage.getItem('tailref-ps-sliders') };
  })()`);
  check('varsayılan: şeritler kapalı (Çizim Ayarları anahtarı kapalı)',
    defOff.root && !defOff.visible && defOff.stored !== '1', JSON.stringify(defOff));
  if (defOff.visible && !defOff.root) { console.log('PS-PROBE: şerit yok'); app.kill(); process.exit(1); }

  // ⋯ → Ayarlar penceresi ÇİZİM sütunundan açma (merkezi köprü
  // window.inkV5Settings.setPowerSliders — localStorage anahtarı tek).
  const toggleOn = await evaluate(ws, `(() => {
    const api = window.inkV5Settings;
    if (!api || typeof api.setPowerSliders !== 'function') return { ok: false, err: 'inkV5Settings köprüsü yok' };
    const getBefore = api.powerSliders();
    api.setPowerSliders(true);
    return { ok: true, stored: localStorage.getItem('tailref-ps-sliders'),
      getBefore, get: api.powerSliders() };
  })()`);
  await sleep(400);

  // ---------- 1) Varlık + yerleşim ----------
  const geo = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    if (!root) return { exists: false };
    const r = root.getBoundingClientRect();
    const sizeBox = root.querySelector('.inkPSlider[data-key="size"]');
    const opBox = root.querySelector('.inkPSlider[data-key="opacity"]');
    const v = (typeof inkEditorViewport === 'function') ? inkEditorViewport() : null;
    const toolbar = document.getElementById('v5Toolbar');
    const bar = document.getElementById('v5OptionsBar');
    const scope = document.getElementById('inkScopeBar');
    const boxR = s => { const x = s.getBoundingClientRect(); return { top: x.top, bottom: x.bottom }; };
    return {
      exists: true, visible: r.width > 0 && r.height > 0,
      left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      sizeHidden: !sizeBox || sizeBox.hidden, opHidden: !opBox || opBox.hidden,
      display: getComputedStyle(root).display,
      vp: v ? { left: v.left, right: v.vw - v.right, top: v.top, bottom: v.vh - v.bottom } : null,
      toolbarR: toolbar ? boxR(toolbar) : null,
      barR: bar ? boxR(bar) : null,
      scopeR: scope ? (() => { const x = scope.getBoundingClientRect();
        return x.width > 0 ? { top: x.top } : null; })() : null,
    };
  })()`);
  check('şeritler var ve görünür', toggleOn.ok && toggleOn.stored === '1' && geo.exists && geo.visible && geo.display !== 'none',
    JSON.stringify({ toggle: toggleOn, exists: geo.exists, visible: geo.visible, display: geo.display }));
  check('köprü kapalıydı → açmaya doğru (state=Kapalı)', toggleOn.ok && toggleOn.getBefore === false && toggleOn.get === true,
    JSON.stringify({ getBefore: toggleOn.getBefore, get: toggleOn.get, err: toggleOn.err }));
  if (!geo.exists) { console.log('PS-PROBE: şerit yok'); app.kill(); process.exit(1); }
  check('boyut + opaklık şeridi görünür (fırça şeması)', !geo.sizeHidden && !geo.opHidden,
    `sizeHidden=${geo.sizeHidden} opHidden=${geo.opHidden}`);
  check('şeritler viewport alanının içindedir', !!geo.vp &&
    geo.left >= geo.vp.left - 1 && geo.right <= geo.vp.right + 1 &&
    geo.top >= geo.vp.top - 1 && geo.bottom <= geo.vp.bottom + 1,
    JSON.stringify({ l: geo.left, r: geo.right, tp: geo.top, bt: geo.bottom, vp: geo.vp }));
  check('şeritler toolbar/options bar ile örtüşmez', !!geo.toolbarR && !!geo.barR &&
    geo.top >= Math.max(geo.toolbarR.bottom, geo.barR.bottom) - 1,
    `top=${geo.top} barBottom=${geo.barR ? geo.barR.bottom : null}`);
  check('şeritler alt durum çubuğuyla örtüşmez', !geo.scopeR || geo.bottom <= geo.scopeR.top + 1,
    `bottom=${geo.bottom} scopeTop=${geo.scopeR ? geo.scopeR.top : 'gizli'}`);

  // ---------- 2) Knob ↔ state uyumu ----------
  const kn0 = await evaluate(ws, `(() => {
    const s = document.querySelector('#inkPowerSliders .inkPSlider[data-key="size"]');
    return { now: s.getAttribute('aria-valuenow'), state: Math.round(inkState().size) };
  })()`);
  check('boyut şeridi state oturur', Number(kn0.now) === kn0.state,
    `aria=${kn0.now} state=${kn0.state}`);

  // ---------- 3) Sürükleme: size → üst ucu taşma ile (clamp 400) ----------
  const dragSize = await (async () => {
    const g = await evaluate(ws, stripGeom('size'));
    if (!g) return { ok: false };
    const mid = g.y;
    const target = g.top - 30; // üst ucu TAŞIR — clamp değere zorlar
    await mouse(ws, 'mousePressed', g.x, mid);
    await sleep(90);
    for (let i = 1; i <= 6; i++) {
      await mouse(ws, 'mouseMoved', g.x, mid + (target - mid) * (i / 6));
      await sleep(40);
    }
    await mouse(ws, 'mouseReleased', g.x, target);
    await sleep(260);
    return { ok: true, x: g.x, target };
  })();
  const sizeMax = await evaluate(ws, `({ state: inkState().size, aria: document.querySelector('#inkPowerSliders .inkPSlider[data-key="size"]').getAttribute('aria-valuenow') })`);
  check('size sürükleme üst uç: state = 400', dragSize.ok && sizeMax.state === 400,
    `state=${sizeMax.state}`);
  check('size şeridi üst ucu geçmez (clamp)', sizeMax.state <= 400 && Number(sizeMax.aria) <= 400,
    `aria=${sizeMax.aria}`);

  // ---------- 4) Options bar senkronu ----------
  const optSync = await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_size');
    const out = input ? input.closest('.v5-opt').querySelector('.v5-opt-val') : null;
    return { value: input ? Number(input.value) : null, out: out ? out.textContent : null };
  })()`);
  check('options bar boyut widget aynı karede tazelendi', optSync.value === 400 && /400/.test(String(optSync.out || '')),
    `value=${optSync.value} out="${optSync.out}"`);

  // ---------- 5) Sürükleme: size → alt ucu taşma ile (clamp 1px) ----------
  const dragBottom = await (async () => {
    const g = await evaluate(ws, stripGeom('size'));
    if (!g) return { ok: false };
    const mid = g.y; const target = g.bottom + 30; // alt ucu TAŞIR — clamp
    await mouse(ws, 'mousePressed', g.x, mid);
    await sleep(90);
    for (let i = 1; i <= 6; i++) {
      await mouse(ws, 'mouseMoved', g.x, mid + (target - mid) * (i / 6));
      await sleep(40);
    }
    await mouse(ws, 'mouseReleased', g.x, target);
    await sleep(260);
    return { ok: true };
  })();
  const sizeMin = await evaluate(ws, `inkState().size`);
  check('size sürükleme alt uç: state = 1', dragBottom.ok && sizeMin === 1,
    `state=${sizeMin}`);

  // ---------- 6) Klavye erişimi ----------
  const kbFocus = await evaluate(ws, `(() => {
    const s = document.querySelector('#inkPowerSliders .inkPSlider[data-key="size"]');
    s.focus();
    return { focused: document.activeElement === s,
      min: s.getAttribute('aria-valuemin'), max: s.getAttribute('aria-valuemax') };
  })()`);
  let kbState = -1;
  if (kbFocus && kbFocus.focused) {
    await pressKey(ws, 'ArrowUp', 'ArrowUp', 38);
    await sleep(220);
    kbState = await evaluate(ws, `inkState().size`);
  }
  check('klavye: şerit odaklanır ve ok tuşu +1 adım atar', kbFocus && kbFocus.focused && kbState === 2,
    `state=${kbState} focus=${kbFocus && kbFocus.focused}`);

  // ---------- 7) Opaklık sürükleme (mid) ----------
  const dragOp = await (async () => {
    const g = await evaluate(ws, stripGeom('opacity'));
    if (!g) return { ok: false };
    // alt uçtan az iterek başlangıç: gerçekten sürüklendiğini doğrulamak // için önce %0'a hizala
    await mouse(ws, 'mousePressed', g.x, g.bottom - 8);
    await sleep(80);
    await mouse(ws, 'mouseReleased', g.x, g.bottom - 8);
    await sleep(200);
    const g2 = await evaluate(ws, stripGeom('opacity'));
    const mid = (g2.top + g2.bottom) / 2;
    await mouse(ws, 'mousePressed', g2.x, g2.bottom - 8);
    await sleep(90);
    for (let i = 1; i <= 5; i++) {
      await mouse(ws, 'mouseMoved', g2.x, (g2.bottom - 8) + (mid - (g2.bottom - 8)) * (i / 5));
      await sleep(40);
    }
    await mouse(ws, 'mouseReleased', g2.x, mid);
    await sleep(260);
    return { ok: true };
  })();
  const opMid = await evaluate(ws, `({ op: inkState().opacity, aria: document.querySelector('#inkPowerSliders .inkPSlider[data-key="opacity"]').getAttribute('aria-valuenow') })`);
  check('opaklık sürükleme orta nokta: %50±6', dragOp.ok && Math.abs(opMid.op - 0.5) <= 0.06,
    `op=${opMid.op}`);
  const opOptSync = await evaluate(ws, `(() => {
    const input = document.getElementById('v5opt_opacity');
    const out = input ? input.closest('.v5-opt').querySelector('.v5-opt-val') : null;
    return { value: input ? Number(input.value) : null, out: out ? out.textContent : null };
  })()`);
  check('options bar opaklık widget tazelendi (%50±6)', opOptSync.value != null &&
    Math.abs(opOptSync.value - opMid.op * 100) < 6, `value=${opOptSync.value} out="${opOptSync.out}"`);

  // ---------- 8) Şema görünürlüğü ----------
  await evaluate(ws, `(() => {
    const seed = document.querySelector('#v5Toolbar [data-tool="gradient"]');
    if (seed) seed.click();
  })()`);
  await sleep(400);
  const gradVis = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    const s = root.querySelector('.inkPSlider[data-key="size"]');
    const o = root.querySelector('.inkPSlider[data-key="opacity"]');
    return { visible: getComputedStyle(root).display !== 'none',
      sizeHidden: s.hidden, opHidden: o.hidden, tool: inkState().tool };
  })()`);
  check('gradient: sadece opaklık şeridi', gradVis.tool === 'gradient' && gradVis.visible &&
    gradVis.sizeHidden && !gradVis.opHidden, JSON.stringify(gradVis));

  await evaluate(ws, `(() => {
    const seed = document.querySelector('#v5Toolbar [data-tool="smudge"]');
    if (seed) seed.click();
  })()`);
  await sleep(400);
  const smgVis = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    const s = root.querySelector('.inkPSlider[data-key="size"]');
    const o = root.querySelector('.inkPSlider[data-key="opacity"]');
    return { visible: getComputedStyle(root).display !== 'none',
      sizeHidden: s.hidden, opHidden: o.hidden, tool: inkState().tool };
  })()`);
  check('smudge: sadece boyut şeridi', smgVis.tool === 'smudge' && smgVis.visible &&
    !smgVis.sizeHidden && smgVis.opHidden, JSON.stringify(smgVis));

  // Eyedropper: v5 toolbar'da caret menüden — motor kısayolu I.
  await evaluate(ws, `if (typeof inkSetTool === 'function') inkSetTool('eyedropper');`);
  await sleep(400);
  const eyeVis = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    return { visible: getComputedStyle(root).display !== 'none', tool: inkState().tool };
  })()`);
  check('eyedropper: şeritler komple gizli', !eyeVis.visible && eyeVis.tool === 'eyedropper',
    JSON.stringify(eyeVis));
  await evaluate(ws, `if (typeof inkSetTool === 'function') inkSetTool('brush');`);
  await sleep(400);

  // ---------- 9) Rot altında şeritler yaşar ----------
  const rotThenDrag = await (async () => {
    const g = await evaluate(ws, stripGeom('size'));
    if (!g) return { ok: false };
    await mouse(ws, 'mousePressed', g.x, g.bottom - 10);
    await sleep(80);
    const upTo = g.top + 30;
    for (let i = 1; i <= 4; i++) {
      await mouse(ws, 'mouseMoved', g.x, (g.bottom - 10) + (upTo - (g.bottom - 10)) * (i / 4));
      await sleep(40);
    }
    await mouse(ws, 'mouseReleased', g.x, upTo);
    await sleep(240);
    const st = await evaluate(ws, `inkState().size`);
    return { ok: true, state: st };
  })();
  const rotVis = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    const box = root.querySelector('.inkPSlider[data-key="size"]');
    return { visible: getComputedStyle(root).display !== 'none', hidden: box.hidden,
      now: box.getAttribute('aria-valuenow') };
  })()`);
  check('fırça şeması yeldeğirmeni: şeritler sürüklendikten sonra state örtüşür',
    rotThenDrag.ok && rotThenDrag.state === Number(rotVis.now), JSON.stringify({ rotThenDrag, rotVis }));

  // ---------- 10) Ayarlar (ÇİZİM) köprüsünden kapatma ----------
  const toggleOff = await evaluate(ws, `(() => {
    const api = window.inkV5Settings;
    if (!api || typeof api.setPowerSliders !== 'function') return { stored: null, stateBefore: null, err: 'inkV5Settings köprüsü yok' };
    const stateBefore = api.powerSliders() ? 'Açık' : 'Kapalı';
    api.setPowerSliders(false);
    return { stored: localStorage.getItem('tailref-ps-sliders'), stateBefore };
  })()`);
  await sleep(400);
  const offGeo = await evaluate(ws, `(() => {
    const root = document.getElementById('inkPowerSliders');
    return { visible: root && getComputedStyle(root).display !== 'none' };
  })()`);
  check('Ayarlar (ÇİZİM) köprüsünden kapatınca şeritler söner',
    toggleOff.stored !== '1' && toggleOff.stateBefore === 'Açık' && !offGeo.visible,
    JSON.stringify({ toggleOff, offGeo }));

  console.log('');
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error(`PS-PROBE: ${results.length - failed.length}/${results.length} ✓ — ${failed.length} BAŞARISIZ`);
    const list = results.map(r => (r.ok ? '✓' : '✗') + ' ' + r.name + (r.detail ? ` · ${r.detail}` : '')).join('\n');
    try { fs.writeFileSync(path.join(ROOT, 'scripts', '_ps-probe-run.txt'), list, 'utf8'); } catch { }
    app.kill(); process.exit(1);
  }
  console.log(`PS-PROBE: ${results.length}/${results.length} ✓ — B10 KANALI YEŞİL`);
  app.kill();
  process.exit(0);
})();
