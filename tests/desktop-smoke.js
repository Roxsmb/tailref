'use strict';

/* Masaüstü (Electron) davranış testi — gerçek fare/klavye olaylarıyla.

   Kapsam:
   • Sahne (#stage) hiç kaymamalı. Kayarsa tüm ekran↔dünya hesapları şaşar:
     F görseli ortalayamaz, çift tıkla açılan metin yanlış yere düşer.
   • F: seçili görsel ekranın tam ortasına gelmeli.
   • Çift tık: metin tam tıklanan noktada açılmalı.

   Uygulamayı kendisi başlatır ve kapatır. Kullanım: node scripts/desktop-smoke.js */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const APP_PORT = 5196;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Testin kendi eklediği metin öğesinin kimliği: finally'de garanti silinir. */
let smokeTextId = '';

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
  /* awaitPromise: yüzen panel testleri async IIFE kullanıyor; bu bayrak
     olmadan CDP Promise nesnesini ({}) döndürüyor. */
  ws.send(JSON.stringify({
    id, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  setTimeout(() => reject(new Error('eval zaman aşımı')), 8000);
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

const mouse = (ws, type, x, y, clickCount) => send(ws, 'Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount,
});

/* Gerçek fare olaylarıyla sürükleme. Test çalışırken kullanıcı fareyi
   kullanırsa gelen gerçek pointerup sürüklemeyi yarıda kesebildiği için
   çağıran taraf sonucu doğrulayıp gerekirse yeniden dener. */
async function dragWithMouse(ws, x0, y0, x1, y1, steps = 6) {
  await mouse(ws, 'mouseMoved', x0, y0, 0);
  await mouse(ws, 'mousePressed', x0, y0, 1);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await mouse(ws, 'mouseMoved', Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1);
    await sleep(25);
  }
  await mouse(ws, 'mouseReleased', x1, y1, 1);
}

const pressKey = async (ws, key, code, vk) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: key.length === 1 ? key : undefined });
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

/* Öğenin ekran kutusunu, animasyon oturana kadar ölçer. */
async function stableRect(ws, id, timeout = 2500) {
  const expr = `(() => { const el = elMap.get(${JSON.stringify(id)}); if (!el) return 'null';
    const r = el.getBoundingClientRect();
    return JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]); })()`;
  let last = null;
  let stable = 0;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const raw = await evaluate(ws, expr);
    if (raw === 'null') return null;
    const r = JSON.parse(raw);
    if (last && Math.abs(r[0] - last[0]) <= 1 && Math.abs(r[1] - last[1]) <= 1) {
      if (++stable >= 2) return r;
    } else {
      stable = 0;
    }
    last = r;
    await sleep(120);
  }
  return last;
}

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

