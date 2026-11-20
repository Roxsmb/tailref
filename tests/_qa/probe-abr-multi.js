'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { start, sleep } = require('./harness');

const APP_PORT = 5373;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-abr-multi-'));
const files = [
  path.join(os.tmpdir(), 'tailref-abr-out', 'multi.abr'),
  path.join(os.tmpdir(), 'tailref-abr-out', 'custom.abr'),
];

(async () => {
  const app = await start({ port: 9511, appPort: APP_PORT, userDataDir, keepData: true, prefix: 'tailref-abr-multi-' });
  try {
    for (const file of files) {
      const b64 = fs.readFileSync(file).toString('base64');
      const res = await app.json(`(async () => {
        const raw = atob(${JSON.stringify(b64)});
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const input = document.getElementById('inkAbrInput');
        const before = inkState().brushes.length;
        const dt = new DataTransfer();
        dt.items.add(new File([arr], ${JSON.stringify(path.basename(file))}, { type: 'application/octet-stream' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (inkState().brushes.length >= before + 1) break;
        }
        await new Promise(r => setTimeout(r, 800));
        const added = inkState().brushes.slice(before);
        return JSON.stringify({
          file: ${JSON.stringify(path.basename(file))},
          added: added.length,
          items: added.map(b => ({ name: b.name, category: b.category, tipId: b.tipId, tipData: !!b.tipId && inkRuntime.importedTips.has(b.tipId), img: b.tipId && inkRuntimeBrushes.abrImages.has(b.tipId) ? inkRuntimeBrushes.abrImages.get(b.tipId).naturalWidth : 0 })),
          inCustom: added.every(b => inkNativeBrushesForCategory('custom').some(x => x.id === b.id)),
        });
      })()`);
      console.log(JSON.stringify(res));
    }
  } finally {
    await app.stop();
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
})();
