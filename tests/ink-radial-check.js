'use strict';

/* Sağ tık dairesel hızlı panel (Apple tarzı cam disk) için odaklı test.

   Kapsam:
   • Çizim modunda sağ tık paneli açıyor mu?
   • 4 araç yuvası pusula düzeninde (+88px, -90/0/90/180°) ve eşit mi?
   • Üst fırça yuvası geçerli fırça karosu, kapsülde son fırçalar mı?
   • Merkez renk diski: disk rengi = geçerli renk, ton yaprağı rengi yazar
   • Boyut/Opaklık/Yumuşatma sürgüleri disk ALTINDAKİ yuvada ve motora yazar
   • Esc / dışarı tıklama kapatır
   • WACOM: uç temasta (pointerdown sürerken) sağ tık menüyü AÇMAZ;
     bırakınca akıl alır (300ms sessizlik) tekrar açılır
   • buttons&1 (sol basılıyken sentetik sağ tık) menüyü açmaz

   Kullanım: node tests/ink-radial-check.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9340;
const APP_PORT = 5203;
const OUT = path.join(os.tmpdir(), 'tailref-radial');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const electronPath = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const evaluate = (ws, expression) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) {
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

const send = (ws, method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== id) return;
    ws.removeEventListener('message', onMsg);
    resolve(msg.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

async function waitForTarget(deadlineMs = 30000) {
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
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-radial-check-'));
  const env = { ...process.env, TailRef_USER_DATA: userDataDir, TailRef_PORT: String(APP_PORT), TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  const errors = [];
  let ws = null;
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      socket.onopen = () => resolve(socket);
      socket.onerror = reject;
    });
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description || d.text || 'bilinmeyen hata');
      }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    await send(ws, 'Page.enable');

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth && typeof inkState === 'function'");
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error('renderer hazır olmadı');

    const result = JSON.parse(await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('modeDrawBtn').click();
      await wait(260);
      document.getElementById('newCanvasW').value = '500';
      document.getElementById('newCanvasH').value = '340';
      document.getElementById('newCanvasName').value = 'Radial Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(500);
      out.editorOpen = inkEditorIsOpen();
      if (!out.editorOpen) return JSON.stringify(out);

      out.closedInitially = !document.querySelector('.inkRadial') ||
        document.querySelector('.inkRadial').hidden === true;

      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 2,
      }));
      await wait(300);
      const panel = document.querySelector('.inkRadial');
      out.panel = !!panel;
      out.open = !!panel && panel.hidden === false && panel.classList.contains('is-open');
      if (!panel) return JSON.stringify(out);
      const prect = panel.getBoundingClientRect();
      out.rect = prect.toJSON();

      /* --- yüzey: 240px cam disk + dock --- */
      const disk = panel.querySelector('.inkRadialDisk');
      const dock = panel.querySelector('.inkRadialDock');
      const pcs = disk ? getComputedStyle(disk) : null;
      out.surface = {
        diskW: pcs ? pcs.width : '',
        diskH: pcs ? pcs.height : '',
        background: pcs ? pcs.backgroundColor : '',
        backdrop: pcs ? pcs.backdropFilter : '',
        border: pcs ? pcs.borderTopWidth + ' ' + pcs.borderTopColor : '',
        dockW: dock ? getComputedStyle(dock).width : '',
      };
      out.dockBelow = !!(disk && dock && dock.getBoundingClientRect().top >= disk.getBoundingClientRect().bottom - 2);

      /* --- 4 yuva pusula düzeni --- */
      const dcx = disk.getBoundingClientRect().left + disk.clientWidth / 2;
      const dcy = disk.getBoundingClientRect().top + disk.clientHeight / 2;
      const slots = [...panel.querySelectorAll('.inkRadialSlot')].filter(b => b.getBoundingClientRect().width > 0);
      out.slots = slots.map(b => {
        const r = b.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - dcx;
        const dy = (r.top + r.height / 2) - dcy;
        return {
          pos: b.className.includes('pos-n') ? 'n' : b.className.includes('pos-e') ? 'e'
            : b.className.includes('pos-s') ? 's' : 'w',
          radius: Math.round(Math.hypot(dx, dy)),
          angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI),
          w: Math.round(r.width), h: Math.round(r.height),
          icon: !!b.querySelector('svg'),
          tile: !!b.querySelector('canvas'),
        };
      });
      out.toolAfterSlotClick = null;
      /* silgi yuvasına tıkla → araç değişmeli ve panel kapanmalı */
      const eraser = slots.find(s => s.pos === 'e');
      const eraserEl = slots.length ? [...panel.querySelectorAll('.inkRadialSlot')].find(b => b.className.includes('pos-e')) : null;
      if (eraserEl) {
        eraserEl.click();
        await wait(320);
        out.toolAfterSlotClick = inkState().tool;
        out.closedAfterSlot = panel.hidden === true;
        /* fırçaya geri dön */
        if (typeof inkSetTool === 'function') inkSetTool('brush');
        panel.hidden = false;
        panel.classList.add('is-open');
        /* yeniden render etmeyi tetiklemek için kapat/aç */
        panel.hidden = true;
        panel.classList.remove('is-open');
      }

      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 2,
      }));
      await wait(260);

      /* --- üst yuva: geçerli fırça karosu --- */
      const brushBtn = panel.querySelector('.inkRadialSlot.pos-n');
      out.brushTile = !!brushBtn && !!brushBtn.querySelector('canvas');
      out.activeTop = !!brushBtn && brushBtn.classList.contains('is-active');

      /* --- kapsül: son fırçalar --- */
      const capsule = panel.querySelector('.inkRadialCapsule');
      out.capsule = !!capsule;
      const sub = [...(capsule?.querySelectorAll('.inkRadialSub') || [])].filter(b => !b.hidden);
      out.capsuleCount = sub.length;
      out.capsuleTiles = sub.filter(b => b.querySelector('canvas')).length;
      out.capsuleNamed = sub.filter(b =>
        (b.querySelector('.inkRadialSubName')?.textContent || '').length > 0).length;
      const ink = inkState();
      const current = ink.brushId;
      out.currentBrush = current;
      out.recentBefore = JSON.parse(localStorage.getItem('tailref-recent-brushes-v1') || '[]');
      const target = sub.find(b => b.dataset.brushId && b.dataset.brushId !== current);
      out.targetBrush = target ? target.dataset.brushId : '';
      if (target) {
        target.click();
        await wait(250);
        out.brushAfterClick = inkState().brushId;
        out.recentAfterClick = JSON.parse(localStorage.getItem('tailref-recent-brushes-v1') || '[]');
      }

      /* --- merkez renk diski + klasik çark (panel yeniden açık) --- */
      /* kapsül seçimi paneli kapattı; çark olayları gerçek rect ister */
      out.reopenNeeded = panel.hidden;
      for (let i = 0; i < 3 && panel.hidden; i += 1) {
        canvas.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
          button: 2, buttons: 2,
        }));
        await wait(300);
      }
      out.panelOpenForWheel = panel.hidden === false;
      const colorEl = panel.querySelector('.inkRadialColor');
      const disc = panel.querySelector('.inkRadialColorDisc');
      const wheel = panel.querySelector('.inkRadialWheel');
      out.colorEl = !!colorEl;
      out.wheelPresent = !!wheel;
      out.discColor = disc ? disc.style.background : '';
      out.inkColorBefore = inkState().color;
      out.wheelCanvasPx = wheel ? wheel.width + 'x' + wheel.height : '';
      /* kapalıyken çark görünmez ve dokunulmaz */
      out.collapsedWheelHidden = wheel ? getComputedStyle(wheel).opacity === '0' : false;
      if (colorEl) {
        colorEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
        await wait(240);
      }
      out.diskIsColor = !!disk && disk.classList.contains('is-color');
      out.expandedWheelVisible = wheel ? getComputedStyle(wheel).opacity !== '0' : false;
      out.wheelPointerOn = wheel ? getComputedStyle(wheel).pointerEvents === 'auto' : false;
      out.wheelConnected = wheel ? wheel.isConnected : false;
      /* halka seçimi: sağ kenara (0° kırmızı yönü) bas-bırak */
      let colorAfterRing = '';
      if (wheel) {
        disk.classList.add('is-color');
        const wr = wheel.getBoundingClientRect();
        const px = wr.left + wr.width - 6;
        const py = wr.top + wr.height / 2;
        wheel.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 71, pointerType: 'mouse',
          clientX: px, clientY: py, button: 0, buttons: 1,
        }));
        await wait(60);
        colorAfterRing = inkState().color;
        wheel.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 71, pointerType: 'mouse',
          clientX: px, clientY: py, button: 0, buttons: 0,
        }));
        await wait(120);
      }
      out.colorAfterRing = colorAfterRing;
      out.colorChangedByRing = colorAfterRing !== out.inkColorBefore;
      /* üçgen seçimi: C köşesi (sağ uç) → saf doygun renk */
      let colorAfterTri = '';
      if (wheel) {
        const wr = wheel.getBoundingClientRect();
        const px = wr.left + 121;
        const py = wr.top + wr.height / 2;
        wheel.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 72, pointerType: 'mouse',
          clientX: px, clientY: py, button: 0, buttons: 1,
        }));
        await wait(60);
        colorAfterTri = inkState().color;
        wheel.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 72, pointerType: 'mouse',
          clientX: px, clientY: py, button: 0, buttons: 0,
        }));
        await wait(120);
      }
      out.colorAfterTri = colorAfterTri;
      out.colorChangedByTri = colorAfterTri !== colorAfterRing;
      /* çekirdek swatch çarkı izler */
      out.discColorAfter = disc ? disc.style.background : '';

      /* --- dock sürgüleri --- */
      const rows = [...panel.querySelectorAll('.inkRadialRow')];
      out.sliderLabels = rows.map(r => r.querySelector('span')?.textContent || '');
      const inputOf = keys => rows.map(r => r.querySelector('input')).find(i => i && keys.includes(i.getAttribute('aria-label')));
      const size = inputOf(['Boyut', 'Size']);
      const opacity = inputOf(['Opaklık', 'Opacity']);
      const smoothing = inputOf(['Yumuşatma', 'Smoothing']);
      if (size) { size.value = '64'; size.dispatchEvent(new Event('input', { bubbles: true })); }
      if (opacity) { opacity.value = '100'; opacity.dispatchEvent(new Event('input', { bubbles: true })); }
      if (smoothing) { smoothing.value = '28'; smoothing.dispatchEvent(new Event('input', { bubbles: true })); }
      await wait(250);
      out.size = Math.round(inkState().size);
      out.opacity = Math.round(inkState().opacity * 100);
      out.smoothing = Math.round(inkState().smoothing * 100);

      /* --- Esc kapanışı --- */
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      await wait(200);
      out.closedByEsc = panel.hidden === true;
      out.editorStillOpen = inkEditorIsOpen();

      /* --- dışarı tıklama kapanışı (yeniden gerçek açılış yolu) --- */
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 2,
      }));
      await wait(240);
      out.reopenedForOutside = panel.hidden === false;
      document.body.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse',
        clientX: 6, clientY: 6, button: 0, buttons: 1,
      }));
      await wait(160);
      document.body.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse',
        clientX: 6, clientY: 6, button: 0, buttons: 0,
      }));
      await wait(160);
      out.closedByOutside = panel.hidden === true;

      /* --- WACON nöbeti 1: uç temasta contextmenu açmaz --- */
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 21, pointerType: 'pen',
        clientX: cx, clientY: cy, button: 0, buttons: 1, pressure: 0.5,
      }));
      await wait(60);
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 1,
      }));
      await wait(220);
      out.blockedWhileContact = panel.hidden === true;

      /* nöbet 2: contact kalıntı olmadan bırakıldı; 300ms sessizlik → açılır */
      canvas.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 21, pointerType: 'pen',
        clientX: cx, clientY: cy, button: 0, buttons: 0,
      }));
      await wait(420);
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 2,
      }));
      await wait(240);
      out.reopenedAfterPenUp = panel.hidden === false;

      /* nöbet 3: sol basılıyken sentetik sağ tık (buttons=3) açmaz */
      panel.hidden = true; panel.classList.remove('is-open');
      await wait(120);
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 3,
      }));
      await wait(220);
      out.blockedWhileButtons1 = panel.hidden === true;

      /* orta tık açar */
      canvas.dispatchEvent(new MouseEvent('auxclick', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 1, buttons: 4, detail: 1,
      }));
      await wait(240);
      out.openedByMiddle = panel.hidden === false;
      panel.hidden = true; panel.classList.remove('is-open');
      await wait(120);

      /* orta tuş PAN sürüklemesi: bırakışta gelen auxclick menüyü
         AÇMAMALI (pan bırakışı ≠ menü isteği). 6px üstü hush. */
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 22, pointerType: 'mouse',
        clientX: cx, clientY: cy, button: 1, buttons: 4,
      }));
      for (let s = 1; s <= 8; s += 1) {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, pointerId: 22, pointerType: 'mouse',
          clientX: cx + s * 20, clientY: cy - s * 10, button: 1, buttons: 4,
        }));
        await wait(30);
      }
      canvas.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 22, pointerType: 'mouse',
        clientX: cx + 160, clientY: cy - 80, button: 1, buttons: 0,
      }));
      await wait(240);
      out.notOpenedAfterPan = panel.hidden === true;
      /* hush süresi (450ms) dolunca düz orta tık yine açmalı */
      await wait(600);
      canvas.dispatchEvent(new MouseEvent('auxclick', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 1, buttons: 4, detail: 1,
      }));
      await wait(240);
      out.openedAfterHush = panel.hidden === false;
      panel.hidden = true; panel.classList.remove('is-open');

      /* Mini referans panosu (ps-ref-live): gerçek tahta panel
         dikdörtgenine kırpılır; sağ/orta tık menü AÇMAMALI. Test
         sayfasında gerçek #v5RefStage zaten var — tıklar onun
         dikdörtgeninin merkezine gider. */
      const refStageEl = document.getElementById('v5RefStage');
      const refRect = refStageEl ? refStageEl.getBoundingClientRect() : null;
      out.refRectOk = !!refRect && refRect.width > 40 && refRect.height > 40;
      const rx = refRect ? Math.round(refRect.left + refRect.width / 2) : cx;
      const ry = refRect ? Math.round(refRect.top + refRect.height / 2) : cy;
      await wait(60);
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rx, clientY: ry,
        button: 2, buttons: 2,
      }));
      await wait(240);
      out.refBoardRight = panel.hidden === true;
      out.diag = {
        hitFn: typeof inkRadialRefApertureHit,
        live: document.body.classList.contains('ps-ref-live'),
        rect: (typeof dpApertureRect === 'function') ? (dpApertureRect() && JSON.stringify(dpApertureRect())) : 'FN-YOK',
        draw: (typeof modeIsDraw === 'function') ? modeIsDraw() : 'FN-YOK',
        dpDraw: document.body.classList.contains('mode-draw'),
        stage: !!document.getElementById('v5RefStage'),
      };
      canvas.dispatchEvent(new MouseEvent('auxclick', {
        bubbles: true, cancelable: true,
        clientX: rx, clientY: ry,
        button: 1, buttons: 4, detail: 1,
      }));
      await wait(240);
      out.refBoardMiddle = panel.hidden === true;
      panel.hidden = true; panel.classList.remove('is-open');
      /* Kapı yalnız pencere içindeyken: pencere dışındaki tık yine açmalı. */
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 2, buttons: 2,
      }));
      await wait(240);
      out.refBoardOutsideStillOpens = panel.hidden === false;
      panel.hidden = true; panel.classList.remove('is-open');
      await wait(60);

      out.errors = window.__checkErrs || [];
      return JSON.stringify(out);
    })()`));

    check('çizim editörü açıldı', result.editorOpen === true, '');
    check('panel başlangıçta kapalı', result.closedInitially === true, '');
    check('sağ tık paneli açtı', result.open === true, result.rect
      ? `sol=${Math.round(result.rect.left)} üst=${Math.round(result.rect.top)}`
      : '');

    const surface = result.surface || {};
    check('cam disk 240×240 px', surface.diskW === '240px' && surface.diskH === '240px',
      `${surface.diskW} × ${surface.diskH}`);
    check('diskin arkasında cam bulanıklığı var (blur+saturate)',
      /blur/.test(String(surface.backdrop)) && /saturate/.test(String(surface.backdrop)),
      String(surface.backdrop || '').slice(0, 60));
    check('dock disk altında ayrı yuva', result.dockBelow === true, '');
    check('dock 240px genişlikte', surface.dockW === '240px', surface.dockW);

    const geom = Array.isArray(result.slots) ? result.slots : [];
    const radiusOk = geom.length === 4 && geom.every(g => Math.abs(g.radius - 88) <= 4);
    const expectedAngles = { n: -90, e: 0, s: 90, w: 180 };
    const angleOk = geom.length === 4 && geom.every(g => {
      const want = expectedAngles[g.pos];
      const diff = Math.abs(((g.angle - want) % 360 + 540) % 360 - 180);
      return diff <= 4;
    });
    const sameSize = geom.length === 4 && geom.every(g => g.w === geom[0].w && g.h === geom[0].h);
    check('4 araç yuvası +88px pusula düzeninde', radiusOk && angleOk,
      geom.map(g => `${g.pos}:${g.angle}°/${g.radius}px`).join(' '));
    check('yuvalar eşit boyutta', sameSize, geom.map(g => `${g.w}×${g.h}`).join(' '));
    check('araç yuvalarında SVG ikonlar', geom.filter(g => g.pos !== 'n').every(g => g.icon),
      geom.map(g => `${g.pos}:ikon=${g.icon}`).join(' '));
    check('yukadı silgi tıkı aracı değiştirdi + kapandı',
      result.toolAfterSlotClick === 'eraser' && result.closedAfterSlot === true,
      `araç=${result.toolAfterSlotClick} kapandı=${result.closedAfterSlot}`);

    check('üst yuva geçerli fırça karosunu gösteriyor', result.brushTile === true, '');
    check('üst yuva etkin araçta vurgulu', result.activeTop === true, '');

    check('kapsülde 5-6 son fırça var',
      result.capsuleCount >= 5 && result.capsuleCount <= 6,
      `adet=${result.capsuleCount} karo=${result.capsuleTiles}`);
    check('kapsül karoları mini vuruş önizlemeli', result.capsuleTiles === result.capsuleCount, '');
    check('kapsül kalemlerde fırça adları var', result.capsuleNamed === result.capsuleCount,
      `ad=${result.capsuleNamed}/${result.capsuleCount}`);
    check('kapsül seçimi fırçayı değiştirdi',
      result.targetBrush && result.brushAfterClick === result.targetBrush,
      `${result.targetBrush} → ${result.brushAfterClick}`);
    check('seçilen fırça son kullanılanların başına geçti',
      Array.isArray(result.recentAfterClick) && result.recentAfterClick[0] === result.targetBrush,
      (result.recentAfterClick || []).slice(0, 5).join(', '));

    check('merkez renk diski mevcut', result.colorEl === true, '');
    check('klasik çark canvas menzilde', result.wheelPresent === true, result.wheelCanvasPx || '');
    check('kapalıyken çark görünmez', result.collapsedWheelHidden === true, '');
    check('çekirdek disk geçerli rengi gösteriyor', /rgb/.test(String(result.discColor)), result.discColor);
    check('merkez hover çarkı açtı (is-color)',
      result.panelOpenForWheel === true && result.wheelConnected === true &&
      result.diskIsColor === true && result.expandedWheelVisible === true && result.wheelPointerOn === true,
      `açık=${result.panelOpenForWheel} bağlı=${result.wheelConnected} disk=${result.diskIsColor} görünür=${result.expandedWheelVisible} ${result.wheelPointerOn ? 'etkin' : 'etkinsiz'}`);
    check('halka seçimi rengi değiştirdi + çekirdek güncellendi',
      result.colorChangedByRing === true && result.discColorAfter !== result.discColor,
      `${result.inkColorBefore} → ${result.colorAfterRing} → ${result.colorAfterTri}`);
    check('üçgen seçimi rengi yeniden ayarladı', result.colorChangedByTri === true,
      `${result.colorAfterRing} → ${result.colorAfterTri}`);

    check('üç kaydırıcı var (Boyut/Size · Opaklık/Opacity · Yumuşatma/Smoothing)',
      (() => { const l = result.sliderLabels || [];
        return JSON.stringify(l) === JSON.stringify(['Boyut', 'Opaklık', 'Yumuşatma']) ||
               JSON.stringify(l) === JSON.stringify(['Size', 'Opacity', 'Smoothing']);
      })(),
      (result.sliderLabels || []).join(' · '));
    check('boyut kaydırıcısı motora yazdı', result.size === 64, `${result.size} px`);
    check('opaklık kaydırıcısı motora yazdı', result.opacity === 100, `${result.opacity}%`);
    check('yumuşatma kaydırıcısı motora yazdı', result.smoothing === 28, `${result.smoothing}%`);

    check('Esc yalnızca paneli kapattı', result.closedByEsc === true && result.editorStillOpen === true,
      `panel=${result.closedByEsc} editör=${result.editorStillOpen}`);
    check('yeniden açılış kapalı panoyu geri getirdi', result.reopenedForOutside === true, '');
    check('dışarı tıklama paneli kapattı', result.closedByOutside === true, '');

    check('WACOM: uç temasta sağ tık menüyü açmaz', result.blockedWhileContact === true, '');
    check('kalem bırakınca (300ms) menü yine açılır', result.reopenedAfterPenUp === true, '');
    check('sol basılıyken (buttons&1) sentetik sağ tık açmaz', result.blockedWhileButtons1 === true, '');
    check('orta tık menüyü açar', result.openedByMiddle === true, '');
    check('orta tuş pan sürüklemesi bırakışta menüyü AÇMAZ', result.notOpenedAfterPan === true, '');
    check('pan susturması bittikten sonra orta tık yine açar', result.openedAfterHush === true, '');
    check('mini referans panosunda sağ tık menü AÇMAZ', result.refBoardRight === true,
      (result.diag && result.diag.rect) ? 'ref-rect=' + result.diag.rect : '');
    check('mini referans panosunda orta tık menü AÇMAZ', result.refBoardMiddle === true, '');
    check('referans pano kapısı pencere dışındaki tıkları etkilemez',
      result.refBoardOutsideStillOpens === true, '');

    check('sayfada çalışma zamanı hatası yok',
      Array.isArray(result.errors) && result.errors.length === 0 && errors.length === 0,
      [...(result.errors || []), ...errors].join(' | ') || '');

    // Görsel kanıt: panel açık hâlde ekran görüntüsü.
    await evaluate(ws, `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 2, buttons: 2,
      }));
      await wait(400);
      return true;
    })()`);
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(OUT, 'radial-panel.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log('ekran görüntüsü:', shotPath);
  } catch (err) {
    console.error('TEST HATASI:', err.message);
    fail += 1;
  } finally {
    try { ws && ws.close(); } catch { /* sessiz */ }
    try { app.kill(); } catch { /* sessiz */ }
    await sleep(400);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* sessiz */ }
  }

  console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
