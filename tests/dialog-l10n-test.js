'use strict';
/* TailRef · ana-süreç diyalog yerelleştirmesi birim testi.
   dialog-l10n.js'in sözleşmesi: 10 dil paketi aynı anahtar kümesi,
   t() seçili dil → EN düşüşü, {ad} interpolasyonu, localeTag haritası. */

const assert = require('assert');
const d = require('../src/main/dialog-l10n');

const DILLER = ['tr', 'de', 'fr', 'es', 'ja', 'ko', 'zh-CN', 'pt-BR', 'ru'];

let adet = 0;
function ok(baslik, kosul) {
  assert.ok(kosul, baslik);
  adet += 1;
  console.log('OK   ' + adet + 'x ' + baslik);
}

/* 1) Tüm paketler tam anahtar kümesi + dolu değerler içerir. */
for (const l of DILLER) {
  const eksik = d.missing(l);
  ok(`paket tam: ${l} (${d.keys(l).length} anahtar · eksik ${eksik.length})`, eksik.length === 0);
}
/* EN'in kendisi paket DEĞİLDİR: t() anahtarı kimlik olarak kullanır. */
ok('EN paketi yok (kimlik anahtar)', !d.keys('en') || d.keys('en').length === 0);

/* 2) Dil seçimi + TR çevirisi. */
ok('setLanguage tr', d.setLanguage('tr') === 'tr' && d.getLanguage() === 'tr');
ok('tr: kapatma uyarısı', d.t('Unsaved changes will be lost.') === 'Kaydetmediğin değişiklikler kaybolacak.');
ok('tr: kurtarma butonları', d.t('Return to last healthy save') === 'Son sağlıklı kayda dön');
ok('tr: diyalog başlığı', d.t('TailRef Studio is not responding') === 'TailRef Studio yanıt vermiyor');

/* 3) Interpolasyon. */
ok('tr: sürüm interpolasyonu',
  d.t('Unsupported .tail version ({n}).', { n: 2 }) === 'Desteklenmeyen .tail sürümü (2).');
ok('tr: yedek satırı',
  d.t('Items: {items} · Images: {images} · Size: {size}',
    { items: 3, images: 1, size: '1.2 MB' }) === 'Öğe: 3 · Görsel: 1 · Boyut: 1.2 MB');
ok('tr: arşiv yolu', d.t('Archive: {dir}', { dir: 'C:/x' }) === 'Arşiv: C:/x');
ok('bilinmeyen param anahtarına dokunulmaz', d.t('Archive: {dir}', { x: 1 }).includes('{dir}'));

/* 4) Bilinmeyen dil → EN kimlik düşüşü. */
ok('bilinmeyen dil EN', d.setLanguage('zz') === 'en');
ok('EN kimlik: Save image', d.t('Save image') === 'Save image');

/* 5) localeTag haritası (tarih/saat için). */
d.setLanguage('tr');  ok('localeTag tr-TR', d.localeTag() === 'tr-TR');
d.setLanguage('ja');  ok('localeTag ja-JP', d.localeTag() === 'ja-JP');
d.setLanguage('zh-CN'); ok('localeTag zh-CN', d.localeTag() === 'zh-CN');
d.setLanguage('en');  ok('localeTag en-US', d.localeTag() === 'en-US');

/* 6) Diğer dillerden örnek kontroller. */
d.setLanguage('de');  ok('de: canvas', d.t('canvas') === 'Leinwand');
d.setLanguage('ja');  ok('ja: temiz başlat', d.t('Clean start') === 'クリーンスタート');
d.setLanguage('ru');  ok('ru: port iletisi', d.t('Port {n} is already in use.\n\nTailRef may still be open in another user session or in the background.\nClose the remaining "TailRef Studio" process from Task Manager and try again.\n\n(We do not change the port: board data is tied to this recorded port.)', { n: 5178 }).startsWith('Порт 5178 уже занят.'));
d.setLanguage('pt-BR'); ok('pt-BR: vazgeç', d.t('Cancel') === 'Cancelar');
d.setLanguage('zh-CN'); ok('zh: board', d.t('Save board as .tail') === '将画板保存为 .tail');
d.setLanguage('ko');  ok('ko: kaydedilemedi', d.t('Could not save.') === '저장할 수 없습니다.');
d.setLanguage('es');  ok('es: klasör seç', d.t('Select this folder') === 'Elegir esta carpeta');
d.setLanguage('fr');  ok('fr: png filtresi', d.t('PNG image') === 'Image PNG');

console.log('TÜM TESTLER GEÇTİ (' + adet + '/' + adet + ')');
