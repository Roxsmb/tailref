'use strict';

/* Compositor (Porter–Duff) testi — gerçek Electron penceresinde.

   Kapsam (docs/ARCH-RESCUE-PLAN.md FAZ 1):
   • Kataman planı: kırpma katmanları altındaki temele zincirlenir.
   • Grup rasterı: clip üyesi yalnızca temel alfa İÇİNE basar (source-atop).
   • Temel gizliyse/zayıfsa grup görünmez.
   • Önbellek: üye gen sayacı artınca grup rasterı tazelenir.
   • Ekran (grup tuvali) ile export (plan boyama) piksel birebir.
   • Üye tuvalleri grupta gizlenir, gruba gitmeyenkiler görünür kalır.
   • KLASÖR grupları (kind:'group' + parentId): plan tek giriş
     (base=grup, üyeler bitişik), raster üyeleri taşır, gen bump tazeleme,
     ekran senkron üye gizleme, gizli grup sızmaz, bozma → düz katman,
     klasörlü plan export == ekran.

   Kullanım: node scripts/compositor-test.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9341;
const APP_PORT = 5237;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('electron bulunamadı (npm install)');
  return found;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

const evaluate = (ws, expression, timeout = 15000) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const timer = setTimeout(() => {
    ws.removeEventListener('message', onMsg);
    reject(new Error('eval zaman aşımı'));
  }, timeout);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result && msg.result.exceptionDetails) {
      return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    }
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
});

async function waitForTarget(deadlineMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`:${APP_PORT}`));
      if (page) return page;
    } catch { /* henüz hazır değil */ }
    await sleep(400);
  }
  throw new Error('uygulama hata ayıklama portu açılmadı');
}

async function waitReady(ws, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const ok = await evaluate(ws, '!!(window.__tailrefWorkspace && window.__tailrefWorkspace.ready)', 3000);
      if (ok) return true;
    } catch { /* bağlam yeniden yükleniyor olabilir */ }
    await sleep(350);
  }
  return false;
}

