'use strict';
/* QA: .abr dışa aktarma → geri içe aktarma → yeniden başlatma. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start, sleep } = require('./harness');

const APP_PORT = 5367;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-out-'));
const STAMP = Date.now();
const IMPORT_NAME = 'QA ABR ' + STAMP;

async function exportBrush(app, brushId) {
  const res = await app.json(`(() => {
    const brush = inkGetBrush(${JSON.stringify(brushId)});
    if (!brush) return JSON.stringify({ error: 'brush yok' });
    const bytes = inkNativeBrushAbrBytes(brush);
    window.__qaAbrBytes = bytes;
    const parsed = bytes ? inkParseAbr(bytes) : [];
    return JSON.stringify({
      name: brush.name,
      length: bytes ? bytes.length : 0,
      magic: bytes ? [bytes[0], bytes[1], bytes[2], bytes[3]] : [],
      parsed: parsed.map(t => ({ kind: t.kind, name: t.name, w: t.width, h: t.height, hasData: !!t.dataUrl })),
    });
  })()`);
  return res;
}

async function importBytes(app, bytes, fileName) {
  const b64 = Buffer.from(bytes).toString('base64');
  return app.json(`(async () => {
    const raw = atob(${JSON.stringify(b64)});
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const file = new File([arr], ${JSON.stringify(fileName)}, { type: 'application/octet-stream' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('inkAbrInput');
    const before = inkState().brushes.length;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (inkState().brushes.length > before) break;
    }
    const added = inkState().brushes.slice(before);
    await new Promise(r => setTimeout(r, 600));
    return JSON.stringify({
      before,
      after: inkState().brushes.length,
      added: added.map(b => ({ id: b.id, name: b.name, kind: b.kind, tipId: b.tipId || '', w: b.width, h: b.height })),
      tipLoaded: added.filter(b => b.tipId).map(b => ({
        tipId: b.tipId,
        data: inkRuntime.importedTips.has(b.tipId),
        image: inkRuntimeBrushes.abrImages.has(b.tipId) ? {
          complete: inkRuntimeBrushes.abrImages.get(b.tipId).complete,
          w: inkRuntimeBrushes.abrImages.get(b.tipId).naturalWidth,
          h: inkRuntimeBrushes.abrImages.get(b.tipId).naturalHeight,
        } : null,
      })),
      notice: (window.__qa.notices || []).slice(-2),
    });
  })()`);
}

async function snapshot(app) {
  return app.json(`(async () => {
    const ink = inkState();
    const db = await idbGet('meta', 'ink:brushes');
    return JSON.stringify({
      abr: (ink.brushes || []).filter(b => /^abr_/.test(b.id)).map(b => ({
        id: b.id, name: b.name, kind: b.kind, tipId: b.tipId || '',
        tipData: b.tipId ? inkRuntime.importedTips.has(b.tipId) : false,
        img: b.tipId && inkRuntimeBrushes.abrImages.has(b.tipId)
          ? inkRuntimeBrushes.abrImages.get(b.tipId).naturalWidth : 0,
      })),
      dbNames: Array.isArray(db) ? db.map(r => r && r.brush ? r.brush.name : null) : null,
    });
  })()`);
}

(async () => {
  let app = await start({ port: 9505, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-a-' });
  let exported = null;
  try {
    /* 1) yerleşik prosedürel fırça dışa aktar */
    const e1 = await exportBrush(app, 'ink-soft');
    console.log('export builtin:', JSON.stringify(e1));
    exported = Buffer.from(await app.evaluate('Array.from(window.__qaAbrBytes)'));
    fs.writeFileSync(path.join(outDir, 'builtin.abr'), exported);
    console.log('dosya:', path.join(outDir, 'builtin.abr'), exported.length, 'bayt');

    /* 2) PNG uçlu özel fırça oluştur + dışa aktar */
    await app.evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = 96; c.height = 96;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 96, 96);
      x.fillStyle = '#000'; x.beginPath(); x.arc(48, 48, 30, 0, Math.PI * 2); x.fill();
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const file = new File([blob], 'qa-abr-tip.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('nativeBrushCustomPng');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); if (inkNativeBrushUi.uploadedTip) break; }
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      const name = document.getElementById('nativeBrushCustomName');
      name.value = ${JSON.stringify('QA ABR Kaynak ' + STAMP)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      return true;
    })()`);
    await sleep(1200);
    const customId = await app.evaluate(`(() => {
      const b = inkState().brushes.find(x => x.name === ${JSON.stringify('QA ABR Kaynak ' + STAMP)});
      return b ? b.id : '';
    })()`);
    console.log('custom id:', customId);
    const e2 = await exportBrush(app, customId);
    console.log('export custom:', JSON.stringify(e2));
    const customBytes = Buffer.from(await app.evaluate('Array.from(window.__qaAbrBytes)'));
    fs.writeFileSync(path.join(outDir, 'custom.abr'), customBytes);
    console.log('custom dosya:', customBytes.length, 'bayt');

    /* 3) dışa aktarılan dosyayı gerçek input üzerinden içe aktar */
    const imp = await importBytes(app, exported, 'builtin.abr');
    console.log('import builtin:', JSON.stringify(imp));

    /* 4) çoklu fırça dosyası: kategori dışa aktarımı */
    const multi = await app.json(`(() => {
      const list = inkNativeVisibleBrushes().slice(0, 3);
      const bytes = inkNativeBrushesAbrBytes(list);
      window.__qaMulti = bytes;
      return JSON.stringify({ count: list.length, names: list.map(b => b.name), length: bytes ? bytes.length : 0 });
    })()`);
    console.log('multi export:', JSON.stringify(multi));
    const multiBytes = Buffer.from(await app.evaluate('Array.from(window.__qaMulti)'));
    fs.writeFileSync(path.join(outDir, 'multi.abr'), multiBytes);

    /* 5) bozuk dosya: çökme yok, anlaşılır hata */
    const bad = await importBytes(app, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]), 'bozuk.abr');
    console.log('bozuk import:', JSON.stringify(bad));

    console.log('before restart:', JSON.stringify(await snapshot(app)));
  } finally {
    await app.stop();
  }

  console.log('--- yeniden açılış ---');
  app = await start({ port: 9507, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-b-' });
  try {
    await sleep(1500);
    const snap = await snapshot(app);
    console.log('after restart:', JSON.stringify(snap));
    const names = snap.abr.map(b => b.name);
    console.log('içe aktarılan ABR duruyor:', names.some(n => n === 'Studio Pen') || names.length > 0, '| adet:', names.length);
    console.log('uç verisi var:', snap.abr.every(b => !b.tipId || b.tipData));

    /* içe aktarılan fırçayla gerçekten kaynak tuvali üretilebiliyor mu? */
    const drawable = await app.json(`(() => {
      const b = inkState().brushes.find(x => /^abr_/.test(x.id));
      if (!b) return JSON.stringify({ error: 'abr fırça yok' });
      let src = null;
      try { src = inkBrushSourceCanvas(b, 0.8, 128); } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
      return JSON.stringify({ name: b.name, w: src && src.width, h: src && src.height,
        nonEmpty: !!(src && src.getContext('2d').getImageData(0, 0, src.width, src.height).data.some(v => v > 0)) });
    })()`);
    console.log('kaynak tuvali:', JSON.stringify(drawable));
  } finally {
    await app.stop();
  }
  console.log('çıktı klasörü:', outDir);
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
