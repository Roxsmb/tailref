'use strict';

/* 3D birim testleri — DOM/WebGL gerekmez.

   Modüller ESM; paket "type": "commonjs" olduğu için .js dosyaları doğrudan
   import edilemez. Kaynak data: URL üzerinden yüklenir (saf modüller için).
   Kullanım: node scripts/pose3d-unit.js */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`OK   ${name}${detail ? `  → ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

async function loadModule(relative) {
  const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

(async () => {
  const base = { width: 380, height: 232 };
  const presets = await loadModule('src/renderer/pose3d/capture/CapturePresets.js');
  const {
    SCALE_OPTIONS, PASS_IDS, BACKGROUNDS, SIZE_PRESETS,
    resolveSize, estimateBytes, formatBytes, describeSize, memoryWarning,
  } = presets;

  /* --- resolveSize --- */
  const one = resolveSize({ scale: 1 }, base, 8192);
  check('1x kaynak çizim tamponunu koruyor',
    one.width === 380 && one.height === 232 && one.scale === 1,
    `${one.width}×${one.height}`);

  const two = resolveSize({ scale: 2 }, base, 8192);
  check('2x boyutu ikiye katlıyor',
    two.width === 760 && two.height === 464,
    `${two.width}×${two.height}`);

  const fourK = resolveSize({ preset: '4k' }, base, 8192);
  check('4K preset 3840×2160',
    fourK.width === 3840 && fourK.height === 2160 && fourK.preset === '4k',
    `${fourK.width}×${fourK.height}`);

  const eightK = resolveSize({ preset: '8k' }, base, 8192);
  check('8K preset 7680×4320',
    eightK.width === 7680 && eightK.height === 4320 && !eightK.clamped,
    `${eightK.width}×${eightK.height}`);

  const clamped = resolveSize({ preset: '8k' }, base, 4096);
  check('maxTextureSize aşılırsa oran korunarak küçültülüyor',
    clamped.clamped === true && clamped.width <= 4096 && clamped.height <= 4096
      && Math.abs(clamped.width / clamped.height - 16 / 9) < 0.01,
    `${clamped.width}×${clamped.height} · sınır=${clamped.limit}`);

  const custom = resolveSize({ scale: 4, width: 512, height: 512 }, base, 8192);
  check('elle verilen boyut ölçeği geçersiz kılıyor',
    custom.width === 512 && custom.height === 512,
    `${custom.width}×${custom.height}`);

  const tiny = resolveSize({ scale: 0.01 }, base, 8192);
  check('ölçek alt sınırı (0.1x) uygulanıyor',
    tiny.width === 38 && tiny.height === 23,
    `${tiny.width}×${tiny.height}`);

  check('bilinmeyen preset yok sayılıyor',
    resolveSize({ preset: '16k', scale: 2 }, base, 8192).width === 760);

  /* --- boyut / bellek metinleri --- */
  const bytes4k = estimateBytes(3840, 2160);
  check('estimateBytes RGBA hesabı', bytes4k === 33177600, `${bytes4k} bayt`);
  check('formatBytes MB biçimlendirmesi',
    formatBytes(bytes4k) === '32 MB' && formatBytes(1572864) === '1.5 MB',
    `${formatBytes(bytes4k)} · ${formatBytes(1572864)}`);

  const info = describeSize(two);
  check('describeSize ölçü + bellek + biçim içeriyor',
    info.includes('760 × 464') && info.includes('RGBA ≈') && info.includes('PNG'),
    info);

  const warn8k = memoryWarning(eightK);
  check('8K için bellek uyarısı',
    warn8k?.level === 'danger' && /127 MB/.test(warn8k.text),
    warn8k ? warn8k.text : 'yok');
  check('4K için uyarı yok', memoryWarning(fourK) === null);

  /* --- sabitler --- */
  check('pass listesi sabit sırada',
    PASS_IDS.join(',') === 'beauty,alpha,depth,normal,wireframe',
    PASS_IDS.join(','));
  check('ölçek seçenekleri 1/2/4', SCALE_OPTIONS.join(',') === '1,2,4');
  check('arka plan seçenekleri',
    BACKGROUNDS.includes('scene') && BACKGROUNDS.includes('transparent') && BACKGROUNDS.includes('white'),
    BACKGROUNDS.join(','));
  check('preset etiketleri',
    SIZE_PRESETS['4k'].label === '4K' && SIZE_PRESETS['8k'].label === '8K');

  /* --- 3D gezinme şeması (Maya / Blender) --- */
  const nav = await loadModule('src/renderer/pose3d/core/NavPreset.js');
  check('gezinme şemaları maya+blender',
    nav.POSE_NAV_PRESETS.join(',') === 'maya,blender');
  check('bilinmeyen şema maya’ya düşer',
    nav.normalizeNavPreset('blender') === 'blender' &&
    nav.normalizeNavPreset('') === 'maya' &&
    nav.normalizeNavPreset(undefined) === 'maya' &&
    nav.normalizeNavPreset('Maya') === 'maya');

  const mayaAlt = nav.navMouseMap('maya', { alt: true });
  check('maya: Alt+sol orbit · Alt+orta pan · Alt+sağ dolly',
    mayaAlt.LEFT === 'ROTATE' && mayaAlt.MIDDLE === 'PAN' && mayaAlt.RIGHT === 'DOLLY');
  const mayaPlain = nav.navMouseMap('maya', {});
  check('maya: değiştiricisiz düz basış gezinmeyi çalıştırmaz',
    mayaPlain.LEFT === null && mayaPlain.MIDDLE === null && mayaPlain.RIGHT === null);

  const blenderPlain = nav.navMouseMap('blender', {});
  const blenderShift = nav.navMouseMap('blender', { shift: true });
  const blenderCtrl = nav.navMouseMap('blender', { ctrl: true });
  check('blender: orta orbit · Shift+orta pan (yerleşik) · Ctrl+orta dolly',
    blenderPlain.MIDDLE === 'ROTATE' &&
    blenderShift.MIDDLE === 'ROTATE' &&
    blenderCtrl.MIDDLE === 'DOLLY');
  check('blender: sol/sağ gezinmeyi çalıştırmaz',
    blenderPlain.LEFT === null && blenderPlain.RIGHT === null &&
    blenderShift.LEFT === null && blenderCtrl.LEFT === null);

  check('şema ipucu metni tuşları anlatır',
    /Industry standard: Alt \+ left = orbit/.test(nav.navPresetHint('maya')) &&
    /Blender: middle = orbit/.test(nav.navPresetHint('blender')));

  if (failures.length) {
    console.log(`\n${failures.length} test başarısız: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nTÜM TESTLER GEÇTİ (${passed}/${passed})`);
  }
})().catch(error => {
  console.error('Birim testi çöktü:', error);
  process.exitCode = 1;
});
