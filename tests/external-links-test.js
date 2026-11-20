'use strict';

/* Dış bağlantı allowlist testi (saf Node — Electron gerekmez).

   Kullanıcı raporu: Ayarlar'daki "Buy me a coffee" bağlantısı tıklanınca
   hiçbir yere gitmiyordu. Ana süreçteki 'open-external' kapısı yalnız
   YouTube'a izin veriyordu. Allowlist artık src/main/external-links.js
   içinde; bu test hem destek sayfasının geçtiğini hem de keyfi/aldatıcı
   URL'lerin reddedildiğini kanıtlar. */

const { isAllowedExternalUrl, normalizeExternalUrl } = require('../src/main/external-links');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
};

const allowed = [
  ['YouTube video', 'https://www.youtube.com/watch?v=abc123'],
  ['YouTube kök', 'https://youtube.com/'],
  ['youtu.be kısa', 'https://youtu.be/abc123'],
  ['YouTube nocookie', 'https://www.youtube-nocookie.com/embed/abc'],
  ['Buy Me a Coffee (kullanıcı sayfası)', 'https://www.buymeacoffee.com/roxsmb'],
  ['Buy Me a Coffee kök', 'https://buymeacoffee.com/'],
];
for (const [name, url] of allowed) {
  ok(`izinli: ${name}`, isAllowedExternalUrl(url) === true, url);
}

const rejected = [
  ['http (TLS yok)', 'http://www.buymeacoffee.com/roxsmb'],
  ['keyfi site', 'https://example.com/'],
  ['alt alan taklidi', 'https://buymeacoffee.com.evil.example/'],
  ['sonek taklidi', 'https://evilbuymeacoffee.com/'],
  ['youtube taklidi', 'https://youtube.com.evil.example/watch'],
  ['javascript:', 'javascript:alert(1)'],
  ['file:', 'file:///C:/Windows/System32/calc.exe'],
  ['veri:', 'data:text/html,<script>alert(1)</script>'],
  ['boş', ''],
  ['null', null],
  ['nesne', { toString() { return 'https://example.com/'; } }],
];
for (const [name, url] of rejected) {
  ok(`red: ${name}`, isAllowedExternalUrl(url) === false, String(url));
}

ok('normalize: destek URL kurallı döner',
  normalizeExternalUrl('https://www.buymeacoffee.com/roxsmb') === 'https://www.buymeacoffee.com/roxsmb',
  String(normalizeExternalUrl('https://www.buymeacoffee.com/roxsmb')));
ok('normalize: reddedilen URL null',
  normalizeExternalUrl('https://example.com/') === null);

console.log(fail === 0
  ? `\nTÜM TESTLER GEÇTİ (${pass}/${pass})`
  : `\n${fail} TEST BAŞARISIZ (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
