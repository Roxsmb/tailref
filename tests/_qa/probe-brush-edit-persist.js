'use strict';
/* QA: özel fırçanın panel kaydırıcılarıyla değiştirilen ayarları
   (boyut/sertlik/opaklık) yeniden açılışta korunuyor mu? */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5403;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-edit-'));

(async () => {
  let app = await start({ port: 9537, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-edit-' });
  let id = '';
  try {
    const first = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('modeDrawBtn').click();
      await wait(300);
      document.getElementById('newCanvasW').value = '1280';
      document.getElementById('newCanvasH').value = '800';
      document.getElementById('newCanvasForm').requestSubmit();
      for (let i = 0; i < 100 && !inkEditorIsOpen(); i += 1) await wait(100);
      await wait(600);
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      const name = document.getElementById('nativeBrushCustomName');
      name.value = 'QA Ayar Fırçası';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(1000);
      const brush = inkState().brushes.find(b => b.name === 'QA Ayar Fırçası');
      if (!brush) return JSON.stringify({ error: 'fırça oluşmadı' });
      setActiveBrush(brush.id);
      await wait(200);
      const before = { size: brush.size, hardness: brush.hardness, opacity: brush.opacity };
      /* Panel kaydırıcıları gerçek kullanıcı gibi sürükle */
      const setRange = (elId, value) => {
        const el = document.getElementById(elId);
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setRange('inkSize', 137);
      setRange('inkHardness', 42);
      setRange('inkOpacity', 55);
      await wait(1200);
      const after = {
        size: brush.size, hardness: brush.hardness, opacity: brush.opacity,
        stateSize: inkState().size,
      };
      return JSON.stringify({ id: brush.id, before, after });
    })()`);
    console.log('· 1. oturum:', JSON.stringify(first));
    id = first.id || '';

    /* Fırça listesini diske zorla yaz (kütüphane işlemi gibi) */
    await app.evaluate(`(async () => { if (typeof inkNativePersistLibraryAll === 'function') await inkNativePersistLibraryAll(); return true; })()`);
    await new Promise(r => setTimeout(r, 800));
  } finally {
    await app.stop();
  }

  app = await start({ port: 9539, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-edit-b-' });
  try {
    const second = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40 && !(typeof inkState === 'function' && inkState().brushes.length); i += 1) await wait(150);
      await wait(600);
      const brush = inkState().brushes.find(b => b.id === ${JSON.stringify(id)});
      return JSON.stringify({ found: !!brush, size: brush && brush.size,
        hardness: brush && brush.hardness, opacity: brush && brush.opacity });
    })()`);
    console.log('· 2. oturum:', JSON.stringify(second));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