(async () => {
  // Gerçek tahtaya dokunmamak için izole profil + ayrı port.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-desktop-'));
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = spawn(electronPath(), ['.', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-sandbox'], {
    cwd: ROOT, env, stdio: 'ignore',
  });

  let ws = null;
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);

    // Renderer hazır olana kadar bekle (init IndexedDB'yi açar, görselleri yükler).
    const ready = Date.now() + 20000;
    let isReady = false;
    while (Date.now() < ready) {
      try {
        isReady = await evaluate(ws, "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth");
        if (isReady) break;
      } catch { /* henüz değil */ }
      await sleep(500);
    }
    if (!isReady) throw new Error('renderer hazır olmadı');
    await sleep(1200);

    /* Karşılama diyaloğu (#persistenceWelcome z 3400, tam ekran modal)
       boş profilde her koşuda doğar — init() tamamlanınca (gecikmeli).
       CDP mouse hit-test'lerini kaçırır (panel başlığına yükseltme/drag
       olayları iletilmez). Smoke panel-yönetim kapısıdır; diyalog akışını
       test etmez — güvenli varsayılan (auto) ile "seçildi" bayrağını
       yazıp kaldırır. */
    let welcomeSeen = false;
    const welcomeDeadline = Date.now() + 20000;
    while (Date.now() < welcomeDeadline) {
      welcomeSeen = JSON.parse(await evaluate(ws, `(function () {
        const el = document.getElementById('persistenceWelcome');
        return !!(el && !el.hidden);
      })()`));
      if (welcomeSeen) {
        await evaluate(ws, `(function () {
          if (typeof setPersistenceMode === 'function') setPersistenceMode('auto');
          else localStorage.setItem('tailref-persistence', 'auto');
          const el = document.getElementById('persistenceWelcome');
          if (el) el.hidden = true;
          return 'kapatıldı';
        })()`);
        break;
      }
      await sleep(400);
    }
    check('karşılama diyaloğu görülüp güvenli kapatıldı', welcomeSeen, '');
    await sleep(300);


    // İzole profil boş gelir: F testi için sentetik bir görsel ekle.
    const imageCount = await evaluate(ws, "state.items.filter(i => i.kind === 'image').length");
    if (!imageCount) {
      await evaluate(ws, `(async () => {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 180;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 240, 180);
        grad.addColorStop(0, '#4da3ff'); grad.addColorStop(1, '#7bd88f');
        g.fillStyle = grad; g.fillRect(0, 0, 240, 180);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await addFiles([new File([blob], 'smoke.png', { type: 'image/png' })], null);
        return state.items.length;
      })()`);
      await sleep(1200);
      check('test görseli eklendi', (await evaluate(ws, "state.items.filter(i => i.kind === 'image').length")) === 1, '');
    }

    // 1) Sahne kaydırma konteyneri olmamalı
    const stageInfo = JSON.parse(await evaluate(ws,
      "JSON.stringify({ overflow: getComputedStyle(stage).overflow, scroll: [stage.scrollLeft, stage.scrollTop] })"));
    check('sahne kaydırılamaz (overflow: clip)', stageInfo.overflow === 'clip', stageInfo.overflow);
    check('sahne kayması yok', stageInfo.scroll[0] === 0 && stageInfo.scroll[1] === 0, JSON.stringify(stageInfo.scroll));

    // 2) Görsele tıkla → F → tam ortalama
    // Önce tüm tahtayı sığdır, sonra üstünde başka öğe olmayan bir görsel seç.
    await evaluate(ws, 'fitAll(60)');
    await sleep(500);

    const target = JSON.parse(await evaluate(ws, [
      "(() => {",
      "  for (const it of state.items) {",
      "    if (it.kind !== 'image') continue;",
      "    const el = elMap.get(it.id); if (!el) continue;",
      "    const r = el.getBoundingClientRect();",
      "    if (r.width < 60 || r.height < 60) continue;",
      "    const cx = r.left + r.width/2, cy = r.top + r.height/2;",
      "    if (cx < 150 || cy < 150 || cx > innerWidth - 150 || cy > innerHeight - 150) continue;",
      // tıklanacak noktada gerçekten bu öğe en üstte mi?
      "    const hit = document.elementFromPoint(cx, cy);",
      "    const host = hit && hit.closest ? hit.closest('.item') : null;",
      "    if (!host || host.dataset.id !== it.id) continue;",
      "    return JSON.stringify({ id: it.id, cx: Math.round(cx), cy: Math.round(cy) });",
      "  }",
      "  return 'null';",
      "})()",
    ].join('\n')));

    if (!target) {
      console.log('UYARI  tahtada uygun görsel yok — F testi atlandı (önce bir görsel ekleyin)');
    } else {
      await mouse(ws, 'mouseMoved', target.cx, target.cy, 0);
      await mouse(ws, 'mousePressed', target.cx, target.cy, 1);
      await mouse(ws, 'mouseReleased', target.cx, target.cy, 1);
      await sleep(300);

      const selected = await evaluate(ws, `selection.has(${JSON.stringify(target.id)})`);
      check('görsele tıklayınca seçildi', selected === true, '');

      await pressKey(ws, 'f', 'KeyF', 70);
      await sleep(500);

      const box = await stableRect(ws, target.id);
      const vc = JSON.parse(await evaluate(ws, 'JSON.stringify([Math.round(stage.clientWidth/2), Math.round(stage.clientHeight/2)])'));
      const scroll = JSON.parse(await evaluate(ws, 'JSON.stringify([stage.scrollLeft, stage.scrollTop])'));
      const center = [box[0] + Math.round(box[2] / 2), box[1] + Math.round(box[3] / 2)];
      const dx = Math.abs(center[0] - vc[0]);
      const dy = Math.abs(center[1] - vc[1]);
      check('F görseli ekranın ortasına aldı', dx <= 2 && dy <= 2, `sapma ${dx},${dy} px`);
      check('F sonrası sahne kaymadı', scroll[0] === 0 && scroll[1] === 0, JSON.stringify(scroll));
    }

    // 3) Boş alana çift tık → metin tıklanan noktada
    // Önce görseli seçimden çıkarıp tahtayı genişçe sığdır: aksi halde
    // F sonrası görsel ekranın çoğunu kaplar ve boş alan kalmaz.
    await evaluate(ws, '(() => { selection.clear(); syncSelection(); fitAll(200); return true; })()');
    await sleep(400);

    const empty = JSON.parse(await evaluate(ws, [
      "(() => {",
      "  const w = stage.clientWidth, h = stage.clientHeight;",
      "  for (let gy = 0.2; gy < 0.85; gy += 0.03) {",
      "    for (let gx = 0.2; gx < 0.85; gx += 0.03) {",
      "      const x = Math.round(w * gx), y = Math.round(h * gy);",
      "      const el = document.elementFromPoint(x, y);",
      "      if (el && (el.id === 'stage' || el.id === 'world' || el.id === 'gridOverlay')) return JSON.stringify({ x, y });",
      "    }",
      "  }",
      "  return 'null';",
      "})()",
    ].join('\n')));

    if (!empty) {
      console.log('UYARI  boş alan bulunamadı — çift tık testi atlandı');
    } else {
      const before = await evaluate(ws, 'state.items.length');
      await mouse(ws, 'mouseMoved', empty.x, empty.y, 0);
      await mouse(ws, 'mousePressed', empty.x, empty.y, 1);
      await mouse(ws, 'mouseReleased', empty.x, empty.y, 1);
      await mouse(ws, 'mousePressed', empty.x, empty.y, 2);
      await mouse(ws, 'mouseReleased', empty.x, empty.y, 2);
      await sleep(400);

      const newId = await evaluate(ws, [
        '(() => { const it = state.items[state.items.length - 1];',
        '  return it && it.kind === "text" ? it.id : ""; })()',
      ].join('\n'));
      const count = await evaluate(ws, 'state.items.length');
      const editing = await evaluate(ws, `editingId === ${JSON.stringify(newId || '')}`);
      const box = newId ? await stableRect(ws, newId) : null;
      const scroll = JSON.parse(await evaluate(ws, 'JSON.stringify([stage.scrollLeft, stage.scrollTop])'));

      check('çift tık metin oluşturdu', count === before + 1 && !!newId, `${before} → ${count}`);
      check('metin düzenleme modunda', editing === true, '');
      if (box) {
        const ox = Math.abs(box[0] - empty.x), oy = Math.abs(box[1] - empty.y);
        check('metin tıklanan noktada açıldı', ox <= 25 && oy <= 25,
          `sapma ${ox},${oy} px (kutu ${box[0]},${box[1]} / tıklanan ${empty.x},${empty.y})`);
      }
      check('çift tık sonrası sahne kaymadı', scroll[0] === 0 && scroll[1] === 0, JSON.stringify(scroll));

      // temizlik
      await evaluate(ws, "(() => { const it = state.items[state.items.length-1]; if (it && it.kind === 'text') { commitEdit(); removeItems([it.id], false, { toTrash: false }); } return 'ok'; })()");
    }

    // 4) Çöp: geri getirilen öğe eski yerinde kalmalı.
    // Öğe konumu transform ile taşınıyor; geri getirme animasyonu bu
    // transform'u silerse tüm öğeler (0,0)'da üst üste yığılıyordu.
    const trash = JSON.parse(await evaluate(ws, [
      "(() => {",
      "  const id = 'it_' + newId();",
      "  const it = { id, kind: 'text', text: 'trash test', x: 320, y: 240, w: 180, h: 44, rot: 0,",
      "    z: nextZ(), fontSize: FONT_SIZE, color: '#fff', bold: false, bg: 'rgba(0,0,0,.35)' };",
      "  state.items.push(it); syncAll();",
      "  removeItems([id], false);",
      "  const entry = state.trash.find(e => e.item.id === id);",
      "  return JSON.stringify({ id, entry: entry ? entry.id : '' });",
      "})()",
    ].join('\n')));

    await evaluate(ws, `restoreTrashEntries([${JSON.stringify(trash.entry)}])`);
    await sleep(1300);

    const restored = JSON.parse(await evaluate(ws, [
      "(() => {",
      `  const id = ${JSON.stringify(trash.id)};`,
      "  const it = getItem(id);",
      "  const el = elMap.get(id);",
      "  return JSON.stringify({ exists: !!it, x: it ? it.x : null, y: it ? it.y : null,",
      "    transform: el ? el.style.transform : '' });",
      "})()",
    ].join('\n')));
    check('çöpten geri gelen öğe yerinde kalıyor',
      restored.exists && restored.transform.includes(`translate3d(${restored.x}px, ${restored.y}px`),
      restored.transform || 'öğe yok');

    await evaluate(ws, `(() => {
      const id = ${JSON.stringify(trash.id)};
      if (getItem(id)) removeItems([id], false, { toTrash: false });
      state.trash = state.trash.filter(entry => entry.item.id !== id);
      return 'ok';
    })()`);

    /* 5) Yüzen paneller birbirinin altında kalmamalı: hangi panelin görünür
       bir yerine basılırsa öne gelmeli ve sürüklenebilmeli. Ayrıca üst kenara
       (pencere sürükleme şeridinin altına) taşınan panel de tutulabilmeli. */
    const floating = JSON.parse(await evaluate(ws, `(async () => {
      const openPanel = el => {
        /* Panel kapanış animasyonundaysa hidden henüz false olur; yalnızca
           hidden'a bakmak testi panel gizli kalırken çalıştırıyordu. */
        el.hidden = false;
        el.classList.remove('panel-leaving', 'panel-enter', 'panel-preenter');
        if (window.tailrefPreparePanel) window.tailrefPreparePanel(el, false);
      };
      const ins = document.querySelector('#inspector');
      const set = document.querySelector('#settings');
      /* Seçim paneli (#inspector) yalnızca metin seçiliyken görünür.
         Testin önceki adımları metni sildiği için geçici bir metin ekle. */
      let textId = '';
      const textItem = state.items.find(item => item.kind === 'text');
      if (textItem) {
        textId = textItem.id;
      } else {
        textId = 'it_' + newId();
        state.items.push({
          id: textId, kind: 'text', text: 'smoke text', x: 320, y: 240, w: 180, h: 44, rot: 0,
          z: nextZ(), fontSize: FONT_SIZE, color: '#fff', bold: false, bg: 'rgba(0,0,0,.35)',
        });
        smokeTextId = textId;
        syncAll();
      }
      selection.clear();
      selection.add(textId);
      syncSelection();
      for (const el of [ins, set]) el.removeAttribute('style');
      openPanel(ins);
      openPanel(set);
      await new Promise(r => setTimeout(r, 250));
      /* Alttaki panelin yalnızca başlığı görünür kalsın; settings onun
         başlık şeridinin altından başlasın. */
      ins.style.cssText = 'position:fixed;left:200px;top:220px;width:320px;height:300px;right:auto;bottom:auto;z-index:2200';
      set.style.cssText = 'position:fixed;left:200px;top:280px;width:320px;height:300px;right:auto;bottom:auto;z-index:2300';
      await new Promise(r => setTimeout(r, 250));
      const title = ins.querySelector('.ibTitle') || ins.firstElementChild;
      const tr = title.getBoundingClientRect();
      return JSON.stringify({
        x: Math.round(tr.left + 24), y: Math.round(tr.top + 12), textId,
        insZ: Number(getComputedStyle(ins).zIndex), setZ: Number(getComputedStyle(set).zIndex),
      });
    })()`));

    await mouse(ws, 'mouseMoved', floating.x, floating.y, 0);
    await mouse(ws, 'mousePressed', floating.x, floating.y, 1);
    await sleep(80);
    await mouse(ws, 'mouseReleased', floating.x, floating.y, 1);
    await sleep(350);
    const raised = JSON.parse(await evaluate(ws, `(() => {
      const ins = document.querySelector('#inspector');
      const set = document.querySelector('#settings');
      return JSON.stringify({
        insZ: Number(getComputedStyle(ins).zIndex),
        setZ: Number(getComputedStyle(set).zIndex),
      });
    })()`));
    check('üst üste binen panel öne alındı',
      raised.insZ > raised.setZ,
      `inspector ${floating.insZ}→${raised.insZ} · settings ${raised.setZ}`);

    let dragMoved = false;
    let dragBefore = JSON.parse(await evaluate(ws,
      "JSON.stringify(document.querySelector('#inspector').getBoundingClientRect().toJSON())"));
    let dragAfter = dragBefore;
    for (let attempt = 0; attempt < 3 && !dragMoved; attempt += 1) {
      dragBefore = JSON.parse(await evaluate(ws,
        "JSON.stringify(document.querySelector('#inspector').getBoundingClientRect().toJSON())"));
      await dragWithMouse(ws, floating.x, floating.y, floating.x + 120, floating.y + 60);
      await sleep(250);
      dragAfter = JSON.parse(await evaluate(ws,
        "JSON.stringify(document.querySelector('#inspector').getBoundingClientRect().toJSON())"));
      dragMoved = Math.abs(dragAfter.left - dragBefore.left) > 40
        || Math.abs(dragAfter.top - dragBefore.top) > 40;
    }
    check('öne alınan panel başlıktan sürüklenebiliyor',
      dragMoved,
      `sol ${Math.round(dragBefore.left)}→${Math.round(dragAfter.left)} · üst ${Math.round(dragBefore.top)}→${Math.round(dragAfter.top)}`);

    /* Pencere sürükleme şeridi (#windowDragStrip, z 999) üstteki paneli
       örtmemeli: üst kenara yaslanan panel hâlâ tutulabilmeli. */
    let edgeOwned = false;
    let edgeTopEl = null;
    let edgeRectTop = 0;
    let edgeAfterTop = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const edge = JSON.parse(await evaluate(ws, `(() => {
        const set = document.querySelector('#settings');
        set.style.cssText = 'position:fixed;left:520px;top:2px;width:300px;height:220px;right:auto;bottom:auto;z-index:2310';
        const r = set.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + 14);
        const hit = document.elementFromPoint(x, y);
        return JSON.stringify({
          x, y,
          topEl: hit ? (hit.id || hit.className || hit.tagName) : null,
          rect: r.toJSON(),
        });
      })()`));
      edgeTopEl = edge.topEl;
      edgeRectTop = edge.rect.top;
      edgeOwned = edge.topEl === 'settings'
        || (typeof edge.topEl === 'string' && edge.topEl.includes('floatingPanel'));
      await dragWithMouse(ws, edge.x, edge.y, edge.x + 60, edge.y + 144);
      await sleep(250);
      const edgeAfter = JSON.parse(await evaluate(ws,
        "JSON.stringify(document.querySelector('#settings').getBoundingClientRect().toJSON())"));
      edgeAfterTop = edgeAfter.top;
      if (edgeOwned && Math.abs(edgeAfterTop - edgeRectTop) > 60) break;
    }
    check('üst kenardaki panel pencere şeridinin altında kalmıyor',
      edgeOwned && Math.abs(edgeAfterTop - edgeRectTop) > 60,
      `üstteki öğe=${edgeTopEl} · üst ${Math.round(edgeRectTop)}→${Math.round(edgeAfterTop)}`);

    /* Panel yukarı sürüklenirken üst dock'un (#bar) altında durmalı: aksi
       halde pencere sürükleme bölgesi paneli yutuyor ve panel kayboluyordu. */
    const dockInfo = JSON.parse(await evaluate(ws,
      "(() => { const r = document.querySelector('#bar').getBoundingClientRect(); return JSON.stringify({ top: r.top, bottom: r.bottom }); })()"));
    let upStart = 0;
    let upAfterTop = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const upPoint = JSON.parse(await evaluate(ws, `(async () => {
        const set = document.querySelector('#settings');
        set.style.cssText = 'position:fixed;left:520px;top:500px;width:300px;height:220px;right:auto;bottom:auto;z-index:2310';
        await new Promise(r => setTimeout(r, 60));
        const r = set.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + 40), y: Math.round(r.top + 14), top: r.top });
      })()`));
      upStart = upPoint.top;
      await dragWithMouse(ws, upPoint.x, upPoint.y, upPoint.x, upPoint.y - 360);
      await sleep(250);
      upAfterTop = Number(await evaluate(ws,
        "JSON.stringify(document.querySelector('#settings').getBoundingClientRect().top)"));
      if (upAfterTop >= dockInfo.bottom - 1 && upAfterTop < upPoint.top) break;
    }
    check('yukarı sürüklenen panel üst dock altında duruyor',
      upAfterTop >= dockInfo.bottom - 1 && upAfterTop < upStart,
      `üst ${Math.round(upStart)}→${Math.round(upAfterTop)} · dock alt ${Math.round(dockInfo.bottom)}`);

    /* Çöp kutusu paneli ayrı bir sürükleme mantığı kullanıyor; diğer yüzen
       paneller gibi üst dock'un altında kalmalı. Aksi halde pencere sürükleme
       şeridine giriyor ve başlığından tutulamıyordu. */
    const trashClamp = JSON.parse(await evaluate(ws, `(async () => {
      const panel = document.querySelector('#trashPanel');
      openTrashPanel();
      await new Promise(r => setTimeout(r, 720));
      panel.classList.remove('panel-enter', 'panel-preenter', 'panel-leaving');
      /* Eski sürümden kalan (üst şeride taşmış) konumu taklit et. */
      trashPanelPos = { left: Math.max(420, innerWidth - 460), top: 8 };
      positionTrashPanel();
      await new Promise(r => setTimeout(r, 120));
      const r = panel.getBoundingClientRect();
      const head = panel.querySelector('.trashHead').getBoundingClientRect();
      const x = Math.round(head.left + 24), y = Math.round(head.top + 12);
      const hit = document.elementFromPoint(x, y);
      return JSON.stringify({
        x, y, top: r.top, left: r.left,
        topLimit: floatingTopLimit(),
        dockBottom: document.querySelector('#barDock').getBoundingClientRect().bottom,
        z: Number(getComputedStyle(panel).zIndex),
        hit: hit ? (hit.id || hit.className || hit.tagName) : null,
        inPanel: !!(hit && panel.contains(hit)),
      });
    })()`));
    check('çöp paneli üst dock altında ve tutulabilir',
      trashClamp.top >= trashClamp.topLimit - 1 && trashClamp.top >= trashClamp.dockBottom - 1
        && trashClamp.inPanel && trashClamp.z >= 2300,
      `üst=${Math.round(trashClamp.top)} · limit=${Math.round(trashClamp.topLimit)} · dock alt=${Math.round(trashClamp.dockBottom)} · z=${trashClamp.z} · öğe=${trashClamp.hit}`);

    /* Paneli önce aşağıya bırak, sonra yukarı sürükle: üst limitte durmalı. */
    const trashStart = JSON.parse(await evaluate(ws, `(async () => {
      const panel = document.querySelector('#trashPanel');
      trashPanelPos = { left: Math.max(420, innerWidth - 460), top: 320 };
      positionTrashPanel();
      await new Promise(r => setTimeout(r, 120));
      const head = panel.querySelector('.trashHead').getBoundingClientRect();
      return JSON.stringify({
        x: Math.round(head.left + 24), y: Math.round(head.top + 12),
        top: panel.getBoundingClientRect().top,
      });
    })()`));
    check('çöp paneli aşağıya taşınabiliyor',
      trashStart.top > 200, `üst=${Math.round(trashStart.top)}`);

    /* Başlık gerçek fareyle tutulabiliyor mu? (Sürüklemeyi başlatmalı.) */
    await mouse(ws, 'mouseMoved', trashStart.x, trashStart.y, 0);
    await mouse(ws, 'mousePressed', trashStart.x, trashStart.y, 1);
    await sleep(80);
    const trashGrabbed = await evaluate(ws, `(() => {
      const panel = document.querySelector('#trashPanel');
      const grabbed = !!(typeof trashPanelDrag !== 'undefined' && trashPanelDrag);
      return grabbed ? 'drag' : 'none';
    })()`);
    await mouse(ws, 'mouseReleased', trashStart.x, trashStart.y, 1);
    await sleep(200);
    check('çöp paneli başlığından tutulabiliyor', trashGrabbed === 'drag', `durum=${trashGrabbed}`);

    /* Üst sınırı asıl ölçen adım: sentetik pointer olaylarıyla sürükle.
       Test çalışırken kullanıcının gerçek faresi de window üzerinde
       pointermove üretiyor ve CDP sürüklemesine karışıp ölçümü oynatıyordu.
       Burada aynı panel işleyicileri çalışır, yalnızca olay kaynağı sabittir. */
    const trashUp = JSON.parse(await evaluate(ws, `(async () => {
      const panel = document.querySelector('#trashPanel');
      const head = panel.querySelector('.trashHead');
      const h = head.getBoundingClientRect();
      const startX = Math.round(h.left + 24);
      const startY = Math.round(h.top + 12);
      const opts = (x, y, buttons) => ({
        pointerId: 42, pointerType: 'mouse', isPrimary: true,
        bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y,
      });
      head.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY, 1)));
      for (let i = 1; i <= 6; i += 1) {
        window.dispatchEvent(new PointerEvent('pointermove', opts(startX, startY - i * 60, 1)));
        await new Promise(r => setTimeout(r, 16));
      }
      window.dispatchEvent(new PointerEvent('pointerup', opts(startX, Math.max(4, startY - 360), 0)));
      await new Promise(r => setTimeout(r, 250));
      const r = panel.getBoundingClientRect();
      const headAfter = head.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(headAfter.left + 24), Math.round(headAfter.top + 12));
      return JSON.stringify({
        top: r.top, visible: !panel.hidden,
        topLimit: floatingTopLimit(),
        inPanel: !!(hit && panel.contains(hit)),
      });
    })()`));
    check('yukarı sürüklenen çöp paneli üst dock altında duruyor',
      trashUp.visible && Math.abs(trashUp.top - trashUp.topLimit) <= 1
        && trashUp.top < trashStart.top && trashUp.inPanel,
      `üst ${Math.round(trashStart.top)}→${Math.round(trashUp.top)} · limit=${Math.round(trashUp.topLimit)}`);

    /* Temizlik: geçici metni sil, panelleri kapat, satır içi konumları sil. */
    await evaluate(ws, `(() => {
      const id = ${JSON.stringify(floating.textId || '')};
      if (id && getItem(id)) removeItems([id], false, { toTrash: false });
      for (const el of [document.querySelector('#inspector'), document.querySelector('#settings')]) {
        el.removeAttribute('style');
        if (window.tailrefClosePanel) window.tailrefClosePanel(el);
        else el.hidden = true;
      }
      const trashPanel = document.querySelector('#trashPanel');
      trashPanel.removeAttribute('style');
      closeTrashPanel();
      trashPanelPos = null;
      persistTrashPanelPosition();
      return 'ok';
    })()`);
  } finally {
    if (ws) {
      /* Garanti temizlik: test öğesi tahtada kalmasın (bu oturumda
         oluşturulan 'smoke text' + eski sızma olasılığına karşı
         'panel testi' de aranır). */
      try {
        await evaluate(ws, `(() => {
          const hedef = new Set(['smoke text', 'panel testi']);
          if (${JSON.stringify(smokeTextId)}) hedef.add(${JSON.stringify(smokeTextId)});
          const kalan = state.items.filter(it => it.kind === 'text' && hedef.has(it.text));
          for (const it of kalan) removeItems([it.id], false, { toTrash: false });
          return kalan.length;
        })()`);
      } catch { /* pencere kapalı olabilir */ }
    }
    if (ws) ws.close();
    app.kill();
    await sleep(400);
    try { process.kill(app.pid); } catch { /* zaten kapandı */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
