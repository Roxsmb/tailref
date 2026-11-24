'use strict';

/* 3D viewport duman testi.

   Kapsam:
   • Panel açılıyor, WebGL bağlamı kuruluyor (three r170).
   • .fbx rig yükleniyor, kemikler ve controller'lar üretiliyor.
   • Gizmo sahneye ekleniyor, kare çiziliyor (draw call > 0).
   • Sayfa hatası / konsol hatası yok.

   Uygulamayı kendisi başlatır ve kapatır. Kullanım: node scripts/pose3d-smoke.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9334;
const APP_PORT = 5199;
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

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return reject(new Error(msg.result.exceptionDetails.exception?.description || 'eval hatası'));
    resolve(msg.result.result.value);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 15000);
});

const send = (ws, method, params) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

async function waitForTarget(deadlineMs = 25000) {
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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-pose3d-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const errors = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

    const ready = Date.now() + 25000;
    let isReady = false;
    while (Date.now() < ready) {
      try {
        isReady = await evaluate(ws, "typeof state !== 'undefined' && !!document.querySelector('#pose3dPanel')");
        if (isReady) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!isReady) throw new Error('renderer hazır olmadı');

    await evaluate(ws, `(() => {
      const panel = document.querySelector('#pose3dPanel');
      if (window.tailrefOpenPanel) window.tailrefOpenPanel(panel); else panel.hidden = false;
      return !panel.hidden;
    })()`);

    let dbg = null;
    const dbgDeadline = Date.now() + 20000;
    while (Date.now() < dbgDeadline) {
      try {
        dbg = await evaluate(ws, `(() => {
          const d = window.__pose3dDebug; if (!d) return null;
          return JSON.stringify({
            revision: d.revision,
            canvas: [document.querySelector('#pose3dCanvas').clientWidth, document.querySelector('#pose3dCanvas').clientHeight],
            calls: d.renderer.info.render.calls,
            triangles: d.renderer.info.render.triangles,
            bones: d.bones.length,
            controllers: d.controllers.length,
            character: !!d.character,
            gizmoInScene: !!d.gizmoHelper.parent,
          });
        })()`);
        if (dbg) break;
      } catch { /* modül henüz yüklenmedi */ }
      await sleep(500);
    }

    check('3D panel açıldı', true);
    if (!dbg) {
      const why = await evaluate(ws, `import('./pose3d.js').then(() => 'yeniden yüklendi').catch(e => String((e && e.stack) || e))`);
      console.error('3D modülü yüklenemedi:\n' + why);
      throw new Error('__pose3dDebug bulunamadı');
    }
    dbg = JSON.parse(dbg);
    check('three.js revision 170', dbg.revision === '170', 'r' + dbg.revision);
    check('canvas ölçüsü', dbg.canvas[0] > 0 && dbg.canvas[1] > 0, dbg.canvas.join('×'));
    check('FBX rig yüklendi', !!dbg.character && dbg.bones > 0, `${dbg.bones} kemik`);
    check('controller üretildi', dbg.controllers > 0, `${dbg.controllers} adet`);
    check('gizmo sahneye eklendi', !!dbg.gizmoInScene);

    await evaluate(ws, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const calls = await evaluate(ws, 'window.__pose3dDebug.renderer.info.render.calls');
    check('kare çiziliyor', calls > 0, `${calls} draw call`);

    /* --- Kamera motoru (P2) --- */
    const lens = JSON.parse(await evaluate(ws, `(() => {
      const slider = document.querySelector('#poseLens');
      slider.value = '50';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const cam = window.__pose3dDebug.cameraManager;
      return JSON.stringify({
        fov: cam.persp.fov,
        lens: cam.lens,
        chip: document.querySelector('#poseCamChip').textContent,
        value: document.querySelector('#poseLensValue').textContent,
      });
    })()`));
    check('50 mm → FOV ≈ 26.99°', Math.abs(lens.fov - 26.9915) < 0.01, lens.fov.toFixed(2) + '°');
    check('lens chip güncellendi', lens.chip === 'Persp · 50mm' && lens.value === '50 mm', lens.chip);

    const ortho = JSON.parse(await evaluate(ws, `(() => {
      document.querySelector('#poseCamOrtho').click();
      const d = window.__pose3dDebug;
      return JSON.stringify({
        mode: d.cameraManager.mode,
        isOrtho: !!d.viewport.camera.isOrthographicCamera,
        gizmoCamera: d.gizmo.camera === d.viewport.camera,
        posingCamera: d.posing.camera === d.viewport.camera,
        chip: document.querySelector('#poseCamChip').textContent,
        lensHidden: document.querySelector('#poseLensRow').hidden,
        orthoVisible: !document.querySelector('#poseOrthoRow').hidden,
      });
    })()`));
    check('Ortho geçişi', ortho.mode === 'orthographic' && ortho.isOrtho);
    check('gizmo/controller yeni kamerayı izliyor', ortho.gizmoCamera && ortho.posingCamera);
    check('ortho panel durumu', ortho.lensHidden && ortho.orthoVisible && ortho.chip.startsWith('Ortho · '), ortho.chip);

    await evaluate(ws, `(() => { document.querySelector('[data-view="front"]').click(); return true; })()`);
    await sleep(450);
    const preset = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const t = d.cameraManager.target;
      const p = d.viewport.camera.position;
      return JSON.stringify({ dx: Math.abs(p.x - t.x), dz: p.z - t.z, dy: Math.abs(p.y - t.y),
        px: p.x.toFixed(3), py: p.y.toFixed(3), pz: p.z.toFixed(3),
        tx: t.x.toFixed(3), ty: t.y.toFixed(3), tz: t.z.toFixed(3),
        mode: d.cameraManager.mode, orthoScale: d.cameraManager.orthoScale });
    })()`));
    check('ön görünüm preset', preset.dx < 0.01 && preset.dz > 0.1,
      `Δx=${preset.dx.toFixed(3)} Δz=${preset.dz.toFixed(2)} · poz=[${preset.px},${preset.py},${preset.pz}] hedef=[${preset.tx},${preset.ty},${preset.tz}] · mod=${preset.mode}`);

    /* Preset yalnızca konumu değiştirmemeli; kamera hedefe de bakmalı.
       Aksi halde karakter ekran dışında kalıyor, tekerlek kaydırınca
       OrbitControls.update() çalıştığı için geri geliyordu. */
    const presetViews = [];
    for (const view of ['right', 'top', 'front']) {
      await evaluate(ws, `document.querySelector('[data-view="${view}"]').click()`);
      await sleep(420);
      presetViews.push(JSON.parse(await evaluate(ws, `(() => {
        const d = window.__pose3dDebug;
        const up = d.viewport.camera.up;
        return JSON.stringify({
          view: '${view}',
          facing: d.cameraManager.isFacingTarget(0.9999),
          up: [Number(up.x.toFixed(6)), Number(up.y.toFixed(6)), Number(up.z.toFixed(6))],
          distance: d.viewport.camera.position.distanceTo(d.cameraManager.target),
        });
      })()`)));
    }
    check('görünüm presetlerinden sonra kamera hedefe bakıyor',
      presetViews.every(item => item.facing && item.distance > 0.5),
      presetViews.map(item => `${item.view}:${item.facing ? '✓' : '✗'}`).join(' '));
    check('üst/yan presetler kamera up vektörünü bozmuyor',
      presetViews.every(item => item.up[0] === 0 && item.up[1] === 1 && item.up[2] === 0),
      presetViews.map(item => `${item.view} up=${item.up.join(',')}`).join(' · '));

    /* Üst görünümden orbit: kamera kutuplarda ters dönmemeli, +Y üstte kalmalı. */
    await evaluate(ws, `document.querySelector('[data-view="top"]').click()`);
    await sleep(420);
    const orbitPoint = JSON.parse(await evaluate(ws, `(() => {
      const r = document.querySelector('#pose3dCanvas').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + 24), y: Math.round(r.top + r.height * 0.72) });
    })()`));
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: orbitPoint.x, y: orbitPoint.y, button: 'none', modifiers: 1,
    });
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: orbitPoint.x, y: orbitPoint.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1,
    });
    for (let i = 1; i <= 6; i += 1) {
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: orbitPoint.x, y: orbitPoint.y + i * 14, button: 'left', buttons: 1, modifiers: 1,
      });
      await sleep(25);
    }
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: orbitPoint.x, y: orbitPoint.y + 84, button: 'left', buttons: 0, clickCount: 1, modifiers: 1,
    });
    await sleep(600);
    const topOrbit = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const cam = d.viewport.camera;
      const target = d.cameraManager.target;
      return JSON.stringify({
        facing: d.cameraManager.isFacingTarget(0.999),
        up: [cam.up.x, cam.up.y, cam.up.z],
        above: cam.position.y > target.y,
        moved: cam.position.distanceTo(target) > 0.5,
      });
    })()`));
    check('üst görünümden orbit ederken kamera ters dönmüyor',
      topOrbit.facing && topOrbit.above && topOrbit.moved
        && topOrbit.up[0] === 0 && topOrbit.up[1] === 1 && topOrbit.up[2] === 0,
      `yukarıda=${topOrbit.above} · up=${topOrbit.up.join(',')} · bakış=${topOrbit.facing}`);
    await evaluate(ws, `document.querySelector('[data-view="front"]').click()`);
    await sleep(420);

    const guide = JSON.parse(await evaluate(ws, `(() => {
      const select = document.querySelector('#poseGuidesMode');
      select.value = 'thirds';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const svg = document.querySelector('.poseGuides');
      return JSON.stringify({ guide: svg.dataset.guide, lines: svg.childElementCount, display: getComputedStyle(svg).display });
    })()`));
    check('üçler kuralı kılavuzu', guide.guide === 'thirds' && guide.lines === 4 && guide.display !== 'none', `${guide.lines} çizgi`);

    /* HUD testleri Input olayları kullanır: pencere önde olmalı, yoksa
       arka plan gaz kelebeği/zamanlama flake üretiyor (9 Kasım). */
    await send(ws, 'Page.bringToFront');
    await sleep(250);
    const canvasPoint = JSON.parse(await evaluate(ws, `(() => {
      const r = document.querySelector('#pose3dCanvas').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`));
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: canvasPoint.x, y: canvasPoint.y, button: 'left', buttons: 1, clickCount: 1,
    });
    /* Event işlenmeden evaluate düşebilir (yarış): 'moving' görünene dek yokla.
       Bir de odağı zorla; arka plan penceresinde Input dağıtımı teyaksuz olabilir. */
    const navTrail = [];
    let moving = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
    navTrail.push(moving);
    for (let i = 0; i < 30 && moving !== 'moving'; i++) {
      if (i === 5 || i === 15) {
        /* CDP belki araya fiziksel fare müdahalesi yediler; gerçek yolu
           tekrar dene. 15. turda hâlâ gelmediyse mekanizmayı doğrudan
           kur (kontrolcüler geçici kapatılır ki TransformControls'un
           setPointerCapture'ı sayfa hatası üretmesin). */
        await evaluate(ws, 'window.focus()');
        await send(ws, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: canvasPoint.x, y: canvasPoint.y, button: 'none', buttons: 1,
        });
        await send(ws, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: canvasPoint.x, y: canvasPoint.y, button: 'left', buttons: 1, clickCount: 1,
        });
      }
      if (i === 20) {
        await evaluate(ws, `(() => {
          const d = window.__pose3dDebug;
          const c = document.querySelector('#pose3dCanvas');
          const prev = [d.cameraManager.controls.enabled, d.cameraManager.orthoControls?.enabled, d.gizmo?.enabled];
          d.cameraManager.controls.enabled = false;
          if (d.cameraManager.orthoControls) d.cameraManager.orthoControls.enabled = false;
          if (d.gizmo) d.gizmo.enabled = false;
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 44,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
          c.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, cancelable: true, button: 0, pointerId: 44,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
          /* CDP ineceğe kadar yazılım yoluyla satırı tamamla: buttons=0
             pointermove = HUD'un wake() yolu (faded → idle dönüşü). */
          c.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 44,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
          d.cameraManager.controls.enabled = prev[0];
          if (d.cameraManager.orthoControls) d.cameraManager.orthoControls.enabled = prev[1];
          if (d.gizmo) d.gizmo.enabled = prev[2];
        })()`);
      }
      await sleep(100);
      moving = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
      navTrail.push(moving);
    }
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: canvasPoint.x, y: canvasPoint.y, button: 'left', buttons: 0, clickCount: 1,
    });
    await sleep(450);
    /* Fade 250 ms sonra; yavaş makinede gecikmeyi tolere etmek için yokla. */
    let faded = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
    for (let i = 0; i < 30 && faded === 'moving'; i++) {
      await sleep(100);
      faded = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
    }
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: canvasPoint.x, y: canvasPoint.y, button: 'none', buttons: 0,
    });
    let idle = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
    for (let i = 0; i < 30 && idle !== 'idle'; i++) {
      if (i === 10) {
        /* CDP mouseMoved bazen ineşmiyor; yazılım yoluyla wake() et (buttons=0). */
        await evaluate(ws, `(() => {
          const d = window.__pose3dDebug;
          const c = document.querySelector('#pose3dCanvas');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, pointerId: 44,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          }));
        })()`);
      }
      await sleep(100);
      idle = await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.nav");
    }
    check('HUD navigasyonda gizleniyor',
      moving === 'moving' && faded === 'faded',
      `${moving} → ${faded} · iz=${navTrail.join(',')} ' · pres=${await evaluate(ws, "document.querySelector('#pose3dPanel').dataset.presentation")} · focus=${await evaluate(ws, "JSON.stringify({f:document.hasFocus(),v:document.visibilityState,dpr:window.devicePixelRatio})")}`);
    check('HUD harekette geri geliyor', idle === 'idle', idle);

    /* Panel bu aşamada kapanmış olabilir: HUD navigasyon testlerindeki
       gerçek CDP fare olayları dış-tık kapatma tetikleyebilir (flake
       kökü). Tuş testleri önce paneli garantili açar. */
    await evaluate(ws, `(() => {
      const panel = document.querySelector('#pose3dPanel');
      if (panel.hidden) { if (window.tailrefOpenPanel) window.tailrefOpenPanel(panel); else panel.hidden = false; }
      return !panel.hidden;
    })()`);

    const keys = JSON.parse(await evaluate(ws, `(() => {
      const pc = window.__pose3dDebug.panelController;
      const cam = window.__pose3dDebug.cameraManager;
      pc.pointerInside = false;
      const outside = pc.keysActive(new KeyboardEvent('keydown', { key: 'f' }));
      pc.pointerInside = true;
      const before = cam.mode;
      const event = new KeyboardEvent('keydown', { key: '5', code: 'Numpad5', bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      const after = cam.mode;
      pc.pointerInside = false;
      return JSON.stringify({ outside, before, after, prevented: event.defaultPrevented });
    })()`));
    check('panel dışında tuş yakalanmıyor', keys.outside === false);
    check('numpad 5 mod değiştiriyor', keys.before === 'orthographic' && keys.after === 'perspective' && keys.prevented, `${keys.before} → ${keys.after}`);

    /* --- Poz sistemi (P3) --- */
    const stance = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const arm = d.rig.findBone(['leftarm', 'mixamorigleftarm', 'upperarm.l']);
      const forearm = d.rig.findBone(['leftforearm', 'mixamorigleftforearm', 'lowerarm.l', 'leftelbow']);
      if (!arm || !forearm) return JSON.stringify({ missing: true });
      const worldOf = bone => bone.getWorldPosition(bone.position.clone());
      /* Kolun yataydan sapma açısı (derece, aşağı pozitif). */
      const armAngle = () => {
        const a = worldOf(arm), f = worldOf(forearm);
        return Math.atan2(-(f.y - a.y), Math.abs(f.x - a.x)) * 180 / Math.PI;
      };
      d.posing.resetTo('t-pose');
      const tAngle = armAngle();
      document.querySelector('#poseAPose').click();
      const aAngle = armAngle();
      document.querySelector('#poseTPose').click();
      const tAgain = armAngle();

      const radii = d.posing.handles.map(h => h.geometry.parameters.radius);
      const spread = Math.max(...radii) - Math.min(...radii);
      return JSON.stringify({
        tAngle, aAngle, tAgain, radii: radii.length, spread,
        canUndo: d.history.canUndo,
      });
    })()`));
    check('T-pose kolları yataya alıyor', !stance.missing && Math.abs(stance.tAngle) <= 5,
      `${stance.tAngle?.toFixed(1)}°`);
    check('A-pose kolları 45° indiriyor',
      !stance.missing && Math.abs(stance.aAngle - 45) <= 6, `${stance.aAngle?.toFixed(1)}°`);
    check('T-pose tekrar yataya dönüyor', !stance.missing && Math.abs(stance.tAgain) <= 5,
      `${stance.tAgain?.toFixed(1)}°`);
    check('controller çapları eşit', !stance.missing && stance.radii > 0 && stance.spread < 1e-9,
      `${stance.radii} controller · sapma ${stance.spread}`);
    check('duruş değişimi geri alınabilir', !stance.missing && stance.canUndo);

    /* Gizmo eksen uzayı: "Yerel" seçili kontrolcünün dünya rotasyonunu
       kullanmalı; böylece sürükleme kemiğin kendi X/Y/Z'sine map'lenir. */
    const gizmoSpace = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const handle = d.posing.handles.find(h => h.userData.bone) || d.posing.handles[0];
      document.querySelector('#poseGizmoTranslate').click();
      document.querySelector('#poseSpaceLocal').click();
      d.posing.gizmo.attach(handle);
      d.posing.syncHandleRotation(handle);
      const q = new (d.viewport.camera.quaternion.constructor)();
      handle.userData.bone.getWorldQuaternion(q);
      const align = Math.abs(q.dot(handle.quaternion));
      const local = {
        space: d.gizmo.space,
        localPressed: document.querySelector('#poseSpaceLocal').getAttribute('aria-pressed'),
        worldPressed: document.querySelector('#poseSpaceWorld').getAttribute('aria-pressed'),
      };
      document.querySelector('#poseSpaceWorld').click();
      const world = { space: d.gizmo.space, pressed: document.querySelector('#poseSpaceWorld').getAttribute('aria-pressed') };
      document.querySelector('#poseSpaceLocal').click();
      const back = { space: d.gizmo.space, align };
      d.posing.gizmo.detach();
      document.querySelector('#poseGizmoRotate').click();
      return JSON.stringify({ local, world, back });
    })()`));
    check('gizmo yerel eksen modu seçilebiliyor',
      gizmoSpace.local.space === 'local' && gizmoSpace.local.localPressed === 'true'
        && gizmoSpace.local.worldPressed === 'false' && gizmoSpace.world.space === 'world'
        && gizmoSpace.world.pressed === 'true' && gizmoSpace.back.space === 'local',
      `yerel=${gizmoSpace.local.space} → global=${gizmoSpace.world.space} → ${gizmoSpace.back.space}`);
    check('gizmo yerel modda kontrolcü rotasyonuna hizalı',
      gizmoSpace.back.align > 0.9999, `hizalama=${gizmoSpace.back.align.toFixed(6)}`);

    const undone = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const arm = d.rig.findBone(['leftarm', 'mixamorigleftarm', 'upperarm.l']);
      const before = arm.quaternion.toArray();
      const ok = d.posing.undo();
      const after = arm.quaternion.toArray();
      return JSON.stringify({ ok, changed: after.some((value, index) => Math.abs(value - before[index]) > 1e-4) });
    })()`));
    check('poz geri alma (Ctrl+Z)', undone.ok && undone.changed);

    const savedPose = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      d.posing.resetTo('a-pose');
      const input = document.querySelector('#posePresetName');
      input.value = 'Test A';
      document.querySelector('#poseSavePreset').click();
      await new Promise(resolve => setTimeout(resolve, 450));
      const rows = [...document.querySelectorAll('#posePresetList .poseListRow')];
      const stored = await d.library.load();
      const arm = d.rig.findBone(['leftarm', 'mixamorigleftarm', 'upperarm.l']);
      d.posing.resetTo('t-pose');
      const tPose = arm.quaternion.toArray();
      rows[0]?.querySelector('[data-action="load"]').click();
      await new Promise(resolve => setTimeout(resolve, 450));
      const loaded = arm.quaternion.toArray();
      return JSON.stringify({
        rows: rows.length,
        name: rows[0]?.querySelector('.poseListName')?.textContent || '',
        count: stored.length,
        signature: stored[0] ? stored[0].rigSignature === d.rig.signature : false,
        bones: stored[0] ? stored[0].bones.length : 0,
        applied: loaded.some((value, index) => Math.abs(value - tPose[index]) > 1e-4),
      });
    })()`));
    check('poz kütüphaneye kaydedildi', savedPose.count === 1 && savedPose.rows === 1, `${savedPose.count} kayıt · ${savedPose.name}`);
    check('poz rig imzası eşleşiyor', savedPose.signature, `${savedPose.bones} kemik`);
    check('kayıtlı poz rig\'e uygulanıyor', savedPose.applied);

    const roundTrip = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const json = await d.library.exportJSON();
      const before = (await d.library.load()).length;
      await d.library.clear();
      const count = await d.library.importJSON(json);
      const after = (await d.library.load()).length;
      return JSON.stringify({ count, before, after, bytes: json.length });
    })()`));
    check('poz JSON dışa/içe aktarma', roundTrip.after === roundTrip.before && roundTrip.count === roundTrip.after, `${roundTrip.bytes} bayt`);

    const parts = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      return JSON.stringify({
        parts: d.sceneGraph.partStates.length,
        rows: document.querySelectorAll('#posePartList .poseListRow').length,
      });
    })()`));
    check('sahne parçaları listelendi', parts.rows === parts.parts && parts.parts > 0, `${parts.parts} parça`);

    const visibility = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const eye = () => document.querySelector('#posePartList [data-action="visibility"]');
      eye().click();
      const hidden = d.sceneGraph.partStates[0].visible === false
        && eye().getAttribute('aria-pressed') === 'false';
      eye().click();
      const shown = d.sceneGraph.partStates.every(part => part.visible);
      return JSON.stringify({ hidden, shown });
    })()`));
    check('parça gizle/göster', visibility.hidden && visibility.shown, parts.parts === 1 ? '1 parça' : '');

    /* Karakter değişiminde parça listesi ve rozet tazelenmeli: eski
       karakterin satırları kalırsa tıklama yanlış indeksi uygular. */
    const switchParts = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const manager = d.characterManager;
      const raw = manager.list;
      const list = typeof raw === 'function' ? raw() : (raw || []);
      const first = manager.activeId;
      const other = list.find(entry => entry.id !== first && entry.ready);
      if (!other) return JSON.stringify({ skipped: true });
      const rows = () => [...document.querySelectorAll('#posePartList .poseListName')].map(e => e.textContent);
      document.querySelector('#poseCharList .poseCharName[data-char-id="' + other.id + '"]').click();
      await new Promise(r => setTimeout(r, 800));
      const names = manager.active.graph.partStates.map(part => part.name);
      const fresh = rows().length === names.length && rows().every((name, index) => name === names[index]);
      const badges = document.querySelectorAll('#posePresetList .poseBadge').length;
      document.querySelector('#poseCharList .poseCharName[data-char-id="' + first + '"]').click();
      await new Promise(r => setTimeout(r, 800));
      return JSON.stringify({ fresh, badges, back: manager.activeId === first });
    })()`));
    check('karakter değişince parça listesi tazeleniyor', switchParts.skipped || (switchParts.fresh && switchParts.back),
      switchParts.skipped ? 'tek karakter' : `${switchParts.fresh ? 'taze' : 'bayat'} · geri dönüş=${switchParts.back}`);
    check('çoklu karakter pozunda yanlış "≠ rig" rozeti yok', switchParts.skipped || switchParts.badges === 0,
      switchParts.skipped ? 'tek karakter' : `${switchParts.badges} rozet`);

    const isolation = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      d.panelController.pointerInside = true;
      document.querySelector('#posePartList [data-action="isolate"]').click();
      const states = d.sceneGraph.partStates;
      const isolated = states.filter(part => part.visible).length === 1 && states[0].visible;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      const restored = d.sceneGraph.partStates.every(part => part.visible);
      d.panelController.pointerInside = false;
      return JSON.stringify({ isolated, restored });
    })()`));
    check('parça izolasyonu', isolation.isolated);
    check('Esc izolasyonu geri alıyor', isolation.restored);

    /* --- Işık & ortam (P4) --- */
    const rig = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const l = d.lighting;
      const names = ['key', 'fill', 'rim'];
      const directional = names.every(name =>
        l.lights[name]?.isDirectionalLight && l.lights[name].parent === d.scene);
      const beforeFill = l.lights.fill.intensity;
      const beforeKey = l.lights.key.intensity;
      l.setIntensity('key', beforeKey + 0.5);
      const independent = Math.abs(l.lights.key.intensity - (beforeKey + 0.5)) < 1e-6
        && l.lights.fill.intensity === beforeFill;
      l.setIntensity('key', beforeKey);
      return JSON.stringify({
        directional,
        independent,
        count: names.filter(name => l.lights[name]).length,
        hemisphere: l.hemi?.isHemisphereLight === true,
      });
    })()`));
    check('3-point ışık rigi', rig.directional && rig.count === 3 && rig.hemisphere);
    check('ışıklar bağımsız', rig.independent);

    const kelvin = JSON.parse(await evaluate(ws, `(() => {
      const l = window.__pose3dDebug.lighting;
      l.setLight('key', { kelvin: 3000 });
      const warm = l.lights.key.color.clone();
      l.setLight('key', { kelvin: 12000 });
      const cool = l.lights.key.color.clone();
      l.setLight('key', { kelvin: 5600 });
      return JSON.stringify({
        changed: Math.abs(warm.r - cool.r) > 0.02 || Math.abs(warm.b - cool.b) > 0.02,
        warm: warm.r > warm.b,
        cool: cool.b > cool.r,
      });
    })()`));
    check('Kelvin renk sıcaklığı', kelvin.changed && kelvin.warm && kelvin.cool);

    const direction = JSON.parse(await evaluate(ws, `(() => {
      const l = window.__pose3dDebug.lighting;
      l.setLight('key', { azimuth: 0, elevation: 0 });
      const front = l.lights.key.position.clone();
      l.setLight('key', { azimuth: 90, elevation: 0 });
      const side = l.lights.key.position.clone();
      l.setLight('key', { azimuth: 38, elevation: 42 });
      return JSON.stringify({
        front: Math.abs(front.x) < 1e-3 && front.z > 0,
        side: side.x > 0 && Math.abs(side.z) < 1e-3,
        elevated: l.lights.key.position.y > 0,
      });
    })()`));
    check('ışık yönü (azimuth/elevation)', direction.front && direction.side && direction.elevated);

    const shadows = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const l = d.lighting;
      const soft = d.renderer.shadowMap.type;
      d.pipeline.setQuality('medium');
      const medium = l.lights.key.shadow.mapSize.x;
      d.pipeline.setQuality('high');
      const high = l.lights.key.shadow.mapSize.x;
      l.setFloorOpacity(0.5);
      const floor = l.floor.material.isShadowMaterial && l.floor.receiveShadow
        && Math.abs(l.floor.material.opacity - 0.5) < 1e-3;
      const checkbox = document.querySelector('#poseShadows');
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      const off = d.renderer.shadowMap.enabled === false && l.lights.key.castShadow === false;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      l.setFloorOpacity(0.28);
      return JSON.stringify({ soft, medium, high, floor, off, on: d.renderer.shadowMap.enabled === true });
    })()`));
    check('yumuşak gölge haritası', shadows.soft === 2 && shadows.medium === 2048 && shadows.high === 4096,
      `${shadows.medium}/${shadows.high}`);
    check('zemin gölgesi (ShadowMaterial)', shadows.floor);
    check('gölge aç/kapa', shadows.off && shadows.on);

    const background = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const env = d.environment;
      const select = document.querySelector('#poseEnvMode');
      const choose = mode => { select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); };
      choose('solid');
      const solid = d.scene.background?.isColor === true;
      choose('transparent');
      const transparent = d.scene.background === null && d.renderer.getClearAlpha() === 0;
      choose('gradient');
      const gradient = !!d.scene.background?.isTexture && d.renderer.getClearAlpha() === 1;

      env.setBackgroundMode('hdri');
      env.setRotation(120);
      env.setBlur(0.4);
      env.setIntensity(1.3);
      const rotation = Math.abs(d.scene.backgroundRotation.y - Math.PI * 2 / 3) < 1e-3
        && Math.abs(d.scene.environmentRotation.y - Math.PI * 2 / 3) < 1e-3;
      const blur = Math.abs(d.scene.backgroundBlurriness - 0.4) < 1e-3;
      const intensity = Math.abs(d.scene.environmentIntensity - 1.3) < 1e-3;

      env.setRotation(0);
      env.setBlur(0);
      env.setIntensity(1);
      choose('gradient');
      return JSON.stringify({ solid, transparent, gradient, rotation, blur, intensity });
    })()`));
    check('arka plan kipleri', background.solid && background.transparent && background.gradient,
      `solid=${background.solid} transparent=${background.transparent} gradient=${background.gradient}`);
    check('HDRI dönüş/bulanıklık/güç', background.rotation && background.blur && background.intensity);

    /* Küçük ama geçerli bir Radiance HDR üretip gerçek yükleme yolunu dener. */
    const hdri = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const header = new TextEncoder().encode('#?RADIANCE\\nFORMAT=32-bit_rle_rgbe\\n\\n-Y 2 +X 2\\n');
      const pixels = new Uint8Array(16);
      for (let i = 0; i < 16; i += 4) {
        pixels[i] = 120; pixels[i + 1] = 140; pixels[i + 2] = 170; pixels[i + 3] = 129;
      }
      const bytes = new Uint8Array(header.length + pixels.length);
      bytes.set(header, 0);
      bytes.set(pixels, header.length);
      const file = new File([bytes], 'test.hdr', { type: 'image/vnd.radiance' });
      await d.environment.loadHDRI(file);
      const loaded = d.environment.hasHDRI && d.environment.mode === 'hdri'
        && !!d.scene.environment && !!d.scene.background;
      d.panelController.syncEnvPanel();
      const ui = document.querySelector('#poseEnvMode').value === 'hdri'
        && document.querySelector('#poseEnvRotation').disabled === false;
      d.environment.clearHDRI();
      d.panelController.syncEnvPanel();
      const cleared = !d.environment.hasHDRI && d.environment.mode === 'gradient';
      return JSON.stringify({ loaded, ui, cleared });
    })()`));
    check('HDRI yükleme (PMREM)', hdri.loaded && hdri.ui && hdri.cleared,
      `yükle=${hdri.loaded} arayüz=${hdri.ui} temizle=${hdri.cleared}`);

    const tone = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const pipeline = d.pipeline;
      const select = document.querySelector('#poseToneMapping');
      select.value = 'agx';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const rendererMapping = d.renderer.toneMapping;
      d.viewport.invalidate();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const applied = pipeline.outputPass._toneMapping;
      select.value = 'aces';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      pipeline.setExposure(2.2);
      const exposure = d.renderer.toneMappingExposure;
      pipeline.setExposure(1.65);
      return JSON.stringify({ rendererMapping, applied, exposure });
    })()`));
    check('tone mapping presetleri', tone.rendererMapping === 6 || tone.applied === 6,
      `r=${tone.rendererMapping} pass=${tone.applied}`);
    check('pozlama ayarı', Math.abs(tone.exposure - 2.2) < 1e-6, `exp=${tone.exposure}`);

    const view = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const p = d.pipeline;

      const contrast = document.querySelector('#poseContrast');
      contrast.value = '1.8';
      contrast.dispatchEvent(new Event('input', { bubbles: true }));
      const vignette = document.querySelector('#poseVignette');
      vignette.value = '60';
      vignette.dispatchEvent(new Event('input', { bubbles: true }));
      const grade = Math.abs(p.gradePass.uniforms.contrast.value - 1.8) < 1e-6
        && Math.abs(p.gradePass.uniforms.vignette.value - 0.6) < 1e-6;

      const dof = document.querySelector('#poseDof');
      dof.checked = true;
      dof.dispatchEvent(new Event('change', { bubbles: true }));
      const focus = document.querySelector('#poseDofFocus');
      focus.value = '4.5';
      focus.dispatchEvent(new Event('input', { bubbles: true }));
      const fstop = document.querySelector('#poseDofFstop');
      fstop.value = '2';
      fstop.dispatchEvent(new Event('input', { bubbles: true }));
      const dofOn = p.bokehPass.enabled
        && Math.abs(p.bokehPass.uniforms.focus.value - 4.5) < 1e-3
        && Math.abs(p.bokehPass.uniforms.aperture.value - (0.0001 + 0.02 / 4)) < 1e-6;
      dof.checked = false;
      dof.dispatchEvent(new Event('change', { bubbles: true }));
      const dofOff = p.bokehPass.enabled === false;

      const ssao = document.querySelector('#poseSSAO');
      const blocked = ssao.disabled === true && p.setSSAO(true) === false;
      const lineart = document.querySelector('#poseLineart');
      lineart.checked = false;
      lineart.dispatchEvent(new Event('change', { bubbles: true }));
      ssao.checked = true;
      ssao.dispatchEvent(new Event('change', { bubbles: true }));
      const enabled = p.ssaoActive && p.ssaoPass.enabled;
      const quality = document.querySelector('#poseQuality');
      quality.value = 'low';
      quality.dispatchEvent(new Event('change', { bubbles: true }));
      const low = p.ssaoActive === false && p.ssaoPass.enabled === false;
      quality.value = 'high';
      quality.dispatchEvent(new Event('change', { bubbles: true }));
      lineart.checked = true;
      lineart.dispatchEvent(new Event('change', { bubbles: true }));

      p.setSSAO(false);
      p.setFocus(0.6);
      document.querySelector('#poseDofFocusTarget').click();
      const focusTarget = Math.abs(
        p.focus - d.viewport.camera.position.distanceTo(d.cameraManager.target),
      ) < 1e-3;
      p.setFocus(3);
      contrast.value = '1';
      contrast.dispatchEvent(new Event('input', { bubbles: true }));
      vignette.value = '0';
      vignette.dispatchEvent(new Event('input', { bubbles: true }));
      d.panelController.syncViewPanel();

      return JSON.stringify({
        grade, dofOn, dofOff, blocked, enabled, low, focusTarget,
        lineart: p.lineart && d.viewport.outline.enabled,
      });
    })()`));
    check('kontrast + vinyet', view.grade);
    check('alan derinliği pass', view.dofOn && view.dofOff, `odak=${view.dofOn} kapat=${view.dofOff}`);
    check('SSAO lineart/kalite kuralı', view.blocked && view.enabled && view.low,
      `engel=${view.blocked} açık=${view.enabled} düşük=${view.low}`);
    check('lineart aç/kapa', view.lineart);
    check('odağı hedefe al', view.focusTarget);

    /* Lineart kalınlığı kaydırıcısı ile sahne değeri aynı olmalı; 0.04'lük
       eski varsayılan gövdeyi siyah lekelerle kaplıyordu. */
    const lineart = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const slider = document.querySelector('#poseLineartSize');
      const mesh = d.sceneGraph.meshes[0];
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return JSON.stringify({
        scale: d.sceneGraph.lineartScale,
        slider: Number(slider.value),
        thickness: mat?.userData?.outlineParameters?.thickness ?? -1,
      });
    })()`));
    check('lineart kalınlığı ince (0.004)',
      lineart.scale <= 0.01 && lineart.thickness <= 0.01
        && Math.abs(lineart.slider / 10000 - lineart.scale) < 1e-6,
      `ölçek=${lineart.scale} kaydırıcı=${lineart.slider}`);

    const composer = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const p = d.pipeline;
      return JSON.stringify({
        active: d.viewport.pipeline === d.pipeline && d.pipeline.enabled,
        passes: d.pipeline.composer.passes.length,
        order: d.pipeline.composer.passes.map(pass => pass.constructor.name),
        lightRows: document.querySelectorAll('#poseLightIntensity, #poseLightTemp, #poseLightAzimuth, #poseLightElevation').length,
        viewRows: document.querySelectorAll('#poseEnvMode, #poseEnvRotation, #poseEnvBlur, #poseEnvIntensity').length,
      });
    })()`));
    check('render hattı (composer) etkin', composer.active && composer.passes === 5, `${composer.passes} pass`);

    /* Saydam arka planda alfa: SSAO ve DoF alfa'yı doldurmamalı (sol üst köşe). */
    const alpha = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const p = d.pipeline;
      const gl = d.renderer.getContext();
      const pixel = new Uint8Array(4);
      const sample = () => {
        d.renderer.setRenderTarget(null);
        d.viewport.renderFrame();
        gl.finish(); /* komut kuyruğu boşalmadan okuma flake üretiyordu */
        gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[3];
      };
      const mode = document.querySelector('#poseEnvMode');
      mode.value = 'transparent';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const transparent = sample();
      p.setLineart(false);
      p.setSSAO(true);
      const ssao = sample();
      p.setSSAO(false);
      p.setDoF({ enabled: true, fstop: 1.4 });
      const dof = sample();
      p.setDoF({ enabled: false });
      p.setLineart(true);
      mode.value = 'gradient';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      d.viewport.invalidate();
      return JSON.stringify({ transparent, ssao, dof });
    })()`));
    check('saydam arka planda alfa korunuyor',
      alpha.transparent === 0 && alpha.ssao === 0 && alpha.dof === 0,
      `temel=${alpha.transparent} ssao=${alpha.ssao} dof=${alpha.dof}`);
    check('ışık & görünüm panelleri', composer.lightRows >= 4 && composer.viewRows >= 4,
      `${composer.lightRows}+${composer.viewRows} denetim`);

    /* Canvas CSS boyutu bazen geçiş (panel/modal animasyonu) içinde yakalanıyor;
       yakalamadan önce ölçünün iki ardışık örnekte sabitlenmesini beklesin. */
    await evaluate(ws, `(async () => {
      const c = document.querySelector('#pose3dCanvas');
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let last = [0, 0]; let same = 0;
      for (let i = 0; i < 20 && same < 3; i++) {
        const now = [c.clientWidth, c.clientHeight];
        same = (now[0] === last[0] && now[1] === last[1] && now[0] > 0) ? same + 1 : 0;
        last = now;
        await wait(150);
      }
      return 1;
    })()`);
    /* --- Capture suite (P5) --- */
    const capture = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const exporter = d.exporter;
      const before = {
        pixelRatio: d.renderer.getPixelRatio(),
        canvas: [d.renderer.domElement.width, d.renderer.domElement.height],
        aspect: d.camera.aspect,
        helper: d.gizmoHelper.visible,
        handle: d.posing.handles[0] ? d.posing.handles[0].visible : null,
        css: [d.renderer.domElement.clientWidth, d.renderer.domElement.clientHeight],
      };
      const measure = async result => {
        const bitmap = await createImageBitmap(result.blob);
        return { width: bitmap.width, height: bitmap.height, bytes: result.blob.size };
      };
      const one = await exporter.capture({ pass: 'beauty', scale: 1, background: 'transparent' });
      const two = await exporter.capture({ pass: 'beauty', scale: 2, background: 'transparent' });
      const after = {
        pixelRatio: d.renderer.getPixelRatio(),
        canvas: [d.renderer.domElement.width, d.renderer.domElement.height],
        aspect: d.camera.aspect,
        helper: d.gizmoHelper.visible,
        handle: d.posing.handles[0] ? d.posing.handles[0].visible : null,
        css: [d.renderer.domElement.clientWidth, d.renderer.domElement.clientHeight],
      };
      return JSON.stringify({
        base: exporter.baseSize(),
        before,
        one: { ...(await measure(one)), width: one.width, height: one.height },
        two: { ...(await measure(two)), width: two.width, height: two.height },
        after,
      });
    })()`));

    check('beauty pass PNG üretiyor',
      capture.one.bytes > 2000 && capture.one.width === capture.base.width && capture.one.height === capture.base.height,
      `${capture.one.width}×${capture.one.height} (base ${capture.base.width}×${capture.base.height}) · ${capture.one.bytes} bayt`);
    check('2x ölçek boyutu ikiye katlıyor',
      capture.two.width === capture.one.width * 2 && capture.two.height === capture.one.height * 2,
      `${capture.two.width}×${capture.two.height}`);
    check('yakalama sonrası sahne durumu geri yüklendi',
      capture.after.pixelRatio === capture.before.pixelRatio
        && capture.after.canvas.join() === capture.before.canvas.join()
        && Math.abs(capture.after.aspect - capture.before.aspect) < 1e-9
        && capture.after.helper === capture.before.helper
        && capture.after.handle === capture.before.handle
        && capture.after.css.join() === capture.before.css.join(),
      `${capture.after.canvas.join('×')} @${capture.after.pixelRatio}`);

    const passSet = JSON.parse(await evaluate(ws, `(async () => {
      const exporter = window.__pose3dDebug.exporter;
      const out = {};
      for (const pass of ['beauty', 'alpha', 'depth', 'normal', 'wireframe']) {
        const result = await exporter.capture({ pass, scale: 1, background: 'transparent', matte: false });
        const bitmap = await createImageBitmap(result.blob);
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 80;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0; let black = 0; let min = 255; let max = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] <= 8) continue;
          opaque++;
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (lum < 24) black++;
          if (lum < min) min = lum;
          if (lum > max) max = lum;
        }
        out[pass] = {
          bytes: result.blob.size, width: result.width, height: result.height,
          corner: data[3], opaque, black, spread: Math.round(max - min),
        };
        bitmap.close && bitmap.close();
      }
      return JSON.stringify(out);
    })()`));

    const passNames = Object.keys(passSet);
    check('beş pass ayrı ayrı PNG üretiyor',
      passNames.length === 5 && passNames.every(name => passSet[name].bytes > 1200),
      passNames.map(name => `${name}:${passSet[name].bytes}`).join(' '));
    check('alpha PNG arka planı tam saydam',
      passSet.alpha.corner === 0 && passSet.alpha.opaque > 150 && passSet.alpha.black > passSet.alpha.opaque * 0.9,
      `köşe alfa=${passSet.alpha.corner} opak=${passSet.alpha.opaque}`);
    check('depth/normal/wireframe silüet içeriyor',
      passSet.depth.opaque > 100 && passSet.normal.opaque > 100 && passSet.wireframe.opaque > 20,
      `d=${passSet.depth.opaque} n=${passSet.normal.opaque} w=${passSet.wireframe.opaque}`);
    check('depth gri aralığı normalize',
      passSet.depth.spread > 60,
      `yayılım=${passSet.depth.spread}`);

    const matte = JSON.parse(await evaluate(ws, `(async () => {
      const exporter = window.__pose3dDebug.exporter;
      const result = await exporter.capture({ pass: 'alpha', scale: 1, matte: true, background: 'transparent' });
      const bitmap = await createImageBitmap(result.blob);
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 20;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const corner = [...context.getImageData(0, 0, 1, 1).data];
      bitmap.close && bitmap.close();
      return JSON.stringify({ corner, bytes: result.blob.size });
    })()`));
    check('alpha matte beyaz zemin',
      matte.corner[0] > 240 && matte.corner[1] > 240 && matte.corner[3] === 255,
      `köşe=${matte.corner.join(',')}`);

    const fourK = JSON.parse(await evaluate(ws, `(async () => {
      const exporter = window.__pose3dDebug.exporter;
      const result = await exporter.capture({ pass: 'beauty', preset: '4k', background: 'transparent' });
      const bitmap = await createImageBitmap(result.blob);
      const size = [bitmap.width, bitmap.height];
      bitmap.close && bitmap.close();
      return JSON.stringify({ width: result.width, height: result.height, size, bytes: result.blob.size });
    })()`));
    check('4K preset 3840×2160', fourK.width === 3840 && fourK.height === 2160 && fourK.size.join('×') === '3840×2160',
      `${fourK.size.join('×')} · ${Math.round(fourK.bytes / 1024)} KB`);

    const modal = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const root = document.querySelector('#poseCapture');
      const wasHidden = root.hidden;
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
      }));
      const opened = !root.hidden;
      const info2x = document.querySelector('#poseCaptureInfo').textContent;
      const scaleButtons = root.querySelectorAll('[data-scale]').length;
      const presetButtons = root.querySelectorAll('[data-preset]').length;
      const passButtons = root.querySelectorAll('[data-pass]').length;
      d.captureModal.settings.preset = '8k';
      d.captureModal.settings.passes = ['beauty', 'alpha'];
      d.captureModal.sync();
      const warn = document.querySelector('#poseCaptureWarn');
      const warnShown = !warn.hidden && /8K/.test(warn.textContent);
      const info8k = document.querySelector('#poseCaptureInfo').textContent;
      const matteRow = document.querySelector('#poseCaptureMatteRow');
      const matteShown = !matteRow.hidden && getComputedStyle(matteRow).display !== 'none';
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      const closed = root.hidden;
      d.captureModal.settings.preset = null;
      d.captureModal.settings.passes = ['beauty'];
      d.captureModal.sync();
      const matteHidden = getComputedStyle(matteRow).display === 'none';
      return JSON.stringify({ wasHidden, opened, closed, info2x, info8k, warnShown, matteShown, matteHidden, scaleButtons, presetButtons, passButtons });
    })()`));

    check('Ctrl+Shift+S modalı açıyor, Esc kapatıyor',
      modal.wasHidden && modal.opened && modal.closed
        && modal.scaleButtons === 3 && modal.presetButtons === 2 && modal.passButtons === 5,
      `${modal.scaleButtons}+${modal.presetButtons} ölçek · ${modal.passButtons} pass`);
    check('8K seçiminde bellek uyarısı',
      modal.warnShown && /7680 × 4320/.test(modal.info8k),
      modal.info8k);
    check('alpha pass matte satırı görünür', modal.matteShown === true && modal.matteHidden === true);

    const board = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const before = state.items.length;
      const result = await d.exporter.capture({ pass: 'beauty', scale: 1, background: 'transparent' });
      const ok = await d.board.sendResults([result]);
      /* Pano yazımı odağa duyarlı: odak başka penceredeyken Chromium
         "document is not focused" reddi verir. window.focus() çağrısı
         odak değişimini bir sonraki görev döngüsünde uygular; bu yüzden
         yazmayı hemen denemek gerçek bir reddi değil, henüz oturmamış
         odağı ölçer. Odak gerçekten oluşana kadar sınırlı yokla, sonra
         yaz. Üç denemede de yazılamazsa bu gerçek bir hatadır. */
      const waitFocused = async (timeout = 1500) => {
        const t0 = performance.now();
        while (!document.hasFocus()) {
          if (performance.now() - t0 > timeout) return false;
          await new Promise(r => setTimeout(r, 16));
        }
        return true;
      };
      let clipboard = false;
      let attempts = 0;
      let focused = false;
      for (let i = 0; i < 3 && !clipboard; i++) {
        attempts = i + 1;
        window.focus();
        focused = await waitFocused();
        clipboard = await d.exporter.copyToClipboard(result);
        if (!clipboard) await new Promise(r => setTimeout(r, 200));
      }
      return JSON.stringify({
        ok, before, after: state.items.length, sent: d.board.sent, last: d.board.lastCount,
        file: result ? d.board.fileName(result) : '',
        clipboard, attempts, focused,
        legacy: String(d.exporter.quickCapture() || '').startsWith('data:image/png'),
      });
    })()`));

    check('tahtaya yeni öğe düşüyor', board.ok === true && board.after === board.before + 1,
      `${board.before} → ${board.after} · ${board.file}`);
    check('panoya PNG kopyalanıyor', board.clipboard === true,
      `pano=${board.clipboard} · deneme=${board.attempts} · odak=${board.focused}`);
    check('hızlı yakalama data URL korunuyor', board.legacy === true);

    /* 8 Kasım sözleşmesi: 3D modu HER ZAMAN tam ekrandır. ⤢ büyütme ve
       ⚙ ayar çipi/popup kaldırıldı; tam ekrandayken ⤢ no-op olmalı ve
       sahneye tıklamak tam ekrandan çıkarmamalı. */
    const expandedPopup = JSON.parse(await evaluate(ws, `(async () => {
      const panel = document.querySelector('#pose3dPanel');
      const expand = document.querySelector('#btnPose3dExpand');
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const wasFullscreen = panel.classList.contains('pose3d-fullscreen');
      const w0 = Math.round(panel.getBoundingClientRect().width);
      expand.click();
      await wait(250);
      const unchanged = panel.classList.contains('pose3d-fullscreen') === wasFullscreen
        && Math.abs(Math.round(panel.getBoundingClientRect().width) - w0) <= 2;
      /* Sentetik pointerdown doğrudan tuvale gönderilirse OrbitControls /
         TransformControls setPointerCapture'ta hata veriyor. Görünüm kabına
         göndererek aynı "ekrana tıklama" yolunu hatasız sınıyoruz. */
      panel.querySelector('.poseViewport').dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 8, clientX: 40, clientY: 300,
      }));
      await wait(120);
      const stillFullscreen = !panel.hidden && panel.classList.contains('pose3d-fullscreen');
      return JSON.stringify({ wasFullscreen, unchanged, stillFullscreen });
    })()`));
    check('tam ekranda ⤢ büyütme no-op (3D modu her zaman tam ekran)',
      expandedPopup.wasFullscreen === true && expandedPopup.unchanged === true,
      `öncü tam ekran=${expandedPopup.wasFullscreen} · değişmedi=${expandedPopup.unchanged}`);
    check('tam ekranda sahneye tıklama tam ekrandan çıkarmıyor',
      expandedPopup.stillFullscreen === true);

    /* Tam ekran: panel viewport'u kaplar, tekrar basınca eski ölçüye döner. */
    const fullscreenOn = JSON.parse(await evaluate(ws, `(async () => {
      const btn = document.querySelector('#btnPose3dFullscreen');
      const panel = document.querySelector('#pose3dPanel');
      const canvas = document.querySelector('#pose3dCanvas');
      const head = panel.querySelector('.pose3dHead');
      const stack = panel.querySelector('.poseStack');
      const stackItem = panel.querySelector('.poseStackItem');
      const exitBtn = document.querySelector('#poseFullscreenExit');
      /* Çık chip'i kaldırıldı (kullanıcı 8 Kasım): çıkış üst mod çubuğu ile. */
      const rect = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const view = () => ({ w: innerWidth, h: innerHeight });
      const before = { panel: rect(panel), canvas: rect(canvas) };
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      const on = {
        cls: panel.classList.contains('pose3d-fullscreen'),
        native: document.fullscreenElement === document.documentElement,
        pressed: btn.getAttribute('aria-pressed'),
        panel: rect(panel),
        canvas: rect(canvas),
        view: view(),
        body: document.body.classList.contains('pose3d-fullscreen-open'),
        head: getComputedStyle(head).display,
        stackVisible: getComputedStyle(stack).display !== 'none' && rect(stackItem).w > 100,
        exitChip: !!exitBtn,
      };
      return JSON.stringify({ before, on });
    })()`));
    /* Gerçek fare tıklaması kullan: sentetik pointerdown, vendor
       kontrollerinde (OrbitControls/TransformControls) setPointerCapture
       hatası üretiyordu. */
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 320, button: 'none' });
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 320, button: 'left', clickCount: 1 });
    await sleep(60);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: 320, button: 'left', clickCount: 1 });
    await sleep(300);
    const stillOpen = await evaluate(ws, `document.querySelector('#pose3dPanel').classList.contains('pose3d-fullscreen')`);
    /* Çıkış HUD chip'i gerçek kullanıcı yoludur. */
    const fullscreenOff = JSON.parse(await evaluate(ws, `(async () => {
      const btn = document.querySelector('#btnPose3dFullscreen');
      const panel = document.querySelector('#pose3dPanel');
      const canvas = document.querySelector('#pose3dCanvas');
      const head = panel.querySelector('.pose3dHead');
      const stack = panel.querySelector('.poseStack');
      const rect = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      /* Çıkış: chip kaldırıldı — üst mod çubuğundaki modeExit3d köprüsü
         gerçek kullanıcı yolu (Referans/Çizim sekmesi). */
      window.modeExit3d();
      await new Promise(r => setTimeout(r, 700));
      const off = {
        cls: panel.classList.contains('pose3d-fullscreen'),
        native: !!document.fullscreenElement,
        pressed: btn.getAttribute('aria-pressed'),
        panel: rect(panel),
        canvas: rect(canvas),
        body: document.body.classList.contains('pose3d-fullscreen-open'),
        head: getComputedStyle(head).display,
        stackVisible: getComputedStyle(stack).display !== 'none',
      };
      return JSON.stringify(off);
    })()`));
    const fullscreen = { ...fullscreenOn, stillOpen, off: fullscreenOff };
    check('tam ekran düğmesi 3D viewport\'u ekrana yayıyor',
      (fullscreen.on.cls || fullscreen.on.native) && fullscreen.on.pressed === 'true'
        && Math.abs(fullscreen.on.canvas.w - fullscreen.on.view.w) <= 2
        && Math.abs(fullscreen.on.canvas.h - fullscreen.on.view.h) <= 2
        && fullscreen.on.head === 'none'
        && fullscreen.on.stackVisible === true
        && fullscreen.on.exitChip === false && fullscreen.on.body === true,
      `tuval ${fullscreen.on.canvas.w}×${fullscreen.on.canvas.h} · görünüm ${fullscreen.on.view.w}×${fullscreen.on.view.h} · yüzen kartlar=${fullscreen.on.stackVisible} · native=${fullscreen.on.native}`);
    check('tam ekranda ekrana tıklamak tam ekrandan çıkarmıyor',
      fullscreen.stillOpen === true);
    check('tam ekrandan çıkış (üst mod çubuğu) çalışıyor',
      !fullscreen.off.cls && fullscreen.off.pressed === 'false' && !fullscreen.off.body);
    check('tam ekrandan çıkınca tam ekran bitiyor (mod çubuğu köprüsü)',
      !fullscreen.off.cls && !fullscreen.off.native && fullscreen.off.pressed === 'false'
        && !fullscreen.off.body,
      `sınıf kalktı · aria-pressed=${fullscreen.off.pressed} · body kipi ${fullscreen.off.body}`);

    /* P6: her modül dispose() sunmalı (P0 kabul kriteri). */
    const audit = JSON.parse(await evaluate(ws, `(async () => {
      const paths = [
        '/pose3d/core/Viewport.js',
        '/pose3d/core/CameraManager.js',
        '/pose3d/core/SceneGraph.js',
        '/pose3d/core/RenderPipeline.js',
        '/pose3d/environment/Environment.js',
        '/pose3d/environment/LightingRig.js',
        '/pose3d/posing/Rig.js',
        '/pose3d/posing/PosingController.js',
        '/pose3d/posing/GizmoManager.js',
        '/pose3d/posing/PoseHistory.js',
        '/pose3d/posing/PoseLibrary.js',
        '/pose3d/capture/RenderExporter.js',
        '/pose3d/bridge/BoardBridge.js',
        '/pose3d/ui/Hud.js',
        '/pose3d/ui/Guides.js',
        '/pose3d/ui/CaptureModal.js',
        '/pose3d/ui/PanelController.js',
      ];
      const missing = [];
      let classes = 0;
      for (const path of paths) {
        const mod = await import(path);
        for (const [name, value] of Object.entries(mod)) {
          if (typeof value !== 'function') continue;
          if (!/^class\\b/.test(Function.prototype.toString.call(value))) continue;
          classes++;
          if (typeof value.prototype.dispose !== 'function') missing.push(path.split('/').pop() + ':' + name);
        }
      }
      return JSON.stringify({ modules: paths.length, classes, missing });
    })()`));
    check('tüm 3D sınıfları dispose() sunuyor',
      audit.missing.length === 0 && audit.classes >= audit.modules,
      `${audit.classes} sınıf / ${audit.modules} modül`);

    /* --- 12 Kasım regresyon bloğu: lens/kontrolcü/sıfırla/tam ekran --- */

    /* 1) Uzun odak karakteri yok etmemeli: setLens kamera geri kaydırır,
       uzak düzlem mesafeye uymalı (kullanıcı: 400 mm'de her şey kayboluyordu). */
    const longLens = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const cam = d.cameraManager;
      const slider = document.querySelector('#poseLens');
      const before = slider.value;
      slider.value = '400';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const dist = cam.persp.position.distanceTo(cam.controls.target);
        cam.persp.updateProjectionMatrix();
        const fits = cam.persp.far >= dist * 2 && cam.persp.near < dist;
        const far = cam.persp.far;
        slider.value = before;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        resolve(JSON.stringify({ dist, far, fits, near: cam.persp.near }));
      })));
    })()`));
    check('400 mm lens uzak düzlemi mesafeye uyduruyor',
      Number(longLens.far) >= Number(longLens.dist) * 2 && longLens.fits,
      `mesafe=${Number(longLens.dist).toFixed(1)} · far=${longLens.far.toFixed(1)} · near=${Number(longLens.near).toFixed(3)}`);

    /* 2) R artık kontrolcü BOYUTUNU büyütür; ölçekleme gizmosu tutamacı
       şişiremez (kontrolcü kendisi büyüyordu). R düğmesi (#poseGizmoScale)
       ve R tuşu aynı cycleControllerSize yolunu kullanır. */
    const rKey = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const slider = document.querySelector('#poseControllerSize');
      const start = slider.value;
      const button = document.querySelector('#poseGizmoScale');
      button?.click();
      const after1 = slider.value;
      button?.click();
      const after2 = slider.value;
      slider.value = start;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      /* Ölçek gizmosu kontrolcü şişirtemez: objectChange + kare sonrası
         followBones kendi kendini onarmalı. */
      const G = d.posing.gizmo;
      const handle = d.posing.handles[0];
      const prevMode = G.mode;
      const prevScale = handle.scale.x;
      G.attach(handle);
      d.panelController?.setGizmoMode
        ? d.panelController.setGizmoMode('scale')
        : G.setMode('scale');
      handle.scale.setScalar(prevScale * 20);
      G.controls.dispatchEvent({ type: 'objectChange' });
      await new Promise(r => requestAnimationFrame(r));
      const scaleAfterFrame = handle.scale.x;
      G.setMode(prevMode);
      G.detach();
      return JSON.stringify({ after1, after2, scaleAfterFrame, expected: prevScale });
    })()`));
    check('R tuşu kontrol boyutunu büyütüyor (150→200→250)',
      rKey.after1 === '200' && rKey.after2 === '250',
      `${rKey.after1} → ${rKey.after2}`);
    check('ölçekleme gizmosu kontrolcüyü şişiremiyor',
      Math.abs(rKey.scaleAfterFrame - rKey.expected) < 1e-6,
      `kare sonrası ölçek=${rKey.scaleAfterFrame}`);

    /* 3) Bağlı tutamaç kemiğini izlemeye devam ediyor ("kontroller
       dışarıda kalıyor" regresyonu): gizmo bağlıyken T-pose uygula,
       tutamaç yeni kemik konumuna gelsin. */
    const followFix = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const handle = d.posing.handles.find(h => String(h.userData.bone?.name || '').toLowerCase().includes('hand'));
      if (!handle) return JSON.stringify({ skipped: true });
      const G = d.posing.gizmo;
      G.attach(handle);
      const before = handle.position.clone();
      d.posing.resetBase();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = handle.position.clone();
      /* Bone'un gerçek dünya konumu: import edilen Vector3 ile hesapla. */
      const T = await import('/vendor/three.module.js');
      const boneWorld = handle.userData.bone.getWorldPosition(new T.Vector3());
      G.detach();
      return JSON.stringify({
        moved: before.distanceTo(after) > 1e-4,
        tracksBone: handle.position.distanceTo(boneWorld) < 1e-3,
      });
    })()`));
    check('bağlı tutamaç kemiği izlemeye devam ediyor',
      followFix.moved === true && followFix.tracksBone === true,
      `moved=${followFix.moved} · tracksBone=${followFix.tracksBone}`);

    /* 4) "Her şeyi sıfırla": tüm karakterler bağ duruşuna döner, geçmiş
       temizlenir, kamera yeniden çerçevelenir. */
    const resetEverything = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const entry = d.characterManager?.list?.find(c => c.ready) || d.characterManager?.get?.('female');
      if (!entry?.rig) return JSON.stringify({ skipped: true });
      /* Bozuk bir poz simüle et: bir kemiği döndür. */
      const bone = entry.rig.bones.find(b => String(b.name || '').toLowerCase().includes('forearm'));
      if (bone) bone.quaternion.set(0.7, 0.7, 0.1, 0.1);
      const before = bone?.quaternion.clone();
      entry.rig.root?.updateMatrixWorld(true);
      const click = document.querySelector('#poseResetEverything');
      click?.click();
      await new Promise(r => setTimeout(r, 700));
      return JSON.stringify({
        exists: !!click,
        identity: before ? Math.abs(entry.rig.bones.find(b => b === bone).quaternion.w) > 0.99 : null,
        historyCleared: entry.history ? !entry.history.canUndo : null,
      });
    })()`));
    check('"Her şeyi sıfırla" düğmesi pozları bağ duruşuna döndürüyor',
      resetEverything.exists === true && resetEverything.identity === true,
      `düğme=${resetEverything.exists} · identity=${resetEverything.identity}`);
    check('"Her şeyi sıfırla" poz geçmişini temizliyor',
      resetEverything.historyCleared === true,
      `historyCleared=${resetEverything.historyCleared}`);
    /* Ayarlar penceresi (3D sütunu) aynı işlevi köprüyle çağırır. */
    check('Ayarlar sıfırlama köprüsü hazır',
      await evaluate(ws, `JSON.stringify(typeof window.tailrefPose3dEverything === 'function')`) === 'true',
      'tailrefPose3dEverything köprüsü');

    /* 4b) Hız ve Performans: otomatik kalite vitesi + elle seçim sözü.
       Elle seçim → otomatik kapanır ve kalıcı yazılır; governor'dan
       gelen kısılma otomatiği KAPATMAZ (otomatik çalışıyor demektir). */
    const perfUi = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const pc = d.panelController;
      const out = {};
      out.bridge = typeof window.tailrefPose3dPerf === 'object'
        && typeof window.tailrefPose3dPerf?.level === 'function';
      try { localStorage.removeItem('tailref-q3d-level'); } catch { }
      /* Governor yolunda ('perf') otomatik kapanmamalı. */
      pc.applyQuality('medium', 'perf');
      await new Promise(r => setTimeout(r, 60));
      out.governorQuality = pc.pipeline.quality;
      out.governorKeptAuto = localStorage.getItem('tailref-q3d-level') !== 'medium';
      /* Elle yolunda ('ui' yolu) otomatik kapanıp kalıcı yazılmalı. */
      pc.applyQuality('medium', 'ui');
      await new Promise(r => setTimeout(r, 60));
      out.manualQuality = pc.pipeline.quality;
      out.manualPersisted = localStorage.getItem('tailref-q3d-level') === 'medium';
      /* Otomatik'e dönüş: kayıt 'auto' olur, gözcü penceresi sıfırlanır. */
      pc.perfSetAuto();
      out.autoAfterBack = localStorage.getItem('tailref-q3d-level') === 'auto'
        && pc.perf.level === 'auto';
      out.summaryExists = !!document.getElementById('settingsPerfSummary');
      out.q3dSelectExists = !!document.getElementById('settingsPerfQ3dSelect');
      /* Durum temizle. */
      pc.applyQuality('high', 'perf');
      return JSON.stringify(out);
    })()`));
    check('Hız/Performans köprüsü hazır', perfUi.bridge, 'tailrefPose3dPerf');
    check('governor kısılmasında otomatik kapanmıyor', perfUi.governorKeptAuto,
      `kalite=${perfUi.governorQuality} · kayıt=auto`);
    check('elle seçim otomatiği kapatıyor ve kalıcı yazılıyor',
      perfUi.manualPersisted && perfUi.manualQuality === 'medium',
      `kayıt=medium`);
    check('"Otomatik\'e dön" gözcüyü geri açıyor', perfUi.autoAfterBack);
    check('Ayarlar "Hız ve Performans" bölümü mevcut',
      perfUi.summaryExists && perfUi.q3dSelectExists);

    /* 4c) Teşhis paneli (Ctrl+Alt+P): kapalı-başlar, köprüyle açılır,
       satırlar dolar, kapatınca gider. */
    const diagUi = JSON.parse(await evaluate(ws, `(async () => {
      const out = {};
      out.toggleFn = typeof window.tailrefPerfDiagToggle === 'function';
      out.hiddenByDefault = document.getElementById('perfDiag') === null
        || document.getElementById('perfDiag').hidden;
      window.tailrefPerfDiagToggle(true);
      await new Promise(r => setTimeout(r, 650));
      const el = document.getElementById('perfDiag');
      out.shows = !!el && !el.hidden;
      out.summary = el ? el.querySelector('[data-summary]')?.textContent || '' : '';
      out.rowCount = el ? el.querySelectorAll('[data-rows] > span').length : 0;
      const vp = window.__pose3dDebug?.viewport;
      out.hasRenderTimes = Array.isArray(vp?._renderTimes);
      out.saveStats = JSON.stringify(window.__tailrefLastSaveStats || null);
      window.tailrefPerfDiagToggle(false);
      await new Promise(r => setTimeout(r, 60));
      out.hiddenAfter = !el || el.hidden;
      out.timerCleared = !el || el.hidden;   // zaten gizli — fs kapanış göstergesi
      return JSON.stringify(out);
    })()`));
    check('Teşhis paneli köprüsü hazır ve kapalı başlıyor',
      diagUi.toggleFn && diagUi.hiddenByDefault);
    check('Teşhis paneli açılınca satırlarla doluyor',
      diagUi.shows && diagUi.rowCount > 0, `${diagUi.rowCount} satır · "${(diagUi.summary || '').slice(0, 40)}"`);
    check('Teşhis paneli kapatınca kayboluyor', diagUi.hiddenAfter);

    /* 5) Karakter boyutu kaydırıcısı: dev/peri ölçek pano kaydına girer. */
    const charScale = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const mgr = d.characterManager;
      const male = mgr.get?.('male') || mgr.list?.find(c => c.id === 'male');
      if (!male?.ready || !male.graph?.root) return JSON.stringify({ skipped: true });
      const base = male.graph.root.scale.x;
      const set = mgr.setScale ? mgr.setScale('male', 5) : null;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const devScaled = male.graph.root.scale.x;
      /* Kaydırıcı UI*: erkek satırındaki input gerçekten var mı? */
      const slider = document.querySelector('#poseCharList input[data-char-id="male"]');
      const sliderVal = Number(slider?.value);
      const roundRobin = mgr.setScale('male', 1);
      await new Promise(r => setTimeout(r, 450));
      return JSON.stringify({
        base, set, devScaled,
        ratioDev: Number((devScaled / base).toFixed(2)),
        sliderExists: !!slider && sliderVal === 1,
        reset1: roundRobin,
        ratioReset: Number((male.graph.root.scale.x / base).toFixed(2)),
        saved: (mgr.listForSave?.() || []).find(c => c.id === 'male')?.scale,
      });
    })()`));
    check('erkek karakter 5× (dev) ölçekleniyor',
      charScale.ratioDev === 5 && charScale.set === 5,
      `taban=${charScale.base} · çarpan sonrası oran=${charScale.ratioDev}`);
    check('karakter satırında boyut kaydırıcısı var',
      charScale.sliderExists === true,
      `slider=${charScale.sliderExists}`);
    check('karakter boyutu 1× sıfırlanabiliyor ve kayda giriyor',
      charScale.ratioReset === 1 && charScale.saved === 1,
      `oran=${charScale.ratioReset} · kayıt=${charScale.saved}`);

    /* 6) Kamera boyut değişiminde rahat: setScale hedefi/konumu oynatmaz
       (kullanıcı: "kamera garip hareketler yapıyor"). */
    const camSteady = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const cm = d.cameraManager;
      const before = d.viewport.camera.position.distanceTo(cm.target);
      const pos0 = d.viewport.camera.position.clone();
      d.characterManager.setScale('male', 5);
      d.characterManager.setScale('male', 1);
      d.characterManager.setScale('female', 0.2);
      d.characterManager.setScale('female', 1);
      return JSON.stringify({
        posMoved: Number(pos0.distanceTo(d.viewport.camera.position).toFixed(5)),
      });
    })()`));
    check('boyut çarkına kamera tepmiyor', camSteady.posMoved === 0,
      `konum kayması=${camSteady.posMoved}`);

    /* 7) Çoklu karakter pozu: Kaydet iki karakteri TEK kaytta toplar;
       yükleyince ikisine de uygulanır. Test kaydı sonda silinir. */
    const saveMulti = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const pc = d.panelController;
      const nameInput = document.querySelector('#poseQuickName');
      const prev = nameInput.value;
      nameInput.value = 'CifteTest';
      try { await pc.savePreset(); } finally { nameInput.value = prev; }
      const rec = pc.library.items.find(i => i.name === 'CifteTest');
      if (!rec) return JSON.stringify({ ok: false });
      const loaded = await pc.loadPreset(rec.id);
      const info = JSON.stringify({
        ok: true, loaded,
        chars: Object.keys(rec.characters || {}),
        female: rec.characters?.female?.bones?.length || 0,
        male: rec.characters?.male?.bones?.length || 0,
      });
      await pc.library.remove(rec.id);
      await pc.refreshPresetList();
      return info;
    })()`));
    check('kayıt iki karakteri tek kayıtta topluyor',
      saveMulti.ok && saveMulti.chars.includes('female') && saveMulti.chars.includes('male'),
      `karakterler=${saveMulti.chars} · kız=${saveMulti.female} kemik · erkek=${saveMulti.male} kemik`);
    check('çoklu kayıt yüklemesi iki karaktere uygulanıyor',
      saveMulti.loaded === true,
      `loadPreset=${saveMulti.loaded}`);

    /* 8) Ölçek değişimi geri alınabilir: Ctrl+Z büyütme/küçültmeyi
       geri getirir, redo yeniden uygular (kullanıcı, 9 Kasım). */
    const undoScale = JSON.parse(await evaluate(ws, `(async () => {
      const d = window.__pose3dDebug;
      const cm = d.characterManager;
      const male = cm.get('male');
      cm.activate('male');
      const base = male.graph.root.scale.x;
      cm.setScale('male', 5);
      const grown = Number((male.graph.root.scale.x / base).toFixed(2));
      d.panelController.posing.undo();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const undone = Number((male.graph.root.scale.x / base).toFixed(2));
      const slider = document.querySelector('#poseCharList input[data-char-id="male"]');
      const sliderVal = Number(slider?.value);
      d.panelController.posing.redo();
      const redone = Number((male.graph.root.scale.x / base).toFixed(2));
      cm.setScale('male', 1, { noHistory: true });
      return JSON.stringify({ grown, undone, redone, sliderVal });
    })()`));
    check('büyütme Ctrl+Z ile geri alınıyor ve kaydırıcı güncelleniyor',
      undoScale.grown === 5 && undoScale.undone === 1 && undoScale.sliderVal === 1,
      `5×=${undoScale.grown} · geri al=${undoScale.undone} · kaydırıcı=${undoScale.sliderVal}×`);
    check('geri alınan ölçek yinele ile (redo) geri geliyor',
      undoScale.redone === 5,
      `redo=${undoScale.redone}`);

    /* P5b · FAZ 2: pose3d tek tuşları keymap'ten çözülür. Yeniden atama
       gerçek keydown'ı değiştirir; eski tuş sönme yapar; Ctrl+Shift+Z
       paritesi (imza ctrl+z) redo yapmaya devam eder. */
    const kmKeys = JSON.parse(await evaluate(ws, `(async () => {
      const km = window.tailrefKeymap;
      const d = window.__pose3dDebug;
      const pc = d.panelController;
      const cam = d.cameraManager;
      const cm = d.characterManager;
      /* Panel bu akışta dış-tıkla kapanmış olabilir: garantili aç. */
      const panelEl = document.querySelector('#pose3dPanel');
      if (panelEl.hidden) { if (window.tailrefOpenPanel) window.tailrefOpenPanel(panelEl); else panelEl.hidden = false; }
      pc.pointerInside = true;
      const out = {};
      const evProbe = new KeyboardEvent('keydown', { key: 'k' });
      out.diag = {
        hidden: pc.panel.hidden,
        ka: pc.keysActive(evProbe),
        sig: km.signatureFromEvent(new KeyboardEvent('keydown', { key: 'k', cancelable: true })),
        af: km.actionFor('k', 'pose3d'),
        set: km.set('pose3d.cameraMode', 'k').ok,
        mode0: cam.mode,
      };
      /* 1) Yeniden atama: pose3d.cameraMode 'k'ye taşınır; 'k' modu
         değiştirir, '5' artık değiştirmez. */
      const mode0 = cam.mode;
      const evK = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });
      window.dispatchEvent(evK);
      const mode1 = cam.mode;
      const ev5 = new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true });
      window.dispatchEvent(ev5);
      const mode2 = cam.mode;
      km.reset('pose3d.cameraMode');
      out.rebind = mode0 !== mode1 && mode1 === mode2;
      out.prevented = evK.defaultPrevented && !ev5.defaultPrevented;
      out.modes = [mode0, mode1, mode2];
      /* 2) Ctrl+Z → undo, Ctrl+Shift+Z → redo (imza motoru shift'i
         ctrl+X'te yutar; parite bu özel durumda korunur). */
      const male = cm.get('male');
      cm.activate('male');
      const base = male.graph.root.scale.x;
      cm.setScale('male', 5);
      const evUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(evUndo);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const undone = Number((male.graph.root.scale.x / base).toFixed(2));
      const evRedo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(evRedo);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const redone = Number((male.graph.root.scale.x / base).toFixed(2));
      cm.setScale('male', 1, { noHistory: true });
      out.undoRedo = undone === 1 && redone === 5;
      out.scales = [undone, redone];
      pc.pointerInside = false;
      return JSON.stringify(out);
    })()`));
    check("FAZ 2: pose3d.cameraMode 'k'ye taşınıyor; '5' sönüyor (keymap gerçek keydown)",
      kmKeys.rebind === true && kmKeys.prevented === true,
      `modlar=${JSON.stringify(kmKeys.modes)} · prevented=${JSON.stringify(kmKeys.prevented)} · teşhis=${JSON.stringify(kmKeys.diag)}`);
    check('FAZ 2: Ctrl+Z undo · Ctrl+Shift+Z redo (pose paritesi)',
      kmKeys.undoRedo === true,
      `ölçekler=${JSON.stringify(kmKeys.scales)} (1 → 5)`);

    /* P6: tek noktadan kapatma gerçekten çalışmalı ve tekrar çağrıda false dönmeli. */
    const teardown = JSON.parse(await evaluate(ws, `(() => {
      const d = window.__pose3dDebug;
      const renderer = d.renderer;
      const before = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
      const rawFirst = window.tailrefDispose3d?.();
      const rawSecond = window.tailrefDispose3d?.();
      const after = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
      return JSON.stringify({
        first: rawFirst === true, second: rawSecond === false,
        raw: [rawFirst, rawSecond],
        ready: window.__pose3dReady,
        debug: window.__pose3dDebug,
        before, after,
        stats: window.__pose3dTeardownStats?.length || 0,
      });
    })()`));
    check('kapatma zinciri kaynakları bırakıyor',
      teardown.first && teardown.second && teardown.ready === false && teardown.debug === null,
      `dönüş=${JSON.stringify(teardown.raw)}`);
    check('kapatma sonrası GPU kaynakları bırakıldı',
      teardown.after.geometries <= 1 && teardown.after.textures <= 2
        && teardown.stats === 18,
      `${teardown.before.geometries} geo / ${teardown.before.textures} tex → ${teardown.after.geometries} / ${teardown.after.textures}`);

    check('konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

    console.log(`\n${fail ? 'BAŞARISIZ' : 'TÜM TESTLER GEÇTİ'} (${pass}/${pass + fail})`);
  } catch (error) {
    console.error('HATA:', error.message);
    console.error('STACK:', String(error.stack).split('\n').slice(0, 6).join('\n'));
    if (errors.length) console.error('Sayfa hataları:\n' + errors.join('\n'));
    fail++;
  } finally {
    try { ws && ws.close(); } catch { /* yoksay */ }
    app.kill();
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
    process.exit(fail ? 1 : 0);
  }
})();