const results = [];
function ok(name, detail) { results.push(true); console.log('OK  ', name, detail ? '→ ' + detail : ''); }
function fail(name, detail) { results.push(false); console.log('FAIL', name, '→', detail); }

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-compose-'));
  const env = { ...process.env, TailRef_USER_DATA: userData, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--disable-gpu'], { cwd: ROOT, env, stdio: 'ignore' });

  try {
    const page = await waitForTarget();
    const ws = await connect(page.webSocketDebuggerUrl);
    await sleep(2500);
    await evaluate(ws, `(() => { const w = document.getElementById('persistenceWelcome'); if (w && !w.hidden) { document.querySelector('.pwOption[data-mode="auto"]')?.click(); document.getElementById('pwContinue')?.click(); } })()`);
    if (!await waitReady(ws)) throw new Error('uygulama hazır olmadı');

    // --- test görseli ekle ---
    const item1 = await evaluate(ws, `(async () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 120;
      const g = c.getContext('2d');
      g.fillStyle = '#4da3ff'; g.fillRect(0, 0, 160, 120);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'compos-test.png', { type: 'image/png' })], null);
      await new Promise(r => setTimeout(r, 700));
      const it = state.items[state.items.length - 1];
      return it && it.id;
    })()`);
    ok('görseli tahtaya ekle', JSON.stringify(item1));

    // --- iki katman kur: taban (sol yarı opak) + kırpılmış uç (tam kaplama) ---
    const seed = await evaluate(ws, `(async () => {
      const ownerId = ${JSON.stringify(item1)};
      if (! Number.isFinite) return 'hata';
      const state0 = inkState();
      const before = inkLayersForOwner(ownerId).length;
      const base = inkEnsureAttachedLayer(ownerId, { name: 'Taban' });
      const clip = inkMakeLayer({ name: 'Uç', kind: 'attached', ownerId });
      clip.clip = true;
      inkState().layers.push(clip);

      const it = getItem(ownerId);
      const W = Math.max(64, Math.round(it.w * 2));
      const H = Math.max(64, Math.round(it.h * 2));

      // taban: sol yarı opak mavi
      const cb = document.createElement('canvas');
      cb.width = W; cb.height = H;
      const gb = cb.getContext('2d');
      gb.clearRect(0, 0, W, H);
      gb.fillStyle = 'rgba(0,0,200,1)';
      gb.fillRect(0, 0, Math.floor(W / 2), H);
      inkRuntime.itemCanvases.set(base.id, cb);

      // uç: tüm tuvali kaplayan opak turuncu
      const cc = document.createElement('canvas');
      cc.width = W; cc.height = H;
      const gc = cc.getContext('2d');
      gc.fillStyle = 'rgba(255,128,0,1)';
      gc.fillRect(0, 0, W, H);
      inkRuntime.itemCanvases.set(clip.id, cc);

      inkSetActiveLayer(base.id);
      return JSON.stringify({ base: base.id, clip: clip.id, W, H });
    })()`).then(JSON.parse);
    ok('taban + kırpılmış uç katmanları kuruldu', JSON.stringify(seed));

    // --- 1. plan yapısal test ---
    const planA = await evaluate(ws, `(() => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item1)});
      return JSON.stringify({
        len: plan.length,
        firstBase: plan[0].base.id,
        firstClips: (plan[0].clips || []).map(l => l.id),
      });
    })()`).then(JSON.parse);
    if (planA.len === 1 && planA.firstBase === seed.base && planA.firstClips.join() === seed.clip) {
      ok('kırpma katmanı plana temel altına zincirlendi', JSON.stringify(planA));
    } else {
      fail('kırpma katmanı plana temel altına zincirlendi', JSON.stringify(planA));
    }

    // --- 2. atop taslak matematik: uç yalnızca taban alfasına basılır ---
    const atop = await evaluate(ws, `(() => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item1)});
      const raster = inkCompositeEntryCanvas(plan[0], null);
      const g = raster.getContext('2d');
      const px = g.getImageData(0, 0, raster.width, raster.height).data;
      // sol orta (taban alfa=1): uç pikseli tam görünür (255,128,0)
      const li = (Math.floor(raster.width/4) + Math.floor(raster.height/2) * raster.width) * 4;
      // sağ orta (taban alfa=0): transparan kalmalı
      const ri = (Math.floor(raster.width*3/4) + Math.floor(raster.height/2) * raster.width) * 4;
      return JSON.stringify({
        w: raster.width, h: raster.height,
        leftRed: px[li], leftGreen: px[li+1], leftAlpha: px[li+3],
        rightRed: px[ri], rightAlpha: px[ri+3],
      });
    })()`).then(JSON.parse);
    if (atop.leftRed === 255 && atop.leftGreen === 128 && atop.leftAlpha === 255
        && atop.rightAlpha === 0) {
      ok('source-atop: üye yalnızca taban alfasına basıldı', JSON.stringify(atop));
    } else {
      fail('source-atop: üye yalnızca taban alfasına basıldı', JSON.stringify(atop));
    }

    // --- 3. temel gizliyse grup görünmez ---
    const hidden = await evaluate(ws, `(async () => {
      const id = ${JSON.stringify(item1)};
      inkLayerById(${JSON.stringify(seed.base)}).visible = false;
      const plan = inkAttachedDisplayPlan(id);
      return JSON.stringify({ visible: inkPlanEntryVisible(plan[0]) });
    })()`).then(JSON.parse);
    if (hidden.visible === false) ok('temel maske gizlediğinde grup görünmez (barrier)');
    else fail('temel maske gizlediğinde grup görünmez (barrier)', JSON.stringify(hidden));

    // temizle: görünürlüğü geri aç
    await evaluate(ws, `inkLayerById(${JSON.stringify(seed.base)}).visible = true;`);

    // --- 4. gen sayacı grup önbelleğini tazeler ---
    await evaluate(ws, `(async () => {
      const clipId = ${JSON.stringify(seed.clip)};
      const raster0 = inkCompositeGroupRaster(inkAttachedDisplayPlan(${JSON.stringify(item1)})[0], null);
      // üye rasterını değiştir (tam tuvali yeşile boya) + gen bump
      const c = inkRuntime.itemCanvases.get(clipId);
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,200,0,1)';
      g.fillRect(0, 0, c.width, c.height);
      inkBumpLayerGen(clipId);
      void raster0;
    })()`);
    const genTest = await evaluate(ws, `(() => {
      const clipId = ${JSON.stringify(seed.clip)};
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item1)});
      const raster = inkCompositeEntryCanvas(plan[0], null);
      const px = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height).data;
      const li = (Math.floor(raster.width/4) + Math.floor(raster.height/2) * raster.width) * 4;
      return JSON.stringify({ bumped: inkLayerGen(clipId) > 0, greenPix: px[li+1], redPix: px[li] });
    })()`).then(JSON.parse);
    if (genTest.bumped && genTest.greenPix === 200) {
      ok('üye boyandığında gen sayacı grup rasterını tazeliyor', JSON.stringify(genTest));
    } else {
      fail('üye boyandığında gen sayacı grup rasterını tazeliyor', JSON.stringify(genTest));
    }

    // --- 5. ekran senkronu: grup tuvali eklenir, üye tuvaller gizlenir ---
    const sync = await evaluate(ws, `(() => {
      const el = document.createElement('div');
      inkCompositeSyncItem(getItem(${JSON.stringify(item1)}), el);
      const groups = [...el.querySelectorAll(':scope > .inkGroupCanvas')];
      const baseCanvas = inkRuntime.itemCanvases.get(${JSON.stringify(seed.base)});
      const clipCanvas = inkRuntime.itemCanvases.get(${JSON.stringify(seed.clip)});
      return JSON.stringify({
        groupCount: groups.length,
        baseDisplay: baseCanvas.style.display,
        clipDisplay: clipCanvas.style.display,
        groupW: groups[0] ? groups[0].width : 0,
      });
    })()`).then(JSON.parse);
    if (sync.groupCount === 1 && sync.baseDisplay === 'none' && sync.clipDisplay === 'none' && sync.groupW > 0) {
      ok('ekran senkronu grup tuvali koyar üye tuvalleri gizler', JSON.stringify(sync));
    } else {
      fail('ekran senkronu grup tuvali koyar üye tuvalleri gizler', JSON.stringify(sync));
    }

    // --- 6. export (plan boyama) == ekran (grup rasterı) ---
    const parity = await evaluate(ws, `(async () => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item1)});
      const screen = inkCompositeEntryCanvas(plan[0], null);
      const out = document.createElement('canvas');
      out.width = screen.width; out.height = screen.height;
      const ctx = out.getContext('2d');
      inkCompositePaintPlanToContext(ctx, ${JSON.stringify(item1)}, null, (c, entry, raster) => {
        c.globalAlpha = inkCompositeEntryOpacity(entry);
        c.drawImage(raster, 0, 0);
        c.globalAlpha = 1;
      });
      const a = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height).data;
      const b = ctx.getImageData(0, 0, out.width, out.height).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return JSON.stringify({ diff, px: a.length / 4 });
    })()`).then(JSON.parse);
    if (parity.diff === 0) ok('export görüntü planı ekrandaki grup rasterıyla piksel birebir', JSON.stringify(parity));
    else fail('export görüntü planı ekrandaki grup rasterıyla piksel birebir', JSON.stringify(parity));

    // --- temizlik: katmanları kaldır ---
    await evaluate(ws, `(async () => {
      inkRemoveLayer(${JSON.stringify(seed.base)});
      inkRemoveLayer(${JSON.stringify(seed.clip)});
    })()`);

    /* =========================================================
       FAZ 1 — klasör grupları (kind:'group' + parentId)
       ========================================================= */

    // --- ikinci görsel ---
    const item2 = await evaluate(ws, `(async () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 120;
      const g = c.getContext('2d');
      g.fillStyle = '#7fd77f'; g.fillRect(0, 0, 160, 120);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await addFiles([new File([blob], 'compos-group.png', { type: 'image/png' })], null);
      await new Promise(r => setTimeout(r, 700));
      return state.items[state.items.length - 1].id;
    })()`);
    ok('ikinci görseli tahtaya ekle', JSON.stringify(item2));

    // --- klasör kur: Zemin | m1 (tam kırmızı) | m2 (sol yarı yeşil) | GRUP ---
    const gSeed = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const it = getItem(ownerId);
      const W = Math.max(64, Math.round(it.w * 2));
      const H = Math.max(64, Math.round(it.h * 2));
      const ground = inkEnsureAttachedLayer(ownerId, { name: 'Zemin' });

      const group = inkCreateGroup(ownerId);
      const m1 = inkAddGroupMember(ownerId, group.id, { name: 'Kırmızı' });
      const m2 = inkAddGroupMember(ownerId, group.id, { name: 'Yeşil' });

      // Zemin: tümü opak koyu mavi (grupta yer almayan düz katman)
      const cg = document.createElement('canvas');
      cg.width = W; cg.height = H;
      cg.getContext('2d').fillStyle = 'rgba(30,40,90,1)';
      cg.getContext('2d').fillRect(0, 0, W, H);
      inkRuntime.itemCanvases.set(ground.id, cg);

      // m1: tümü opak kırmızı
      const c1 = document.createElement('canvas');
      c1.width = W; c1.height = H;
      c1.getContext('2d').fillStyle = 'rgba(255,0,0,1)';
      c1.getContext('2d').fillRect(0, 0, W, H);
      inkRuntime.itemCanvases.set(m1.id, c1);

      // m2: sol yarı opak yeşil
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      c2.getContext('2d').fillStyle = 'rgba(0,200,0,1)';
      c2.getContext('2d').fillRect(0, 0, Math.floor(W / 2), H);
      inkRuntime.itemCanvases.set(m2.id, c2);

      const stack = inkState().layers.filter(l =>
        (l.kind === 'attached' || l.kind === 'group') && l.ownerId === ownerId);
      return JSON.stringify({
        ground: ground.id, group: group.id, m1: m1.id, m2: m2.id, W, H,
        stackIds: stack.map(l => l.kind + ':' + l.id),
        m1Parent: m1.parentId, m2Parent: m2.parentId,
        groupName: group.name,
      });
    })()`).then(JSON.parse);
    ok('klasör kur: grup + iki üye', JSON.stringify({
      group: gSeed.group, m1: gSeed.m1, m2: gSeed.m2, stack: gSeed.stackIds,
    }));

    // --- G1. plan yapısı: [Zemin] + [GRUP(m1, m2)] ---
    const gPlan = await evaluate(ws, `(() => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item2)});
      return JSON.stringify(plan.map(e => ({
        base: e.base.id, kind: e.base.kind,
        members: (e.members || []).map(l => l.id),
        clips: (e.clips || []).map(l => l.id),
      })));
    })()`).then(JSON.parse);
    const gEntry = gPlan.find(e => e.kind === 'group');
    if (gPlan.length === 2 && gEntry
        && gEntry.base === gSeed.group
        && gEntry.members.join() === gSeed.m1 + ',' + gSeed.m2
        && (!gEntry.clips || !gEntry.clips.length)) {
      ok('plan klasörü tek giriş yapar: base=GRUP üyeler=[m1,m2]', JSON.stringify(gPlan));
    } else {
      fail('plan klasörü tek giriş yapar: base=GRUP üyeler=[m1,m2]', JSON.stringify({
        plan: gPlan, expect: { group: gSeed.group, m1: gSeed.m1, m2: gSeed.m2 },
      }));
    }

    // --- G2. klasör rasterı iki üyeyi de taşır (m2 üstte, sol yarı) ---
    const graster = await evaluate(ws, `(() => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item2)});
      const entry = plan.find(e => e.base.kind === 'group');
      const raster = inkCompositeEntryCanvas(entry, null);
      const px = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height).data;
      const li = (Math.floor(raster.width / 4) + Math.floor(raster.height / 2) * raster.width) * 4;
      const ri = (Math.floor(raster.width * 3 / 4) + Math.floor(raster.height / 2) * raster.width) * 4;
      return JSON.stringify({
        w: raster.width, h: raster.height,
        leftRed: px[li], leftGreen: px[li + 1], leftAlpha: px[li + 3],
        rightRed: px[ri], rightGreen: px[ri + 1], rightAlpha: px[ri + 3],
      });
    })()`).then(JSON.parse);
    if (graster.leftGreen === 200 && graster.leftAlpha === 255
        && graster.rightRed === 255 && graster.rightAlpha === 255) {
      ok('klasör rasterı: sol yeşil (m2 üst) sağ kırmızı (m1)', JSON.stringify(graster));
    } else {
      fail('klasör rasterı: sol yeşil (m2 üst) sağ kırmızı (m1)', JSON.stringify(graster));
    }

    // --- G3. üye gen bump klasör önbelleğini tazeler ---
    await evaluate(ws, `(async () => {
      const m2Id = ${JSON.stringify(gSeed.m2)};
      const c = inkRuntime.itemCanvases.get(m2Id);
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,255,1)';
      g.fillRect(0, 0, Math.floor(c.width / 2), c.height);
      inkBumpLayerGen(m2Id);
    })()`);
    const ggen = await evaluate(ws, `(() => {
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item2)});
      const entry = plan.find(e => e.base.kind === 'group');
      const raster = inkCompositeEntryCanvas(entry, null);
      const px = raster.getContext('2d').getImageData(0, 0, raster.width, raster.height).data;
      const li = (Math.floor(raster.width / 4) + Math.floor(raster.height / 2) * raster.width) * 4;
      return JSON.stringify({ bumped: inkLayerGen(${JSON.stringify(gSeed.m2)}) > 0, blueLeft: px[li + 2], greenLeft: px[li + 1] });
    })()`).then(JSON.parse);
    if (ggen.bumped && ggen.blueLeft === 255 && ggen.greenLeft === 0) {
      ok('üye boyandığında klasör rasterı tazeleniyor', JSON.stringify(ggen));
    } else {
      fail('üye boyandığında klasör rasterı tazeleniyor', JSON.stringify(ggen));
    }

    // --- G4. ekran senkronu: grup tuvali konur, üye tuvalleri gizlenir ---
    const gsync = await evaluate(ws, `(() => {
      const el = document.createElement('div');
      inkCompositeSyncItem(getItem(${JSON.stringify(item2)}), el);
      const groups = [...el.querySelectorAll(':scope > .inkGroupCanvas')];
      const gc = groups[0];
      const m1c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m1)});
      const m2c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m2)});
      const gcCanvas = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.ground)});
      return JSON.stringify({
        groupCount: groups.length,
        groupDisplay: gc ? gc.style.display : 'yok',
        groupZ: gc ? gc.style.zIndex : '',
        m1Display: m1c.style.display,
        m2Display: m2c.style.display,
        groundDisplay: gcCanvas.style.display,
      });
    })()`).then(JSON.parse);
    if (gsync.groupCount === 1 && gsync.groupDisplay === 'block'
        && parseInt(gsync.groupZ, 10) >= 2
        && gsync.m1Display === 'none' && gsync.m2Display === 'none'
        && gsync.groundDisplay === '') {
      ok('ekran senkronu: grup tuvali görünür üyeler gizli (Zemin bozulmaz)', JSON.stringify(gsync));
    } else {
      fail('ekran senkronu: grup tuvali görünür üyeler gizli (Zemin bozulmaz)', JSON.stringify(gsync));
    }

    // --- G5. grup gizlenince üyeler sızmaz ----------
    const ghide = await evaluate(ws, `(() => {
      inkLayerById(${JSON.stringify(gSeed.group)}).visible = false;
      const el = document.createElement('div');
      inkCompositeSyncItem(getItem(${JSON.stringify(item2)}), el);
      const groups = [...el.querySelectorAll(':scope > .inkGroupCanvas')];
      const m1c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m1)});
      const m2c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m2)});
      const plan = inkAttachedDisplayPlan(${JSON.stringify(item2)});
      const entry = plan.find(e => e.base.kind === 'group');
      return JSON.stringify({
        visible: inkPlanEntryVisible(entry),
        groupCount: groups.length,
        m1Display: m1c.style.display,
        m2Display: m2c.style.display,
      });
    })()`).then(JSON.parse);
    // görünür hale geri getir
    await evaluate(ws, `inkLayerById(${JSON.stringify(gSeed.group)}).visible = true;`);
    if (ghide.visible === false && ghide.groupCount === 0
        && ghide.m1Display === 'none' && ghide.m2Display === 'none') {
      ok('grup gizlendiğinde üye tuvalleri sızmıyor (kaldırılır + gizli kalır)', JSON.stringify(ghide));
    } else {
      fail('grup gizlendiğinde üye tuvalleri sızmıyor (kaldırılır + gizli kalır)', JSON.stringify(ghide));
    }

    // --- G6. klasör export == ekran (piksel birebir; grup hâlâ mevcut) ---
    const gparity = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const out = document.createElement('canvas');
      const plan = inkAttachedDisplayPlan(ownerId);
      const first = plan.length && inkCompositeEntryCanvas(plan[0], null);
      out.width = first ? first.width : 320;
      out.height = first ? first.height : 240;
      const ctx = out.getContext('2d');
      // Export yolu: plan boyama (plan girişleri sırayla).
      inkCompositePaintPlanToContext(ctx, ownerId, null, (c, entry, raster) => {
        c.globalAlpha = inkCompositeEntryOpacity(entry);
        const blend = inkCompositeEntryBlend(entry);
        if (blend) c.globalCompositeOperation = blend;
        c.drawImage(raster, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      });
      // Ekran karşılaştırması: her plan girişinin entry canvas'ı üst üste.
      const screen = document.createElement('canvas');
      screen.width = out.width; screen.height = out.height;
      const sctx = screen.getContext('2d');
      for (const entry of plan) {
        if (!inkPlanEntryVisible(entry)) continue;
        const raster = inkCompositeEntryCanvas(entry, null);
        if (!raster) continue;
        sctx.globalAlpha = inkCompositeEntryOpacity(entry);
        const blend = inkCompositeEntryBlend(entry);
        if (blend) sctx.globalCompositeOperation = blend;
        sctx.drawImage(raster, 0, 0);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
      }
      const a = ctx.getImageData(0, 0, out.width, out.height).data;
      const b = sctx.getImageData(0, 0, screen.width, screen.height).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return JSON.stringify({ diff, px: a.length / 4, plan: plan.map(e => e.base.kind) });
    })()`).then(JSON.parse);
    if (gparity.diff === 0 && gparity.plan.join() === 'attached,group') {
      ok('klasörlü plan export == ekran (piksel birebir)', JSON.stringify(gparity));
    } else {
      fail('klasörlü plan export == ekran (piksel birebir)', JSON.stringify(gparity));
    }

    // --- G7. grubu bozma: üyeler sıradan katman olur, tuvalleri serbest kalır ---
    const gdissolve = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      inkRemoveGroupMember(${JSON.stringify(gSeed.m1)});
      inkRemoveGroupMember(${JSON.stringify(gSeed.m2)});
      const group = inkLayerById(${JSON.stringify(gSeed.group)});
      inkState().layers.splice(inkState().layers.indexOf(group), 1);
      inkBumpLayerGen(group.id);
      inkBumpLayerGen(${JSON.stringify(gSeed.m1)});
      inkBumpLayerGen(${JSON.stringify(gSeed.m2)});
      const plan = inkAttachedDisplayPlan(ownerId);
      const el = document.createElement('div');
      inkCompositeSyncItem(getItem(ownerId), el);
      const groups = [...el.querySelectorAll(':scope > .inkGroupCanvas')];
      const m1c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m1)});
      const m2c = inkRuntime.itemCanvases.get(${JSON.stringify(gSeed.m2)});
      inkSetActiveLayer(plan[plan.length - 1].id);
      return JSON.stringify({
        planIds: plan.map(e => e.base.id),
        groupCount: groups.length,
        m1Display: m1c.style.display || '',
        m2Display: m2c.style.display || '',
      });
    })()`).then(JSON.parse);
    if (gdissolve.planIds.length === 3
        && gdissolve.planIds.join() === gSeed.ground + ',' + gSeed.m1 + ',' + gSeed.m2
        && gdissolve.groupCount === 0
        && gdissolve.m1Display === '' && gdissolve.m2Display === '') {
      ok('grup kaldırılınca üyeler düz katman olur tuvaller serbest kalır', JSON.stringify(gdissolve));
    } else {
      fail('grup kaldırılınca üyeler düz katman olur tuvaller serbest kalır', JSON.stringify(gdissolve));
    }

    /* =========================================================
       FAZ 1 — piksel-gerçek merge-down + klasör flatten (bake)
       ========================================================= */

    // --- M1. merge-down: m2 (opak 0.5, yeşil) m1 (kırmızı) üzerine pişer ---
    // Test boyaları kanonik vuruşlardan gelir: merge ön-render'ı tuvali
    // temizleyip vuruşları yeniden oynatır; fillRect boya kanonik olmadığı
    // için silinirdi (FAZ 2: prod davranışı doğru, senaryo hatalıydı).
    const mmerge = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      // Bilinen duruma geri dön: m1 tam kırmızı, m2 yeşil @ opak 0.5.
      const m1 = inkLayerById(${JSON.stringify(gSeed.m1)});
      const m2 = inkLayerById(${JSON.stringify(gSeed.m2)});
      const W = Math.max(64, m1.pxW || 320);
      const H = Math.max(64, m1.pxH || 240);
      const fillStroke = (id, color) => ({
        id, kind: 'fill', tool: 'fill', color, size: 12, opacity: 1,
        fillTolerance: 24, lockAlpha: false, closed: false,
        points: [{ x: 0.5, y: 0.5, p: 1 }],
      });
      m1.baked = null; m2.baked = null;
      m1.strokes = [fillStroke('sk_m1-red', '#ff0000')];
      m2.strokes = [fillStroke('sk_m2-green', 'rgb(0,200,0)')];
      inkRerenderLayer(m1.id);
      inkRerenderLayer(m2.id);
      m2.opacity = 0.5;
      inkSetActiveLayer(m2.id);
      const done = inkDocMergeDownLayer(m2.id);
      const baked = m1.baked;
      // Bake önbelleği senkron koyuldu mu? Zorla rebuild → pikseller kalıcı.
      inkRerenderLayer(m1.id);
      const canvas = inkRuntime.itemCanvases.get(m1.id);
      const px = canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const ri = ((H >> 1) * W + (W >> 2)) * 4;
      return JSON.stringify({
        done,
        layerCount: inkLayersForOwner(ownerId).length,
        strokes: m1.strokes.length,
        hasBaked: !!(baked && baked.src),
        bakedW: baked ? baked.w : 0,
        removed: !inkLayerById(m2.id),
        outR: px[ri], outG: px[ri + 1], outA: px[ri + 3],
      });
    })()`).then(JSON.parse);
    // yeşil(0.5) × altı tam opak kırmızı: g ≈ 100, r ≈ 127, alfa opak
    if (mmerge.done && mmerge.layerCount === 2
        && mmerge.strokes === 0 && mmerge.hasBaked
        && mmerge.removed
        && Math.abs(mmerge.outG - 100) <= 2 && Math.abs(mmerge.outR - 127) <= 2
        && mmerge.outA === 255) {
      ok('merge-down piksel-gerçek: kaynak opak/blend pişer vuruşlar silinir', JSON.stringify(mmerge));
    } else {
      fail('merge-down piksel-gerçek: kaynak opak/blend pişer vuruşlar silinir', JSON.stringify(mmerge));
    }

    // --- M2. merge-down güvenlik: klasör düzlemi kaynak/hedef olamaz ---
    const mrefuse = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const group = inkCreateGroup(ownerId); // yığın tepesi, seçilir
      const done = inkDocMergeDownLayer(group.id);
      inkRemoveLayer(group.id);
      return JSON.stringify({ done, groupGone: !inkLayerById(group.id) });
    })()`).then(JSON.parse);
    if (mrefuse.done === false && mrefuse.groupGone) {
      ok('merge-down güvenlik: klasör düzlemi birleştirme hedefi olamaz', JSON.stringify(mrefuse));
    } else {
      fail('merge-down güvenlik: klasör düzlemi birleştirme hedefi olamaz', JSON.stringify(mrefuse));
    }

    // --- M3. klasör flatten: tek pişmiş katman, pikseller korunur ---
    // m3 boyası da kanonik vuruştan gelir (flatten üyeleri vuruş kaynaklı
    // yeniden oynatır; fillRect boya bake'de kaybolurdu).
    const mflatten = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const group = inkCreateGroup(ownerId);
      const m3 = inkAddGroupMember(ownerId, group.id, { name: 'Mavi' });
      // Hazırlık: baked m1 gruba üye DEĞİL — yalnızca yeni üye m3.
      if (m3) {
        m3.baked = null;
        m3.strokes = [{
          id: 'sk_m3-blue', kind: 'fill', tool: 'fill', color: '#1414ff',
          size: 12, opacity: 1, fillTolerance: 24, lockAlpha: false,
          closed: false, points: [{ x: 0.5, y: 0.5, p: 1 }],
        }];
        inkRerenderLayer(m3.id);
      }
      m3.opacity = 0.75;
      inkSetActiveLayer(group.id);
      const done = inkDocFlattenGroup(group.id);
      // flatten aktif katmanı yeni pişmiş katmana çevirir.
      const flat = inkState().activeLayerId
        ? inkLayerById(inkState().activeLayerId) : null;
      let leftAlpha = -1, leftBlue = -1, leftRed = -1, leftGreen = -1;
      if (flat) {
        // pişmiş katman rebuild'a dayanır (prime senkron)
        inkRerenderLayer(flat.id);
        const canvas = inkRuntime.itemCanvases.get(flat.id);
        if (canvas) {
          const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const ri = ((canvas.height >> 1) * canvas.width + (canvas.width >> 2)) * 4;
          leftAlpha = px[ri + 3];
          leftBlue = px[ri + 2];
          leftRed = px[ri];
          leftGreen = px[ri + 1];
        }
      }
      return JSON.stringify({
        done,
        activeWasId: inkState().activeLayerId,
        plan: inkAttachedDisplayPlan(ownerId).map(e => e.base.kind).join(','),
        memberCount: inkLayersForOwner(ownerId).filter(l => l.parentId).length,
        flatName: flat ? flat.name : null,
        flatOpacity: flat ? flat.opacity : null,
        hasBaked: !!(flat && flat.baked),
        flatPx: { leftAlpha, leftBlue, leftRed, leftGreen },
        groupGone: !inkLayerById(group.id),
      });
    })()`).then(JSON.parse);
    // Grup rasterı üye opaklığıyla pişer (53:214 flat!=member) → m3 @0.75:
    // alfa ≈ 191, renk kanalları mavi #1414ff. Bake öncesi hata: alpha
    // 0 idi (fillRect boyası vuruş oynatmada siliniyordu).
    if (mflatten.done && mflatten.plan === 'attached,attached,attached'
        && mflatten.memberCount === 0 && mflatten.groupGone
        && mflatten.hasBaked && mflatten.flatOpacity === 1
        && mflatten.flatPx.leftAlpha >= 180 && mflatten.flatPx.leftAlpha <= 205
        && mflatten.flatPx.leftRed === 20 && mflatten.flatPx.leftGreen === 20) {
      ok('klasör flatten: tek pişmiş katman üye pikselleri taşır', JSON.stringify(mflatten));
    } else {
      fail('klasör flatten: tek pişmiş katman üye pikselleri taşır', JSON.stringify(mflatten));
    }

    /* =========================================================
       FAZ 1B — katman maskesi (plan madde 4)
       Maske = ikinci alfa kanalı (destination-in çarpım). Şeffaf maske
       tümü gizler, beyaz maske tümü gösterir; erase vuruşu maske
       alfayı azaltır (gizler), brush vuruşu ekler (gösterir).
       ========================================================= */

    // --- K1. maske ekle (gizle) → alfa 0; maske sil → geri gelir ---
    // NOT: inkEnsureAttachedLayer yeni katman üretmez (owner'da katman varsa
    // en üsttekini döner). Testler kendi katmanını inkMakeLayer ile kurar.
    const kmask = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const layer = inkMakeLayer({ name: 'Maske K1', kind: 'attached', ownerId });
      inkState().layers.push(layer);
      inkState().activeLayerId = layer.id;
      layer.baked = null;
      layer.strokes = [{
        id: 'sk_km1-blue', kind: 'fill', tool: 'fill', color: '#0066ff',
        size: 12, opacity: 1, fillTolerance: 24, lockAlpha: false,
        closed: false, points: [{ x: 0.5, y: 0.5, p: 1 }],
      }];
      inkRerenderLayer(layer.id);
      const pxOf = () => {
        const c = inkRuntime.itemCanvases.get(layer.id);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const i = ((c.height >> 1) * c.width + (c.width >> 2)) * 4;
        return { r: d[i], a: d[i + 3] };
      };
      const before = pxOf();
      const layerDiag = {
        atStart: inkState().layers.length,
        names: inkState().layers.map(l => l.name).join(','),
      };
      const added = inkDocAddMask(layer.id, 'hide');
      layerDiag.afterAdd = inkState().layers.length;
      const hidden = pxOf();
      const editing = inkState().maskEditId === layer.id;
      const maskData = !!(layer.mask && layer.mask.src && layer.mask.w > 0);
      const removed = inkDocRemoveMask(layer.id);
      layerDiag.afterRemove = inkState().layers.length;
      const restored = pxOf();
      layerDiag.final = inkState().layers.length;
      inkRemoveLayer(layer.id);
      return JSON.stringify({
        maskOk: !!(added && maskData), beforeA: before.a, beforeR: before.r,
        hiddenA: hidden.a, editing, removedOk: removed,
        restoredA: restored.a, restoredR: restored.r,
        editCleared: !inkState().maskEditId,
        layerDiag,
      });
    })()`).then(JSON.parse);
    if (kmask.maskOk && kmask.beforeA === 255 && kmask.beforeR === 0
        && kmask.hiddenA === 0 && kmask.editing && kmask.removedOk
        && kmask.restoredA === 255 && kmask.restoredR === 0
        && kmask.editCleared) {
      ok('maske ekle (gizle): alfa 0 iner maske sil: geri gelir', JSON.stringify(kmask));
    } else {
      fail('maske ekle (gizle): alfa 0 iner maske sil: geri gelir', JSON.stringify(kmask));
    }

    // --- K2. maske düzenleme vuruşları: erase gizler, brush gösterir ---
    // Vuruş maskenin tuvaline işler; katman vuruş defteri LEKEDE KALMAZ,
    // undo tam pushUndo ile alınır (maske src'si state.ink'te yaşar).
    const kedit = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const layer = inkMakeLayer({ name: 'Maske K2', kind: 'attached', ownerId });
      inkState().layers.push(layer);
      inkState().activeLayerId = layer.id;
      layer.baked = null;
      layer.strokes = [{
        id: 'sk_km2-red', kind: 'fill', tool: 'fill', color: '#dd0000',
        size: 12, opacity: 1, fillTolerance: 24, lockAlpha: false,
        closed: false, points: [{ x: 0.5, y: 0.5, p: 1 }],
      }];
      const added = inkDocAddMask(layer.id, 'reveal'); // beyaz maske + düzenleme
      const layerDiag = {
        atStart: inkState().layers.length,
      };
      const pxOf = () => {
        const c = inkRuntime.itemCanvases.get(layer.id);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const w = c.width;
        const left = ((c.height >> 1) * w + Math.floor(w * 0.25)) * 4;
        const right = ((c.height >> 1) * w + Math.floor(w * 0.75)) * 4;
        return { la: d[left + 3], ra: d[right + 3], lr: d[left] };
      };
      const strokesBefore = layer.strokes.length;
      const base = {
        kind: 'stroke', color: '#ffffff', size: 0.35, opacity: 1,
        hardness: 1, spacing: 0.04, flow: 1, flowJitter: 0,
        speedSize: 0, scatter: 0, taperStart: 0, taperEnd: 0,
        brushId: (inkState().brushId || 'pen-default'),
        points: [{ x: 0.03, y: 0.5, p: 1, s: 0 }, { x: 0.44, y: 0.5, p: 1, s: 0 }],
      };
      // Sol yarısını erase ile maskele (destination-out): sol gizlenir.
      const undoBefore = undoStack.length;
      const re1 = inkMaskCommitStrokeFor(layer, { ...base, id: 'sk_mask-e', tool: 'eraser' });
      layerDiag.afterErase = inkState().layers.length;
      const afterErase = pxOf();
      const undoAfter = undoStack.length;
      // Sol yarıya beyaz vuruşla maske ekle (source-over): geri görünür.
      const re2 = inkMaskCommitStrokeFor(layer, { ...base, id: 'sk_mask-w', tool: 'brush' });
      layerDiag.afterWhite = inkState().layers.length;
      const afterWhite = pxOf();
      const leakFree = layer.strokes.every(s => s.id !== 'sk_mask-e' && s.id !== 'sk_mask-w');
      inkRemoveLayer(layer.id);
      return JSON.stringify({
        added: !!added, re1: !!re1, re2: !!re2,
        eraseLA: afterErase.la, eraseRA: afterErase.ra, eraseLR: afterErase.lr,
        whiteLA: afterWhite.la, whiteRA: afterWhite.ra,
        strokesKept: layer.strokes.length === strokesBefore, leakFree,
        undoPushed: undoAfter === undoBefore + 1,
        layerDiag,
      });
    })()`).then(JSON.parse);
    if (kedit.added && kedit.re1 && kedit.re2 && kedit.eraseLA === 0
        && kedit.eraseRA === 255 && kedit.eraseLR === 0
        && kedit.whiteLA === 255 && kedit.whiteRA === 255
        && kedit.strokesKept && kedit.leakFree && kedit.undoPushed) {
      ok('maske düzenleme: erase gizler brush gösterir katman defteri temiz', JSON.stringify(kedit));
    } else {
      fail('maske düzenleme: erase gizler brush gösterir katman defteri temiz', JSON.stringify(kedit));
    }

    // --- K3. undo: erase vuruşundan geri → beyaz maske bütünlüğü döner ---
    const kundo = await evaluate(ws, `(async () => {
      const ownerId = ${JSON.stringify(item2)};
      const layer = inkMakeLayer({ name: 'Maske K3', kind: 'attached', ownerId });
      inkState().layers.push(layer);
      inkState().activeLayerId = layer.id;
      layer.baked = null;
      layer.strokes = [{
        id: 'sk_km3-blue', kind: 'fill', tool: 'fill', color: '#0099cc',
        size: 12, opacity: 1, fillTolerance: 24, lockAlpha: false,
        closed: false, points: [{ x: 0.5, y: 0.5, p: 1 }],
      }];
      inkDocAddMask(layer.id, 'reveal');
      const layerId = layer.id;
      const base = {
        kind: 'stroke', color: '#000000', size: 0.9, opacity: 1,
        hardness: 1, spacing: 0.04, flow: 1, flowJitter: 0,
        speedSize: 0, scatter: 0, taperStart: 0, taperEnd: 0,
        brushId: (inkState().brushId || 'pen-default'),
        points: [{ x: 0.03, y: 0.5, p: 1, s: 0 }, { x: 0.97, y: 0.5, p: 1, s: 0 }],
      };
      inkMaskCommitStrokeFor(layer, { ...base, id: 'sk_mask-e2', tool: 'eraser' });
      const undoDiag = {
        beforePop: undoStack.length,
        topLen: (undoStack[undoStack.length - 1] || '').length,
      };
      try {
        const topParsed = JSON.parse(undoStack[undoStack.length - 1]);
        undoDiag.topLayers = Array.isArray(topParsed.ink && topParsed.ink.layers)
          ? topParsed.ink.layers.length : -1;
        undoDiag.topItems = Array.isArray(topParsed.items) ? topParsed.items.length : -1;
        undoDiag.topLayerNames = (topParsed.ink && topParsed.ink.layers || [])
          .map(l => l.name).slice(0, 8).join(',');
      } catch (e) {
        undoDiag.topParseError = String(e && e.message);
      }
      undo();
      undoDiag.afterPop = undoStack.length;
      await new Promise(r => setTimeout(r, 300));
      undoDiag.layersAfter = inkState().layers.length;
      undoDiag.itemsAfter = state.items.length;
      // undo yeni state objesi kurar: maske src'si Image'a async çözülür.
      for (let k = 0; k < 12; k++) {
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const cur = inkLayerById(layerId);
        if (cur && inkMaskRasterSource(cur)) break;
      }
      const cur = inkLayerById(layerId);
      if (cur) inkRerenderLayer(cur.id);
      const c = inkRuntime.itemCanvases.get(layerId);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const w = c.width;
      const left = ((c.height >> 1) * w + Math.floor(w * 0.25)) * 4;
      inkRemoveLayer(layerId);
      return JSON.stringify({
        maskKept: !!(cur && cur.mask), strokeCount: cur ? cur.strokes.length : -1,
        leftA: d[left + 3], undoDiag,
      });
    })()`).then(JSON.parse);
    if (kundo.maskKept && kundo.strokeCount === 1 && kundo.leftA === 255) {
      ok('undo: maske vuruşu geri alınır eraser izi silinir', JSON.stringify(kundo));
    } else {
      fail('undo: maske vuruşu geri alınır eraser izi silinir', JSON.stringify(kundo));
    }

    // --- K4. maske li katman yığında: ekran == export (piksel birebir) ---
    const kparity = await evaluate(ws, `(() => {
      const ownerId = ${JSON.stringify(item2)};
      const preDiag = {
        items: state.items.length,
        layersAll: inkState().layers.length,
        layersOfOwner: inkState().layers.filter(l => l.ownerId === ownerId)
          .map(l => l.name),
      };
      const layer = inkMakeLayer({ name: 'Maske K4', kind: 'attached', ownerId });
      inkState().layers.push(layer);
      inkState().activeLayerId = layer.id;
      layer.baked = null;
      layer.strokes = [{
        id: 'sk_km4-green', kind: 'fill', tool: 'fill', color: '#22aa44',
        size: 12, opacity: 1, fillTolerance: 24, lockAlpha: false,
        closed: false, points: [{ x: 0.5, y: 0.5, p: 1 }],
      }];
      inkDocAddMask(layer.id, 'reveal');
      const maskC = inkMaskRasterSource(layer);
      if (maskC) {
        const g = maskC.getContext('2d');
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        g.fillRect(maskC.width * 0.5, 0, maskC.width * 0.5, maskC.height);
      }
      layer.mask = {
        src: maskC.toDataURL('image/png'),
        w: maskC.width, h: maskC.height,
      };
      inkMaskRasterPrime(layer.id, layer.mask.src, maskC.width, maskC.height, maskC);
      inkRerenderLayer(layer.id);
      const layerId = layer.id;
      const c4 = inkRuntime.itemCanvases.get(layerId);
      const d4 = c4.getContext('2d').getImageData(0, 0, c4.width, c4.height).data;
      const w4 = c4.width;
      const l4 = ((c4.height >> 1) * w4 + Math.floor(w4 * 0.2)) * 4;
      const r4 = ((c4.height >> 1) * w4 + Math.floor(w4 * 0.8)) * 4;
      const plan = inkAttachedDisplayPlan(ownerId);
      const first = plan.length && inkCompositeEntryCanvas(plan[0], null);
      const out = document.createElement('canvas');
      out.width = first ? first.width : 320;
      out.height = first ? first.height : 240;
      // Ekran yolu: her görünen plan girişinin entry canvas'ı üst üste.
      const screen = document.createElement('canvas');
      screen.width = out.width; screen.height = out.height;
      const sctx = screen.getContext('2d');
      for (const entry of plan) {
        if (!inkPlanEntryVisible(entry)) continue;
        const raster = inkCompositeEntryCanvas(entry, null);
        if (!raster) continue;
        sctx.globalAlpha = inkCompositeEntryOpacity(entry);
        const blend = inkCompositeEntryBlend(entry);
        if (blend) sctx.globalCompositeOperation = blend;
        sctx.drawImage(raster, 0, 0);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
      }
      // Export yolu: plan boyama (plan girişleri sırayla).
      const ctx = out.getContext('2d');
      inkCompositePaintPlanToContext(ctx, ownerId, null, (c, entry, raster) => {
        c.globalAlpha = inkCompositeEntryOpacity(entry);
        const blend = inkCompositeEntryBlend(entry);
        if (blend) c.globalCompositeOperation = blend;
        c.drawImage(raster, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      });
      const a = sctx.getImageData(0, 0, screen.width, screen.height).data;
      const b = ctx.getImageData(0, 0, out.width, out.height).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      inkRemoveLayer(layerId);
      return JSON.stringify({
        diff, px: a.length / 4, plan: plan.map(e => e.base.kind).join(','),
        leftA: d4[l4 + 3], rightA: d4[r4 + 3], preDiag,
      });
    })()`).then(JSON.parse);
    if (kparity.diff === 0 && kparity.leftA === 255 && kparity.rightA === 0
        && kparity.plan.indexOf('attached,attached') === 0) {
      ok('maskeli katman export == ekran (piksel birebir)', JSON.stringify(kparity));
    } else {
      fail('maskeli katman export == ekran (piksel birebir)', JSON.stringify(kparity));
    }
  } finally {
    try { app.kill(); } catch { }
  }

  const allOk = results.every(Boolean);
  console.log(allOk ? 'TÜM TESTLER GEÇTİ (' + results.length + '/' + results.length + ')' : 'BAŞARISIZ (' + results.filter(r => !r).length + ' hata)');
  process.exit(allOk ? 0 : 1);
})().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
