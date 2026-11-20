'use strict';

/* Duman testi — sunucuyu ayağa kaldırır, kritik dosyaların 200 döndüğünü ve
   klasör dışına çıkan isteklerin engellendiğini doğrular.
   Kullanım: node scripts/smoke-test.js */

const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SRV_ROOT = path.join(ROOT, 'src', 'renderer');
const { startStaticServer, resolvePath } = require(path.join(ROOT, 'src', 'main', 'static-server.js'));

const PORT = 5199;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

const CRITICAL = [
  '/', '/index.html', '/style.css', '/app.js', '/canvas/draw-v5.js', '/workers/ink-worker.js', '/pose3d.js', '/panel.html',
  '/assets/tailref-mark.svg',
  '/assets/tailref_logo_black_transparent.png',
  '/assets/tailref_studio_wordmark_white.png',
  '/assets/tailref_studio_wordmark_white_wide.png',
  '/assets/favicon-light.png',
  '/assets/favicon-dark.png',
  '/vendor/three.module.js', '/vendor/FBXLoader.js', '/vendor/GLTFLoader.js',
  '/vendor/OrbitControls.js', '/vendor/TransformControls.js', '/vendor/OutlineEffect.js',
  '/vendor/utils/BufferGeometryUtils.js', '/vendor/libs/fflate.module.js',
  '/vendor/curves/NURBSCurve.js', '/vendor/curves/NURBSUtils.js',
  '/vendor/RGBELoader.js', '/vendor/OBJLoader.js',
  '/vendor/postprocessing/EffectComposer.js', '/vendor/shaders/CopyShader.js',
  '/vendor/postprocessing/Pass.js', '/vendor/postprocessing/ShaderPass.js',
  '/vendor/postprocessing/SSAOPass.js', '/vendor/postprocessing/BokehPass.js',
  '/vendor/postprocessing/OutputPass.js', '/vendor/postprocessing/MaskPass.js',
  '/pose3d/bootstrap.js', '/pose3d/core/Viewport.js',
  '/pose3d/core/CameraManager.js', '/pose3d/core/RenderPipeline.js',
  '/pose3d/core/SceneGraph.js',
  '/pose3d/ui/PanelController.js',
  '/pose3d/ui/Hud.js', '/pose3d/ui/Guides.js', '/pose3d/ui/CaptureModal.js',
  '/pose3d/posing/PoseLibrary.js', '/pose3d/posing/PoseHistory.js',
  '/pose3d/posing/PosingController.js', '/pose3d/posing/GizmoManager.js',
  '/pose3d/posing/Rig.js',
  '/pose3d/environment/LightingRig.js', '/pose3d/environment/Environment.js',
  '/pose3d/capture/RenderExporter.js', '/pose3d/capture/CapturePresets.js',
  '/pose3d/bridge/BoardBridge.js', '/pose3d/util/helpers.js',
  '/pose3d/dummy/DummyRig.js',
  '/splash.html',
];

// Kökün dışına çıkan istekler engellenmeli (403/404/400) ya da kökün içine
// normalize edilip 404 dönmeli. Hiçbir durumda kök dışındaki bir dosya servis edilmemeli.
const ESCAPES = [
  '/..%2f..%2fWindows/win.ini',
  '/../../Windows/win.ini',
  '/..%5c..%5cwin.ini',
  '/..%2f..%2f..%2fWindows/win.ini',
  '/....//package.json',
];

(async () => {
  const srv = await startStaticServer({ root: SRV_ROOT, port: PORT });
  let fail = 0;

  for (const p of CRITICAL) {
    const code = await get(p);
    if (code !== 200) { console.log(`FAIL ${code}  ${p}`); fail++; }
  }
  console.log(fail === 0 ? `OK   kritik dosyalar: ${CRITICAL.length}/${CRITICAL.length}` : `FAIL kritik dosya: ${fail}`);

  for (const p of ESCAPES) {
    const code = await get(p);
    const blocked = code === 403 || code === 404 || code === 400;
    if (!blocked) fail++;
    console.log(`${blocked ? 'OK  ' : 'FAIL'} ${code}  ${p}`);
  }

  // Null baytı ve kontrol karakterleri sunucuyu düşürmemeli; 400 dönmeli.
  const MALFORMED = ['/%00', '/%00index.html', '/%01', '/%1f', '/%7f', '/assets/%00.png'];
  for (const p of MALFORMED) {
    const code = await get(p);
    const blocked = code === 400 || code === 403 || code === 404;
    if (!blocked) fail++;
    console.log(`${blocked ? 'OK  ' : 'FAIL'} ${code}  ${p}`);
  }
  const alive = await get('/index.html');
  if (alive !== 200) { fail++; console.log(`FAIL kontrol karakterli istekten sonra sunucu: ${alive}`); }
  else console.log('OK   sunucu kontrol karakterli istekten sonra ayakta');

  for (const bad of ['/\0', '/\x01', '/\x7f']) {
    if (resolvePath(SRV_ROOT, bad) !== null) { fail++; console.log(`FAIL resolvePath kontrol karakterini kabul etti: ${JSON.stringify(bad)}`); }
  }
  console.log('OK   resolvePath kontrol karakterlerini reddetti');

  // Gizli dosyalar ve geliştirme bağımlılıkları istemciye açılmamalı.
  const SECRET_PATHS = [
    '/.gitignore', '/.env', '/.env.example', '/.git/config',
    '/node_modules/electron/package.json', '/assets/.hidden',
  ];
  for (const p of SECRET_PATHS) {
    const code = await get(p);
    const blocked = code === 403 || code === 404;
    if (!blocked) fail++;
    console.log(`${blocked ? 'OK  ' : 'FAIL'} ${code}  ${p}`);
  }
  for (const p of SECRET_PATHS) {
    const out = resolvePath(SRV_ROOT, p);
    if (out !== null) { fail++; console.log(`FAIL resolvePath gizli yolu kabul etti: ${p} -> ${out}`); }
  }
  console.log('OK   gizli dosya ve node_modules yolları reddedildi');

  // Asıl güvence: hiçbir girdi kök dışında bir dosya yolu üretmemeli.
  const fuzz = [
    '/../../../package.json', '/....//package.json', '/vendor/../../package.json',
    '/..\\..\\package.json', '/%2e%2e/%2e%2e/package.json', '/./vendor/../package.json',
  ];
  for (const p of fuzz) {
    let decoded = p;
    try { decoded = decodeURIComponent(p); } catch { /* geçersiz kodlama */ }
    const out = resolvePath(SRV_ROOT, decoded);
    const rel = out === null ? '' : path.relative(SRV_ROOT, out);
    const outside = out !== null && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
    if (outside) { fail++; console.log(`FAIL kök dışına çıktı: ${p} -> ${out}`); }
  }
  console.log('OK   resolvePath fuzz: kök dışına çıkan yol üretilmedi');

  srv.close();
  console.log(fail === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${fail} TEST BAŞARISIZ`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI', e); process.exit(1); });
