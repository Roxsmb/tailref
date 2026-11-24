/* =========================================================
   build-native.js - inkcore yerel derleyici
   =========================================================
   native/inkcore altındaki N-API eklentisini Electron ABI'sine
   göre derler. Zorunlu değil: derleme başarısız olursa motor
   JS yoluna düşer (uygulama aynen koşar, yalnız hız kazancı yok).
   Çıktı: native/inkcore/build/Release/inkcore.node
   ========================================================= */

'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT, 'native', 'inkcore');
const OUT = path.join(CORE_DIR, 'build', 'Release', 'inkcore.node');

/* --- derleyici durumu ---
   Windows: vswhere + standart Visual Studio yolu.
   Linux/macOS: make + C/C++ derleyici + python3 (node-gyp gereksinimleri). */
function commandExists(cmd) {
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [cmd], { stdio: 'ignore' });
    } else {
      execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function hasPosixToolchain() {
  const compiler = commandExists('cc') || commandExists('gcc') || commandExists('clang');
  const python = commandExists('python3') || commandExists('python');
  return compiler && commandExists('make') && python;
}

/* Hedef mimari: --arch=<arch> verilirse o, yoksa çalışan sürecin mimarisi.
   macOS'ta tek (arm64) runner'dan hem arm64 hem x64 paket üretilebilsin diye
   gerekli: node-gyp --arch ile clang'ı çapraz derlemeye yönlendirir. */
function targetArch(argv) {
  const found = (argv || []).find(a => typeof a === 'string' && a.startsWith('--arch='));
  if (!found) return process.arch;
  const value = found.slice('--arch='.length).trim();
  if (value === 'x86_64') return 'x64';
  if (value === 'aarch64') return 'arm64';
  return value || process.arch;
}

function hasToolchain() {
  if (process.platform !== 'win32') return hasPosixToolchain();
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (fs.existsSync(vswhere)) {
    try {
      const out = execFileSync(vswhere, [
        '-latest', '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
      ], { encoding: 'utf8' }).trim();
      if (out) return true;
    } catch { /* asagi yoldaki taramaya dus */ }
  }
  /* vswhere örnek kaydını her zaman görmeyebilir (kurulu derleyici bile
     kayıt gecikmelidir). Standart dizin varsa derleyici vardir.
     Visual Studio 2022 x86 "Program Files (x86)" altında, 2026 ise
     "Program Files" altında 18\ klasöründe kurulur. */
  const roots = [
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
    'C:\\Program Files\\Microsoft Visual Studio\\2022',
    'C:\\Program Files\\Microsoft Visual Studio\\18',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\18',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const variants = fs.readdirSync(root);
      for (const variant of variants) {
        const msvc = path.join(root, variant, 'VC', 'Tools', 'MSVC');
        if (fs.existsSync(msvc)) return true;
      }
    } catch { /* okuma hatası = yok say */ }
  }
  return false;
}

/* --- node-gyp ---
   Proje içindeki node-gyp her zaman önce denenir. npm'in paketlediği
   sürüm eski kalabilir: node-gyp 11, Visual Studio 2026 (18.x) sürümünü
   tanımaz ve CI'daki windows-latest imajında derleme düşer. Bu yüzden
   node-gyp package.json devDependencies içinde sabitlenmiştir. */
function findNodeGyp() {
  const cands = [
    path.join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ];
  try {
    const raw = fs.realpathSync(
      execSync('npm root -g', { encoding: 'utf8' }).trim());
    cands.push(path.join(raw, 'npm', 'node_modules', 'node-gyp', 'bin',
      'node-gyp.js'));
    cands.push(path.join(raw, 'node-gyp', 'bin', 'node-gyp.js'));
  } catch { /* global dizin yoksa atla */ }
  try {
    const np = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
    cands.push(path.join(np, 'node_modules', 'npm', 'node_modules', 'node-gyp',
      'bin', 'node-gyp.js'));
    cands.push(path.join(np, 'node-gyp', 'bin', 'node-gyp.js'));
  } catch { /* npm prefix okunamazsa atla */ }
  if (process.platform === 'win32') {
    cands.push('C:\\Program Files\\nodejs\\node_modules\\npm\\node_modules' +
      '\\node-gyp\\bin\\node-gyp.js');
  }
  for (const c of cands) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function nodeGypVersion(gypJs) {
  try {
    const pkg = path.join(path.dirname(gypJs), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function main() {
  if (!hasToolchain()) {
    /* Yerel motor kokusu yok - yalnızca hız kazancı atlanır. */
    console.warn('[inkcore] derleyici bulunamadı - yerel motor atlandı (JS yolu)');
    process.exit(0);
  }
  const gyp = findNodeGyp();
  if (!gyp) {
    console.warn('[inkcore] node-gyp bulunamadı - yerel motor atlandı');
    process.exit(0);
  }
  console.log(`[inkcore] node-gyp ${nodeGypVersion(gyp)} (${gyp})`);
  /* Electron ABI: paketin kendi sürümüne göre derle. Mimari --arch ile
     seçilebilir (varsayılan: çalışan süreç). */
  const electron = require(path.join(ROOT, 'node_modules', 'electron',
    'package.json')).version;
  const arch = targetArch(process.argv.slice(2));
  console.log(`[inkcore] derleme: electron ${electron} · ${process.platform}/${arch}`);
  const args = [
    gyp, 'rebuild',
    `--runtime=electron`, `--target=${electron}`,
    '--dist-url=https://electronjs.org/headers',
    `--arch=${arch}`,
  ];
  /* Çevrimdışı derleme (ör. Flatpak sandbox): Electron başlıkları hazır
     açılmış bir dizinden kullanılır; ağdan indirme yapılmaz. */
  const nodedir = process.env.TAILREF_NODEDIR || '';
  if (nodedir) args.push(`--nodedir=${nodedir}`);
  execFileSync(process.execPath, args, {
    cwd: CORE_DIR,
    stdio: 'inherit',
  });
  if (!fs.existsSync(OUT)) {
    console.warn('[inkcore] çıktı yok: ' + OUT);
    process.exit(3);
  }
  console.log('[inkcore] tamam: ' + OUT);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.warn('[inkcore] derleme hatası - JS yolu:', String(err));
  process.exit(4);
}
