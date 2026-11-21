'use strict';
/* TailRef · Tur T Faz 6 — arayüz paket CLI doğrulayıcı.
   02d-ui-package-format.js'teki SAF doğrulayıcıyı Node'da koşar;
   kapı zincirinde örnek paketin + güvenlik vakalarının kanıtını tutar.
   Kullanım:
     node scripts/ui-package-validate.js <paket.json>   (dosya denetle)
     node scripts/ui-package-validate.js                (kendi testleri) */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* Saf doğrulayıcıyı DOM'suz yükle. */
function loadValidator() {
  const src = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'core', '02d-ui-package-format.js'), 'utf8');
  const sandbox = {};
  return new Function('window',
    src + '\nreturn window.tailrefUiPackageFormat;')(sandbox);
}

function main() {
  const fmt = loadValidator();
  const fileArg = process.argv[2];
  if (fileArg) {
    const text = fs.readFileSync(fileArg, 'utf8');
    let pkg;
    try { pkg = JSON.parse(text); } catch (e) {
      console.error('HATA JSON: ' + e.message);
      process.exit(1);
    }
    if (text.length > fmt.MAX_BYTES) { console.error('HATA: 64 KB sınırı'); process.exit(1); }
    const res = fmt.validate(pkg, 'ui_cli');
    if (res.ok) { console.log('OK   ' + path.basename(fileArg) + ' · ' + res.css.length + ' byte CSS üretildi'); }
    else { console.error('RED: ' + res.errors.join(' | ')); process.exit(1); }
    return;
  }

  /* Kapı testleri: güvenlik vakaları reddedilmeli. */
  const good = {
    format: 'tailref-ui@1',
    meta: { name: 'Gate Slate', author: 'gate', version: 1, desc: 'cli' },
    tokens: { '--ui-font': 'Tahoma' },
    rules: [
      { selector: 'button', props: { 'border-radius': '0px' } },
      { selector: '#appModeBar', props: { 'background-color': '#223344' } },
    ],
  };
  const cases = [
    ['geçerli paket kabul', fmt.validate(good, 'ui_g').ok === true],
    ['format yanlış → red', fmt.validate({ ...good, format: 'ui@1' }, 'ui_x').ok === false],
    ['meta.name yok → red', fmt.validate({ ...good, meta: {} }, 'ui_x').ok === false],
    ['whitelist dışı property → red',
      fmt.validate({ ...good, rules: [{ selector: 'b', props: { position: 'fixed' } }] }, 'ui_x').ok === false],
    ['url( değeri → red',
      fmt.validate({ ...good, rules: [{ selector: 'b', props: { background: 'url(http://x)' } }] }, 'ui_x').ok === false],
    ['javascript: değeri → red',
      fmt.validate({ ...good, rules: [{ selector: 'b', props: { color: 'javascript:x' } }] }, 'ui_x').ok === false],
    ['@ seçici → red',
      fmt.validate({ ...good, rules: [{ selector: '@media screen', props: { color: '#111' } }] }, 'ui_x').ok === false],
    ['braces değeri → red',
      fmt.validate({ ...good, rules: [{ selector: 'b', props: { color: '#fff} body{display:none}' } }] }, 'ui_x').ok === false],
    /* CSS kaçış dizisi (ters bölü) ile filtre atlatma denemeleri. */
    ['seçicide CSS kaçışı (\\7b) → red',
      fmt.validate({ ...good, rules: [{ selector: 'b\\7b color:red', props: { color: '#111' } }] }, 'ui_x').ok === false],
    ['değerde CSS kaçışı (u\\72l) → red',
      fmt.validate({ ...good, rules: [{ selector: 'b', props: { background: 'u\\72l(http://x)' } }] }, 'ui_x').ok === false],
    ['token değerinde ters bölü → red',
      fmt.validate({ ...good, tokens: { '--ui-x': '\\40 import' } }, 'ui_x').ok === false],
    ['token adı --ui- dışı → red',
      fmt.validate({ ...good, tokens: { '--pos': 'fixed' } }, 'ui_x').ok === false],
    ['background-image data:image kabul', fmt.validate({ ...good, rules: [
      { selector: 'b', props: { 'background-image': 'data:image/png;base64,AAAA' } }] }, 'ui_g2').ok === true],
    ['background-image http → red', fmt.validate({ ...good, rules: [
      { selector: 'b', props: { 'background-image': 'url(http://x/a.png)' } }] }, 'ui_x').ok === false],
  ];
  let fail = 0;
  for (const [name, ok] of cases) {
    console.log((ok ? 'OK   ' : 'FAIL ') + name);
    if (!ok) fail++;
  }
  if (fail) { console.error('KIRMIZI: ' + fail); process.exit(1); }
  console.log('UI-PAKET-FORMAT: ' + cases.length + ' geçti');
}

main();
