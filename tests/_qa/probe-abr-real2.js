'use strict';
/* QA: gerçek Photoshop seti — içe aktar, kapat, aynı profille aç,
   fırçalar/uçlar duruyor mu ve gerçekten boya bırakıyor mu? */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const APP_PORT = 5381;
const FILE = process.argv[2] ||
  path.join(os.tmpdir(), 'tailref-real-abr', '20 Smoke PS Brushes abr. Vol.6', '20 Smoke Brushes.abr');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-real2-'));
const bytes = fs.readFileSync(FILE);

async function pushBytes(app) {
  const CHUNK = 3 * 1024 * 1024;
  await app.evaluate(`window.__abrChunks = []; true`);
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const part = bytes.subarray(at, Math.min(bytes.length, at + CHUNK)).toString('base64');
    await app.evaluate(`window.__abrChunks.push(${JSON.stringify(part)}); true`);
  }
  await app.evaluate(`(() => {
    const bin = atob(window.__abrChunks.join(''));
    window.__abrChunks = null;
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    window.__qaAbr = arr;
    return true;
  })()`);
}

(async () => {
  let app = await start({ port: 9519, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-real2-' });
  let ids = [];
  try {
    await pushBytes(app);
    const first = await app.json(`(async () => {
      const before = inkState().brushes.length;
      const dt = new DataTransfer();
      dt.items.add(new File([window.__qaAbr], '20 Smoke Brushes.abr', { type: 'application/octet-stream' }));
      const input = document.getElementById('inkAbrInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (inkState().brushes.length >= before + 4) break;
      }
      await new Promise(r => setTimeout(r, 1500));
      const added = inkState().brushes.slice(before);
      return JSON.stringify({ added: added.length, ids: added.map(b => b.id) });
    })()`);
    ids = first.ids;
    console.log('1. oturum:', JSON.stringify(first));
  } finally {
    await app.stop();
  }

  app = await start({ port: 9521, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-real2b-' });
  try {
    const after = await app.json(`(async () => {
      const ids = ${JSON.stringify(ids)};
      const brushes = ids.map(id => inkState().brushes.find(b => b.id === id) || null);
      /* uç görselleri asenkron çözülür */
      for (let i = 0; i < 100; i++) {
        const ok = brushes.every(b => b && (!b.tipId || inkRuntimeBrushes.abrImages.has(b.tipId)));
        if (ok) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const tips = brushes.map(b => {
        if (!b) return null;
        const img = b.tipId ? inkRuntimeBrushes.abrImages.get(b.tipId) : null;
        return { id: b.id, name: b.name, category: b.category,
          tipId: b.tipId, tipStored: inkRuntime.importedTips.has(b.tipId),
          imgW: img ? img.naturalWidth : 0, imgH: img ? img.naturalHeight : 0 };
      });
      const visible = inkNativeVisibleBrushes().map(b => b.id);
      return JSON.stringify({ tips, allVisible: ids.every(id => visible.includes(id)) });
    })()`);
    console.log('2. oturum:', JSON.stringify(after, null, 2));

    /* Gerçek boya testi: içe aktarılan fırçayla tuval üzerine vuruş. */
    const paint = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const id = ${JSON.stringify(ids[0])};
      const brush = inkState().brushes.find(b => b.id === id);
      if (!brush) return JSON.stringify({ error: 'fırça yok' });
      /* Çizim modunu aç ve tuval oluştur. */
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      const modal = document.getElementById('newCanvasModal');
      document.getElementById('newCanvasW').value = '1400';
      document.getElementById('newCanvasH').value = '1000';
      document.getElementById('newCanvasName').value = 'ABR Boya Testi';
      const bg = modal.querySelector('input[name="ncBg"][value="transparent"]');
      if (bg) bg.checked = true;
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 120 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(700);
      if (!inkEditorIsOpen()) return JSON.stringify({ error: 'çizim modu açılmadı' });
      inkSetTool('brush', { brushId: id });
      const layer = inkActiveLayer();
      if (!layer) return JSON.stringify({ error: 'katman yok' });
      const ink = inkState();
      ink.color = '#ffffff';
      ink.opacity = 1;
      ink.flow = 1;
      ink.shapeSnap = false;
      const canvas = document.getElementById('inkEditorCanvas');
      const rect = canvas.getBoundingClientRect();
      /* Görünen kompozit: ana tuval + karo örtüsü. */
      const komposit = () => {
        const cp = document.createElement('canvas');
        cp.width = canvas.width;
        cp.height = canvas.height;
        const c2 = cp.getContext('2d');
        c2.drawImage(canvas, 0, 0);
        const host = document.querySelector('[data-ink-tile-view]');
        if (host) {
          for (const t of host.querySelectorAll('canvas')) {
            c2.drawImage(t, parseFloat(t.style.left) || 0, parseFloat(t.style.top) || 0,
              parseFloat(t.style.width) || t.width, parseFloat(t.style.height) || t.height);
          }
        }
        return c2.getImageData(0, 0, cp.width, cp.height).data;
      };
      const baseline = komposit();
      const opts = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, bubbles: true };
      const x0 = rect.left + rect.width * 0.3, y0 = rect.top + rect.height * 0.35;
      const x1 = rect.left + rect.width * 0.7, y1 = rect.top + rect.height * 0.65;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          ...opts, clientX: x0 + (x1 - x0) * t, clientY: y0 + (y1 - y0) * t }));
        await new Promise(r => setTimeout(r, 20));
      }
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0, clientX: x1, clientY: y1 }));
      await new Promise(r => setTimeout(r, 700));
      const after = komposit();
      let inkPixels = 0;
      for (let i = 0; i < after.length; i += 4) {
        if (Math.abs(after[i] - baseline[i]) > 12 ||
            Math.abs(after[i + 1] - baseline[i + 1]) > 12 ||
            Math.abs(after[i + 2] - baseline[i + 2]) > 12) inkPixels++;
      }
      return JSON.stringify({ inkPixels, brush: brush.name, size: ink.size,
        canvas: { w: canvas.width, h: canvas.height },
        errors: (window.__qaErrs || []).slice(0, 5) });
    })()`);
    console.log('boya:', JSON.stringify(paint));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
