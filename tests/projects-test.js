'use strict';

/* Pano/sekme mimarisi testi — gerçek Electron penceresinde.

   Kapsam:
   • İlk açılışta tek pano ve sekme şeridi.
   • + ile yeni pano; tahtaların izole olması.
   • Sekmeler arası geçişte öğe/seçim/kamera bağlamının korunması.
   • Çift tıkla yeniden adlandırma.
   • Yeniden yükleme sonrası panoların kalıcılığı.
   • Kapatma (closeProjectTab), komşu sekmeye geçiş ve görsel GC.
   • Eski `meta/state` kaydından ilk panoya göç.
   • Yeni panonun %100 arka plan opaklığıyla açılması.
   • Pano sınırı (10): + düğmesi, uyarı ve kapatınca yeniden etkinleşme.
   • Aşırı yük kurtarma: yedek + işaret dosyasıyla açılışta geri yükleme.

   Kullanım: node scripts/projects-test.js */

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

const evaluate = (ws, expression, timeout = 12000) => new Promise((resolve, reject) => {
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

async function addImage(ws, name) {
  return evaluate(ws, `(async () => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 160, 120);
    grad.addColorStop(0, '#4da3ff');
    grad.addColorStop(1, '#7bd88f');
    g.fillStyle = grad; g.fillRect(0, 0, 160, 120);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await addFiles([new File([blob], ${JSON.stringify(name)}, { type: 'image/png' })], null);
    await new Promise(r => setTimeout(r, ${700}));
    const item = state.items[state.items.length - 1];
    return JSON.stringify({ count: state.items.length, id: item && item.id, imageId: item && item.imageId });
  })()`).then(JSON.parse);
}

async function readWorkspace(ws) {
  return evaluate(ws, `(() => {
    const w = window.__tailrefWorkspace;
    return JSON.stringify({
      ready: !!(w && w.ready),
      order: w ? w.order.slice() : [],
      activeId: w ? w.activeId : null,
      projects: w ? [...w.projects.values()].map(p => ({
        id: p.id, name: p.name, items: p.itemCount,
        hasCamera: !!p.cameraTransform, hasPose: !!p.pose3d
      })) : [],
      items: state.items.map(i => i.id),
      tabCount: document.querySelectorAll('#projectTabs .projTab').length,
      activeTabs: document.querySelectorAll('#projectTabs .projTab.is-active').length,
      labels: [...document.querySelectorAll('#projectTabs .projTabLabel')].map(el => el.textContent),
      hasAdd: !!document.querySelector('#btnNewProject'),
    });
  })()`).then(JSON.parse);
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-projects-'));
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
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  try {
    const page = await waitForTarget();
    ws = await connect(page.webSocketDebuggerUrl);
    if (!await waitReady(ws)) throw new Error('pano yöneticisi hazır olmadı');
    await sleep(600);

    /* Karşılama diyaloğunu (kalıcılık modu) kapat: tüm ekranı kaplayan bir
       modal olduğundan sonraki tıklama/elementFromPoint tabanlı kontrolleri
       bloke ediyor. Uygulama ilk açılışta mod seçtirir; test de aynı akışı
       izler (Otomatik seç → Devam). */
    await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (w && !w.hidden) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
        document.getElementById('pwContinue')?.click();
      }
      return !document.getElementById('persistenceWelcome') ||
        document.getElementById('persistenceWelcome').hidden;
    })()`).catch(() => null);
    await sleep(300);

    /* 1 · İlk açılış */
    let info = await readWorkspace(ws);
    check('ilk açılışta tek pano var', info.projects.length === 1 && info.tabCount === 1,
      `${info.projects.length} pano · ${info.tabCount} sekme`);
    check('sekme şeridi ve + düğmesi hazır', info.hasAdd && info.activeTabs === 1,
      `etkin sekme ${info.activeTabs}`);
    const firstId = info.activeId;

    /* 1b · 3D kamera ve rig pozunun pano başına izolasyonu.
       9 Kasım: 3D lazy boot'a geçti — açılışta kurulmuyor, panel ilk
       açıldığında kuruluyor. Test de aynı kalıbı izler: 3D paneli aç,
       köprüyü (default3d + cameraManager + rig kemikleri) bekle. */
    await evaluate(ws, `(() => {
      const panel = document.querySelector('#pose3dPanel');
      if (!panel) return false;
      if (window.tailrefOpenPanel) window.tailrefOpenPanel(panel); else panel.hidden = false;
      return !panel.hidden;
    })()`).catch(() => null);
    const d3 = Date.now() + 40000;
    let d3ready = false;
    while (Date.now() < d3) {
      try {
        d3ready = await evaluate(ws, `(() => {
          const d = window.__pose3dDebug;
          const w = window.__tailrefWorkspace;
          return !!(w && w.default3d && d && d.cameraManager && d.rig &&
            Array.isArray(d.rig.bones) && d.rig.bones.length > 0);
        })()`, 3000);
        if (d3ready) break;
      } catch { /* 3D henüz yükleniyor */ }
      await sleep(500);
    }
    check('3D köprüsü ve varsayılan poz hazır', d3ready);

    if (d3ready) {
      const camCaptured = await evaluate(ws, `(async () => {
        const dbg = window.__pose3dDebug;
        const cm = dbg.cameraManager;
        cm.persp.position.set(1.25, 2.5, 3.75);
        cm.controls.target.set(0, 1.1, 0);
        cm.persp.updateProjectionMatrix();
        cm.controls.update();
        cm.viewport.invalidate();
        const bone = dbg.rig.bones[0];
        const boneId = bone.uuid;
        const boneName = bone.name;
        bone.quaternion.set(0.12, 0.24, 0.36, 0.89).normalize();
        dbg.rig.root?.updateMatrixWorld(true);
        await saveNow();
        const project = window.__tailrefWorkspace.projects.get(window.__tailrefWorkspace.activeId);
        return JSON.stringify({
          boneId, boneName,
          hasCamera: !!project.cameraTransform,
          hasPose: !!(project.pose3d && project.pose3d.bones),
          position: project.cameraTransform && project.cameraTransform.persp.position,
        });
      })()`).then(JSON.parse);
      check('kamera transformu ve rig pozu panoya kaydedildi',
        camCaptured.hasCamera && camCaptured.hasPose &&
        Math.abs(camCaptured.position[0] - 1.25) < 0.001,
        `kam=${camCaptured.hasCamera} · poz=${camCaptured.hasPose}`);

      const p2 = await evaluate(ws, `(async () => {
        const p = await window.__tailrefWorkspace.createProject();
        await new Promise(r => setTimeout(r, 350));
        return p.id;
      })()`);
      const camB = await evaluate(ws, `(() => {
        const cm = window.__pose3dDebug.cameraManager;
        const bone = window.__pose3dDebug.rig.bones[0];
        return JSON.stringify({ pos: cm.persp.position.toArray(), q: bone.quaternion.toArray() });
      })()`).then(JSON.parse);
      check('yeni panoya geçerken varsayılan kamera/poz uygulandı',
        Math.abs(camB.pos[0] - 1.25) > 0.05,
        `x=${camB.pos[0].toFixed(2)}`);

      const back = await evaluate(ws, `(async () => {
        await window.__tailrefWorkspace.switchTo(${JSON.stringify(firstId)});
        await new Promise(r => setTimeout(r, 350));
        const cm = window.__pose3dDebug.cameraManager;
        const bone = window.__pose3dDebug.rig.bones.find(b => b.uuid === ${JSON.stringify(camCaptured.boneId)})
          || window.__pose3dDebug.rig.bones[0];
        return JSON.stringify({ pos: cm.persp.position.toArray(), q: bone.quaternion.toArray() });
      })()`).then(JSON.parse);
      check('eski panoya dönünce kamera transformu geri geldi',
        Math.abs(back.pos[0] - 1.25) < 0.01 &&
        Math.abs(back.pos[1] - 2.5) < 0.01 &&
        Math.abs(back.pos[2] - 3.75) < 0.01,
        back.pos.map(v => v.toFixed(2)).join(', '));
      check('eski panoya dönünce rig pozu geri geldi',
        Math.abs(back.q[0] - 0.12) < 0.01 && Math.abs(back.q[1] - 0.24) < 0.01,
        back.q.map(v => v.toFixed(2)).join(', '));

      // 3D verisini temizle ki sonraki tahta testleri yalın kalsın.
      await evaluate(ws, `(async () => {
        await window.__tailrefWorkspace.closeProjectTab(${JSON.stringify(p2)});
        await new Promise(r => setTimeout(r, 250));
        /* 3D paneli düzgün kapat (panel kaydı da güncellenir): sonraki
           bölümler DOM tabanlı tıklama ve elementFromPoint kullanıyor;
           açık panel üstte kalarak engeller. */
        const panel = document.querySelector('#pose3dPanel');
        if (panel && window.tailrefClosePanel) window.tailrefClosePanel(panel);
        else if (panel) panel.hidden = true;
        return true;
      })()`);
    }

    /* 2 · Pano 1'e görsel ekle */
    const imgA = await addImage(ws, 'pano-a.png');
    check('Pano 1 görseli eklendi', imgA.count === 1, `öğe=${imgA.count}`);

    /* 3 · Yeni pano (+ davranışı) */
    const created = await evaluate(ws, `(async () => {
      const p = await window.__tailrefWorkspace.createProject();
      await new Promise(r => setTimeout(r, 250));
      return JSON.stringify({ id: p && p.id, name: p && p.name, items: state.items.length });
    })()`).then(JSON.parse);
    check('yeni pano boş açıldı', !!created.id && created.id !== firstId && created.items === 0,
      `${created.name} · öğe=${created.items}`);
    info = await readWorkspace(ws);
    check('iki sekme görünüyor', info.projects.length === 2 && info.tabCount === 2,
      `${info.tabCount} sekme`);
    const secondId = created.id;

    /* 4 · Pano 2'ye görsel ekle */
    const imgB = await addImage(ws, 'pano-b.png');
    check('Pano 2 görseli eklendi', imgB.count === 1 && imgB.imageId !== imgA.imageId,
      `öğe=${imgB.count}`);

    /* 5 · Sekme geçişleri izolasyonu */
    const aState = await evaluate(ws, `(async () => {
      await window.__tailrefWorkspace.switchTo(${JSON.stringify(firstId)});
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({
        items: state.items.map(i => i.id),
        imageIds: state.items.filter(i => i.kind === 'image').map(i => i.imageId),
        activeId: window.__tailrefWorkspace.activeId,
      });
    })()`).then(JSON.parse);
    check('Pano 1\'e dönünce kendi öğesi geldi',
      aState.activeId === firstId && aState.items.length === 1 && aState.items[0] === imgA.id,
      `öğe=${aState.items.length}`);

    const bState = await evaluate(ws, `(async () => {
      await window.__tailrefWorkspace.switchTo(${JSON.stringify(secondId)});
      await new Promise(r => setTimeout(r, 300));
      return JSON.stringify({
        items: state.items.map(i => i.id),
        imageIds: state.items.filter(i => i.kind === 'image').map(i => i.imageId),
        activeId: window.__tailrefWorkspace.activeId,
      });
    })()`).then(JSON.parse);
    check('Pano 2\'ye dönünce kendi öğesi geldi',
      bState.activeId === secondId && bState.items.length === 1 && bState.items[0] === imgB.id,
      `öğe=${bState.items.length}`);
    check('görsel kimlikleri panolar arasında karışmıyor',
      aState.imageIds[0] === imgA.imageId && bState.imageIds[0] === imgB.imageId);

    /* 6 · Çift tıkla yeniden adlandırma (gerçek DOM olayı) */
    const renamed = await evaluate(ws, `(async () => {
      const label = document.querySelector('#projectTabs .projTab.is-active .projTabLabel');
      label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 60));
      const input = document.querySelector('#projectTabs .projTabRename');
      if (!input) return JSON.stringify({ ok: false, reason: 'input yok' });
      input.value = 'Pano B';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 450));
      const project = window.__tailrefWorkspace.projects.get(window.__tailrefWorkspace.activeId);
      const index = await idbGet('meta', 'workspace');
      return JSON.stringify({
        ok: true,
        name: project && project.name,
        indexName: index && index.projects.find(p => p.id === window.__tailrefWorkspace.activeId)?.name,
        label: document.querySelector('#projectTabs .projTab.is-active .projTabLabel')?.textContent,
      });
    })()`).then(JSON.parse);
    check('çift tıkla yeniden adlandırma kaydedildi',
      renamed.ok && renamed.name === 'Pano B' && renamed.indexName === 'Pano B' && renamed.label === 'Pano B',
      JSON.stringify(renamed));

    /* 7 · Yeniden yükleme sonrası kalıcılık */
    await evaluate(ws, 'setTimeout(() => location.reload(), 30); true').catch(() => null);
    await sleep(1200);
    if (!await waitReady(ws)) throw new Error('yeniden yükleme sonrası hazır olmadı');
    await sleep(700);
    info = await readWorkspace(ws);
    const activeAfterReload = info.projects.find(p => p.id === info.activeId);
    check('yeniden yüklemede iki pano korundu',
      info.projects.length === 2 && info.tabCount === 2 &&
      info.projects.some(p => p.id === firstId && p.items === 1) &&
      info.projects.some(p => p.id === secondId && p.items === 1 && p.name === 'Pano B'),
      info.projects.map(p => `${p.name}:${p.items}`).join(', '));
    check('etkin pano yeniden yüklemede hatırlandı',
      info.activeId === secondId && info.items.length === 1 && info.items[0] === imgB.id,
      `etkin=${activeAfterReload && activeAfterReload.name}`);

    /* 8 · Kapatma + GC */
    const closed = await evaluate(ws, `(async () => {
      window.confirm = () => true;
      window.__tailrefConfirmBypass = true; /* appConfirm stub yoluna düşsün */
      await window.__tailrefWorkspace.closeProjectTab(${JSON.stringify(secondId)});
      await new Promise(r => setTimeout(r, 300));
      const w = window.__tailrefWorkspace;
      return JSON.stringify({
        order: w.order.slice(),
        activeId: w.activeId,
        items: state.items.map(i => i.id),
        record: !!(await idbGet('meta', 'project:' + ${JSON.stringify(secondId)})),
        blob: !!(await idbGet('images', ${JSON.stringify(imgB.imageId)})),
        tabCount: document.querySelectorAll('#projectTabs .projTab').length,
      });
    })()`).then(JSON.parse);
    check('kapatılan pano bellekten ve diskten silindi',
      closed.order.length === 1 && !closed.record && closed.tabCount === 1,
      `kalan=${closed.order.length}`);
    check('kapatılan panonun görseli GC ile temizlendi', !closed.blob);
    check('komşu pano etkinleşti ve içeriği korundu',
      closed.activeId === firstId && closed.items.length === 1 && closed.items[0] === imgA.id,
      `öğe=${closed.items.length}`);

    /* 9 · Son sekme kapanınca boş pano */
    const lastClosed = await evaluate(ws, `(async () => {
      await window.__tailrefWorkspace.closeProjectTab(${JSON.stringify(firstId)});
      await new Promise(r => setTimeout(r, 350));
      const w = window.__tailrefWorkspace;
      const active = w.projects.get(w.activeId);
      return JSON.stringify({
        order: w.order.length,
        activeId: w.activeId,
        items: state.items.length,
        name: active && active.name,
        oldRecord: !!(await idbGet('meta', 'project:' + ${JSON.stringify(firstId)})),
        tabCount: document.querySelectorAll('#projectTabs .projTab').length,
      });
    })()`).then(JSON.parse);
    check('son sekme kapanınca boş pano açıldı',
      lastClosed.order === 1 && lastClosed.items === 0 &&
      lastClosed.tabCount === 1 && /^(Pano|Board) 1$/.test(lastClosed.name) && !lastClosed.oldRecord,
      JSON.stringify(lastClosed));

    /* 10 · Eski tek tahta kaydından göç */
    await evaluate(ws, `(async () => {
      const legacy = {
        items: [{
          id: 'legacy-text-1', kind: 'text', x: 10, y: 10, w: 220, h: 60, z: 1,
          text: 'Eski tahta', color: '#fff', fs: 24
        }],
        view: { x: 0, y: 0, scale: 1 }, bg: 1,
        groupTitles: {}, groupImportant: {}, groupParents: {},
        links: [], trash: []
      };
      await idbPut('meta', 'state', JSON.stringify(legacy));
      await idbDel('meta', 'workspace');
      for (const [key] of await idbEntries('meta')) {
        if (String(key).startsWith('project:')) await idbDel('meta', key);
      }
      setTimeout(() => location.reload(), 30);
      return true;
    })()`).catch(() => null);
    await sleep(1200);
    if (!await waitReady(ws)) throw new Error('göç sonrası hazır olmadı');
    await sleep(700);
    const migrated = await evaluate(ws, `(() => {
      const w = window.__tailrefWorkspace;
      return JSON.stringify({
        count: w.projects.size,
        name: [...w.projects.values()][0]?.name,
        items: state.items.map(i => i.id),
        labels: [...document.querySelectorAll('#projectTabs .projTabLabel')].map(el => el.textContent),
      });
    })()`).then(JSON.parse);
    check('eski tahta ilk panoya taşındı',
      migrated.count === 1 && /^(Pano|Board) 1$/.test(migrated.name) &&
      migrated.items.length === 1 && migrated.items[0] === 'legacy-text-1' &&
      /^(Pano|Board) 1$/.test(migrated.labels[0]),
      `${migrated.count} pano · öğe=${migrated.items.length}`);

    /* 11 · Yeni pano %100 arka plan opaklığıyla açılmalı */
    const freshBg = await evaluate(ws, `(async () => {
      const p = await window.__tailrefWorkspace.createProject();
      await new Promise(r => setTimeout(r, 300));
      const result = {
        bg: state.bg,
        snapshotBg: p && p.snapshot && p.snapshot.bg,
        css: document.querySelector('#backdrop').style.opacity,
        slider: document.querySelector('#bgOpacity') ? document.querySelector('#bgOpacity').value : null,
      };
      await window.__tailrefWorkspace.closeProjectTab(p.id);
      await new Promise(r => setTimeout(r, 250));
      return JSON.stringify(result);
    })()`).then(JSON.parse);
    check('yeni pano %100 arka plan opaklığıyla açılıyor',
      freshBg.bg === 1 && freshBg.snapshotBg === 1 && freshBg.css === '1',
      JSON.stringify(freshBg));

    /* 12 · Pano sınırı: en fazla 10 */
    const limit = await evaluate(ws, `(async () => {
      const w = window.__tailrefWorkspace;
      while (w.order.length < 10) await w.createProject();
      await new Promise(r => setTimeout(r, 250));
      const before = w.order.length;
      const extra = await w.createProject();
      await new Promise(r => setTimeout(r, 150));
      const add = document.querySelector('#btnNewProject');
      const notice = document.querySelector('#projectNotice');
      return JSON.stringify({
        max: window.MAX_PROJECTS,
        before,
        after: w.order.length,
        extra: extra && extra.id,
        disabled: !!(add && add.disabled),
        full: !!(add && add.classList.contains('is-full')),
        title: add && add.title,
        notice: notice ? notice.textContent : '',
        noticeVisible: !!(notice && notice.classList.contains('is-visible')),
        tabs: document.querySelectorAll('#projectTabs .projTab').length,
      });
    })()`).then(JSON.parse);
    check('aynı anda en fazla 10 pano açılabiliyor',
      limit.max === 10 && limit.before === 10 && limit.after === 10 &&
      !limit.extra && limit.tabs === 10,
      `sınır=${limit.max} · sekme=${limit.tabs} · fazladan=${limit.extra || 'yok'}`);
    check('sınırda + düğmesi kapanıyor ve uyarı gösteriliyor',
      limit.disabled && limit.full && limit.noticeVisible && /10/.test(limit.notice),
      limit.notice);

    const released = await evaluate(ws, `(async () => {
      const w = window.__tailrefWorkspace;
      const keep = w.order[0];
      for (const id of w.order.slice()) {
        if (id !== keep) await w.closeProjectTab(id);
      }
      await new Promise(r => setTimeout(r, 300));
      const add = document.querySelector('#btnNewProject');
      return JSON.stringify({
        order: w.order.length,
        disabled: !!(add && add.disabled),
        tabs: document.querySelectorAll('#projectTabs .projTab').length,
      });
    })()`).then(JSON.parse);
    check('pano kapatılınca + yeniden etkinleşiyor',
      released.order === 1 && !released.disabled && released.tabs === 1,
      JSON.stringify(released));

    /* 12b · Yeni pano: + isim sormadan hemen açar; çift tıkla yeniden adlandır */
    const naming = await evaluate(ws, `(async () => {
      const w = window.__tailrefWorkspace;
      const add = document.querySelector('#btnNewProject');
      const pop = document.querySelector('#projectNamePopover');
      const before = w.order.length;
      add.click();
      await new Promise(r => setTimeout(r, 900));
      const after = w.order.length;
      const activeName = w.projects.get(w.activeId) ? w.projects.get(w.activeId).name : '';
      const popHidden = pop.hidden;
      const indexName = (await idbGet('meta', 'workspace'))?.projects
        ?.find(p => p.id === w.activeId)?.name;
      const label = document.querySelector('#projectTabs .projTab.is-active .projTabLabel');
      const tabText = label ? label.textContent : '';

      // Sekme başlığına çift tıkla: ad yerinde düzenlenir.
      if (label) label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      const input = document.querySelector('#projectTabs .projTab.is-active .projTabRename');
      const renamed = !!input;
      if (input) {
        input.value = 'Karalama Panosu';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await new Promise(r => setTimeout(r, 600));
      const finalName = w.projects.get(w.activeId) ? w.projects.get(w.activeId).name : '';
      const finalIndex = (await idbGet('meta', 'workspace'))?.projects
        ?.find(p => p.id === w.activeId)?.name;
      const finalLabel = document.querySelector('#projectTabs .projTab.is-active .projTabLabel');

      for (const p of [...w.projects.values()]) {
        if (p.name === 'Karalama Panosu') await w.closeProjectTab(p.id);
      }
      await new Promise(r => setTimeout(r, 350));
      return JSON.stringify({
        before, after, activeName, popHidden, indexName, tabText,
        renamed, finalName, finalIndex,
        finalLabel: finalLabel ? finalLabel.textContent : '',
        tabs: document.querySelectorAll('#projectTabs .projTab').length,
      });
    })()`).then(JSON.parse);
    check('yeni pano isim sormadan hemen açılıyor',
      naming.after === naming.before + 1 && /^(Pano|Board) \d+$/.test(naming.activeName) &&
      naming.popHidden && naming.tabText === naming.activeName,
      `önce=${naming.before} sonra=${naming.after} · ad=${naming.activeName} · indeks=${naming.indexName} · sekme=${naming.tabText} · popoverKapalı=${naming.popHidden}`);
    check('sekme başlığına çift tıklayınca yeniden adlandırılıyor',
      naming.renamed && naming.finalName === 'Karalama Panosu' &&
      naming.finalLabel === 'Karalama Panosu' &&
      naming.tabs === 1,
      `ad=${naming.finalName} · indeks=${naming.finalIndex} · sekme=${naming.finalLabel}`);

    /* 12c · Önemli renk çarkı yüzen panelin ÜSTÜNDE ve tıklanabilir olmalı */
    const wheel = await evaluate(ws, `(() => {
      const bar = document.querySelector('#itemBar');
      const wheelEl = document.querySelector('#impWheel');
      const prevBar = bar.hidden;
      const prevWheel = wheelEl.hidden;
      bar.hidden = false;
      wheelEl.hidden = false;
      // Çarkı bilerek panelin ÜZERİNE yerleştir: tıklama çarka gitmeli.
      const barRect = bar.getBoundingClientRect();
      wheelEl.style.left = Math.round(barRect.left + 20) + 'px';
      wheelEl.style.top = Math.round(Math.max(10, barRect.bottom - 90)) + 'px';
      const zBar = getComputedStyle(bar).zIndex;
      const zWheel = getComputedStyle(wheelEl).zIndex;
      const disc = document.querySelector('#wheelDisc').getBoundingClientRect();
      const cx = disc.left + disc.width / 2;
      const cy = disc.top + disc.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const onTop = !!hit && wheelEl.contains(hit);
      const hitTag = hit ? (hit.id || hit.className || hit.tagName) : '';
      const wheelRect = wheelEl.getBoundingClientRect();
      const overlapsBar = !(wheelRect.right < barRect.left || wheelRect.left > barRect.right ||
        wheelRect.bottom < barRect.top || wheelRect.top > barRect.bottom);
      bar.hidden = prevBar;
      wheelEl.hidden = prevWheel;
      wheelEl.style.left = '';
      wheelEl.style.top = '';
      return JSON.stringify({ zBar, zWheel, onTop, hitTag, overlapsBar });
    })()`).then(JSON.parse);
    check('önemli renk çarkı panelin üstünde kalıyor (tıklanabilir)',
      Number(wheel.zWheel) > Number(wheel.zBar) && wheel.onTop && wheel.overlapsBar,
      `z: çark=${wheel.zWheel} panel=${wheel.zBar} · isabet=${wheel.hitTag} · çakışma=${wheel.overlapsBar}`);

    /* 12d · Arka plan opaklığı yüzdesi slider çizgisinin üstünde kalmalı.
       `.opVal` konumu `left` geçişiyle (60ms) taşındığı için ölçümden önce
       geçişin bitmesi beklenir; yoksa eski (100%) konum okunur. */
    const opVal = await evaluate(ws, `(async () => {
      const slider = document.querySelector('#bgOpacity');
      const val = document.querySelector('#bgOpacityVal');
      const paint = () => new Promise(r => setTimeout(r, 160));
      const box = () => {
        const vr = val.getBoundingClientRect();
        const sr = slider.getBoundingClientRect();
        return {
          left: Math.round(vr.left), right: Math.round(vr.right),
          overlaps: !(vr.right < sr.left || vr.left > sr.right ||
            vr.bottom < sr.top || vr.top > sr.bottom),
          insideTrack: vr.left >= sr.left - 4 && vr.right <= sr.right + 14,
        };
      };
      setBg(0);
      await paint();
      const zero = { ...box(), text: val.textContent, isLeft: val.classList.contains('is-left') };
      setBg(0.5);
      await paint();
      const mid = { ...box(), text: val.textContent, isLeft: val.classList.contains('is-left') };
      setBg(0.98);
      await paint();
      const high = { ...box(), text: val.textContent, isLeft: val.classList.contains('is-left') };
      setBg(1);
      await paint();
      return JSON.stringify({
        zSlider: getComputedStyle(slider).zIndex,
        zVal: getComputedStyle(val).zIndex,
        zero, mid, high,
      });
    })()`).then(JSON.parse);
    check('arka plan yüzdesi slider çizgisinin üstünde görünüyor',
      Number(opVal.zVal) > Number(opVal.zSlider) &&
      opVal.zero.text === '0%' && opVal.zero.overlaps && opVal.zero.insideTrack &&
      opVal.mid.text === '50%' && opVal.mid.overlaps && opVal.mid.insideTrack &&
      opVal.high.text === '98%' && opVal.high.isLeft,
      `z: etiket=${opVal.zVal} slider=${opVal.zSlider} · 0%→${opVal.zero.left} · ` +
      `50%→${opVal.mid.left} · 98%→${opVal.high.left}${opVal.high.isLeft ? ' (solda)' : ''}`);

    /* 13 · Aşırı yük kurtarma: işaret dosyası + yedek → açılışta otomatik geri
       yükleme. Ana süreç donmuş renderer'dan bağımsız çalıştığı için yedek
       yazılır ve yeniden başlatmada pano verisi YÜKLENMEDEN önce uygulanır. */
    const backupDir = path.join(userDataDir, 'Backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const recoveryRecord = {
      schema: 1,
      id: 'prj_recovered',
      name: 'Kurtarılan Pano',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {
        items: [{
          id: 'recovered-text-1', kind: 'text', x: 20, y: 20, w: 240, h: 60, z: 1,
          text: 'Kurtarılan tahta', color: '#fff', fs: 24,
        }],
        view: { x: 0, y: 0, scale: 1 }, bg: 1,
        groupTitles: {}, groupImportant: {}, groupParents: {}, links: [], trash: [],
      },
      cameraTransform: null,
      pose3d: null,
    };
    const backupName = 'tailref-test-kurtarma.json';
    fs.writeFileSync(path.join(backupDir, backupName), JSON.stringify({
      version: 2,
      createdAt: new Date().toISOString(),
      state: recoveryRecord.state,
      workspace: { schema: 1, activeId: 'prj_recovered', projects: [recoveryRecord] },
      images: [],
    }), 'utf8');
    fs.writeFileSync(path.join(userDataDir, 'recovery.json'), JSON.stringify({
      backup: backupName, reason: 'test', requestedAt: new Date().toISOString(),
    }), 'utf8');

    const listed = await evaluate(ws, '(async () => JSON.stringify(await window.tailref.listBackups()))()')
      .then(JSON.parse).catch(() => []);
    check('yedek listesi ana süreçten okunabiliyor',
      Array.isArray(listed) && listed.some(entry => entry.name === backupName),
      `${Array.isArray(listed) ? listed.length : 0} yedek`);

    await evaluate(ws, 'setTimeout(() => location.reload(), 30); true').catch(() => null);
    await sleep(1200);
    if (!await waitReady(ws)) throw new Error('kurtarma sonrası hazır olmadı');
    await sleep(800);

    const recovered = await evaluate(ws, `(() => {
      const w = window.__tailrefWorkspace;
      return JSON.stringify({
        projects: w.projects.size,
        name: [...w.projects.values()][0]?.name,
        items: state.items.map(i => i.id),
        labels: [...document.querySelectorAll('#projectTabs .projTabLabel')].map(el => el.textContent),
        hasRecoverButton: !!document.querySelector('#btnRecoverBackup'),
      });
    })()`).then(JSON.parse);
    check('açılışta kurtarma yedeği geri yüklendi',
      recovered.projects === 1 && recovered.name === 'Kurtarılan Pano' &&
      recovered.items.length === 1 && recovered.items[0] === 'recovered-text-1' &&
      recovered.labels[0] === 'Kurtarılan Pano',
      JSON.stringify(recovered));
    check('kurtarma işareti temizlendi', !fs.existsSync(path.join(userDataDir, 'recovery.json')));
    check('ayarlarda "Son kayda dön" düğmesi var', recovered.hasRecoverButton);

    /* 14 · Yedek sağlık taraması: aşırı yüklenmiş (çok öğeli) yedek asla seçilmez */
    const hugeItems = [];
    for (let i = 0; i < 1600; i++) {
      hugeItems.push({
        id: `huge-${i}`, kind: 'text', x: i, y: i, w: 40, h: 40, z: i,
        text: 'x', color: '#fff', fs: 12,
      });
    }
    const hugeName = 'tailref-test-bozuk.json';
    /* 14'ü izole et: bu oturumda uygulamanın yazdığı taze oto yedekler ve 13'teki
       kurtarma yedeği silinir. Aksi hâlde sağlıklı ve yeni bir oto yedek,
       "bozuk-yeni vs sağlıklı-eski" kıyasına girmeden seçilebilir (9 Kasım
       bulgusu: chosen = tailref-<ts>.json oto yedek). */
    try {
      for (const f of fs.readdirSync(backupDir)) {
        try { fs.unlinkSync(path.join(backupDir, f)); } catch { /* klasör vb. */ }
      }
    } catch { /* sessiz */ }
    fs.writeFileSync(path.join(backupDir, hugeName), JSON.stringify({
      version: 2,
      createdAt: new Date().toISOString(),
      state: { items: hugeItems, view: { x: 0, y: 0, scale: 1 }, bg: 1 },
      workspace: {
        schema: 1, activeId: 'prj_huge',
        projects: [{
          id: 'prj_huge', name: 'Bozuk Pano', createdAt: 1, updatedAt: 1,
          state: { items: hugeItems, view: { x: 0, y: 0, scale: 1 }, bg: 1 },
        }],
      },
      images: [],
    }), 'utf8');
    const oldHealthyName = 'tailref-test-eski-iyi.json';
    fs.writeFileSync(path.join(backupDir, oldHealthyName), JSON.stringify({
      version: 2,
      createdAt: new Date(Date.now() - 180000).toISOString(),
      state: { items: [], view: { x: 0, y: 0, scale: 1 }, bg: 1 },
      workspace: {
        schema: 1, activeId: 'prj_old',
        projects: [{
          id: 'prj_old', name: 'Eski İyi', createdAt: 1, updatedAt: 1,
          state: { items: [], view: { x: 0, y: 0, scale: 1 }, bg: 1 },
        }],
      },
      images: [],
    }), 'utf8');
    const past = t => new Date(Date.now() - t);
    fs.utimesSync(path.join(backupDir, hugeName), past(30000), past(30000));
    fs.utimesSync(path.join(backupDir, oldHealthyName), past(180000), past(180000));

    const plan = await evaluate(ws, '(async () => JSON.stringify(await window.tailref.getRecoveryPlan()))()')
      .then(JSON.parse);
    const scannedHuge = plan.scanned.find(entry => entry.name === hugeName);
    check('aşırı yüklenmiş yedek sağlıksız işaretleniyor',
      !!scannedHuge && scannedHuge.ok === false && scannedHuge.items >= 1600 &&
      scannedHuge.reason === 'too-many-items',
      scannedHuge ? `${scannedHuge.items} öğe · ${scannedHuge.reason}` : 'taranmadı');
    check('kurtarma bozuk yedek yerine sağlıklı olanı seçiyor',
      plan.chosen && plan.chosen.name === oldHealthyName,
      plan.chosen ? plan.chosen.name : 'seçim yok');

    /* 15 · "Temiz başlat": panolar arşivlenir, uygulama boş panoyla açılır */
    await evaluate(ws, `(async () => {
      const w = window.__tailrefWorkspace;
      const id = w.activeId;
      state.items.push({
        id: 'before-reset-1', kind: 'text', x: 5, y: 5, w: 120, h: 40, z: 1,
        text: 'Sıfırlama öncesi', color: '#fff', fs: 14,
      });
      w.projects.get(id).snapshot.items = state.items.slice();
      await saveNow();
      return true;
    })()`).catch(() => null);
    fs.writeFileSync(path.join(userDataDir, 'recovery.json'), JSON.stringify({
      mode: 'reset', reason: 'test', requestedAt: new Date().toISOString(),
    }), 'utf8');

    await evaluate(ws, 'setTimeout(() => location.reload(), 30); true').catch(() => null);
    await sleep(1500);
    if (!await waitReady(ws)) throw new Error('temiz başlat sonrası hazır olmadı');
    await sleep(800);

    const afterReset = await evaluate(ws, `(() => JSON.stringify({
      projects: window.__tailrefWorkspace.projects.size,
      name: [...window.__tailrefWorkspace.projects.values()][0]?.name,
      items: state.items.length,
      labels: [...document.querySelectorAll('#projectTabs .projTabLabel')].map(el => el.textContent),
    }))()`).then(JSON.parse);
    check('temiz başlat: tek boş panoyla açıldı',
      afterReset.projects === 1 && afterReset.items === 0 && afterReset.labels.length === 1,
      JSON.stringify(afterReset));
    check('temiz başlat: işaret dosyası silindi',
      !fs.existsSync(path.join(userDataDir, 'recovery.json')));

    const archiveRoot = path.join(userDataDir, 'Archive');
    let archived = null;
    try {
      const stamp = fs.readdirSync(archiveRoot).filter(n => fs.statSync(path.join(archiveRoot, n)).isDirectory()).pop();
      if (stamp) archived = JSON.parse(fs.readFileSync(path.join(archiveRoot, stamp, 'workspace.json'), 'utf8'));
    } catch { /* arşiv yok */ }
    const archivedItems = archived && archived.workspace
      ? archived.workspace.projects.reduce((sum, p) => sum + ((p.state && p.state.items) || []).length, 0)
      : 0;
    check('temiz başlat: eski panolar arşive yazıldı',
      !!archived && archivedItems >= 1,
      archived ? `${archived.workspace.projects.length} pano · ${archivedItems} öğe` : 'arşiv yok');
  } finally {
    if (ws) ws.close();
    app.kill();
    await sleep(400);
    try { process.kill(app.pid); } catch { /* zaten kapandı */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* kilitli olabilir */ }
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => {
  console.error('TEST HATASI:', error && error.message ? error.message : error);
  process.exit(1);
});
