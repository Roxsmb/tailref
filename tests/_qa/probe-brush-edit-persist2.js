'use strict';
/* QA: proje açık değilken özel fırça ayarı değişikliği kalıcı mı?
   (Kütüphane işlemi tetiklenmeden yalnız kaydırıcı + otomatik kayıt.) */
const { start } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_PORT = 5405;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-brush-edit2-'));

(async () => {
  let app = await start({ port: 9541, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-edit2-' });
  let id = '';
  try {
    const first = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      inkOpenNativeBrushLibrary(null, 'custom', { creatorOnly: true });
      await wait(400);
      const name = document.getElementById('nativeBrushCustomName');
      name.value = 'QA Board Fırçası';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('nativeBrushCustomCreate').click();
      await wait(1000);
      const brush = inkState().brushes.find(b => b.name === 'QA Board Fırçası');
      if (!brush) return JSON.stringify({ error: 'fırça oluşmadı' });
      setActiveBrush(brush.id);
      await wait(200);
      const setRange = (elId, value) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setRange('inkSize', 91);
      setRange('inkHardness', 33);
      await wait(2500);
      return JSON.stringify({ id: brush.id, size: brush.size, hardness: brush.hardness,
        editorOpen: typeof inkEditorIsOpen === 'function' && inkEditorIsOpen() });
    })()`);
    console.log('· 1. oturum:', JSON.stringify(first));
    id = first.id || '';
  } finally {
    await app.stop();
  }

  app = await start({ port: 9543, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-brush-edit2b-' });
  try {
    const second = await app.json(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 40 && !(typeof inkState === 'function' && inkState().brushes.length); i += 1) await wait(150);
      await wait(700);
      const brush = inkState().brushes.find(b => b.id === ${JSON.stringify(id)});
      return JSON.stringify({ found: !!brush, size: brush && brush.size,
        hardness: brush && brush.hardness });
    })()`);
    console.log('· 2. oturum:', JSON.stringify(second));
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
