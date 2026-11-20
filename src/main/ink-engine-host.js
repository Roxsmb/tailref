/* =========================================================
   ink-engine-host.js - C++ çekirdek ev sahibi (ana süreç)
   =========================================================
   .node eklentisi sandbox'lı renderer'a giremez; bu ev sahibi
   ana süreçte yüklenir, kanalları açar ve piksel işini yürütür.
   Kanallar:
     ink-engine:tip    (kind, px, a, b, c, d) -> { ok, data, stat }
     ink-engine:dabs   (points, ...)          -> { ok, count, data }
     ink-engine:tiles  (src, srcW, srcH, slices) -> { ok, count, data }
     ink-engine:status ()                      -> { ok, kind, error }
   Etki kapsamı: uç üretimi (gürültü, sulu boya) + EVRE 2 damla
   aritmetiği (dabList: Catmull-Rom + sigmoid basınç + carry emisyon)
   + EVRE 4 undo karo dilimleri (tileSlice: saf byte band kopyası). */

'use strict';
const fs = require('fs');
const path = require('path');
const { MessageChannelMain } = require('electron');

/* Yükleme hassas nokta: .node dosyası asar dışında yaşamak
   zorundadır (asarUnpack). Geliştirme modunda düz yol, pakette
   app.asar.unpacked eşleniği kullanılır. */
let core = null;
let loadError = null;

function resolveNode() {
  const direct = path.join(__dirname, '..', '..', 'native', 'inkcore',
    'build', 'Release', 'inkcore.node');
  if (fs.existsSync(direct)) return direct;
  /* Paket modu: bu dosya app.asar içinden koşar. */
  const unpacked = direct.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return null;
}

function tryLoad() {
  if (core || loadError) return Boolean(core);
  const node = resolveNode();
  if (!node) {
    loadError = 'inkcore.node bulunamadı';
    return false;
  }
  try {
    core = require(node);
    return true;
  } catch (error) {
    core = null;
    loadError = String(error && error.message || error);
    return false;
  }
}

const KINDS = ['noiseTip', 'watercolorTip'];

/* =========================================================
   EVRE 5.1 - transferable yan kanal (MessagePortMain)
   ---------------------------------------------------------
   ipcRenderer.invoke her çağrıda tamponları İKİ YÖNLÜ yapısal
   klonlar; 1.3 MB'lık undo bölgesinde bu 30 ms'ye çıkar
   (tests/ink-tilespeed-check.js sonda bulgusu). MessagePort
   taşıma listesiyle ArrayBuffer'ları KOPYASIZ transfer eder:
   renderer→çekirdek→renderer tampon yerinde kalır.

   Protokol: { id, fn:'tileSlice', w, h, src(transfer),
               slices(transfer) } → { id, ok, count,
               data(transfer) | error }
   Ölü oturum temizliği: 'close' mesajı + istek zaman aşımı yok
   (tek istek; hizmet cevaplamazsa foıreign güzel düşüş yoksa
   calling JS yolu yedektir). ========================================== */
const portSessions = new Set();

function onPortRequest(port, event) {
  let msg = event.data;
  if (!msg || msg.id === undefined) return;
  if (msg.fn === 'bye') {
    port.close();
    return;
  }
  if (msg.fn === 'tileSlice') {
    try {
      if (!core) throw new Error(loadError || 'çekirdek yok');
      const { w, h, src, slices, id } = msg;
      const wOk = Number.isFinite(w) && Number.isFinite(h) &&
        Math.trunc(w) > 0 && Math.trunc(w) <= 8192 &&
        Math.trunc(h) > 0 && Math.trunc(h) <= 8192;
      const srcOk = src && src.length != null &&
        src.length >= Math.trunc(w) * Math.trunc(h) * 4;
      const slOk = slices && slices.length % 4 === 0 && slices.length / 4 <= 4096;
      if (!wOk || !srcOk || !slOk) {
        port.postMessage({ id, ok: false, error: 'argüman aralik disi' });
        return;
      }
      const result = core.tileSlice(src, Math.trunc(w), Math.trunc(h), slices);
      /* data tamponu transfer listesinde gider — kopya yok. */
      port.postMessage(
        { id, ok: true, count: result.count, data: result.data },
        [result.data.buffer]);
    } catch (error) {
      try {
        port.postMessage({ id: msg.id, ok: false,
          error: String(error && error.message || error) });
      } catch { /* port kapandıysa sessiz */ }
    }
    return;
  }
  port.postMessage({ id: msg.id, ok: false, error: 'bilinmeyen iş' });
}

function register(ipcMain) {
  ipcMain.on('ink-engine:port-open', (event) => {
    /* DÜZELTME (boş ekran sorunu): bu kanal süs yoludur — invoke yedeği
       her durumda çalışır. Buradaki herhangi bir hata ana süreci
       DÜŞÜRMEMELİ; eskiden try/catsizdi ve MessageChannelMain eksik
       import edildiğinde uygulama tamamen boş ekran kaldı. */
    try {
      const { port1: service, port2: client } = new MessageChannelMain();
      portSessions.add(service);
      service.on('message', (e) => onPortRequest(service, e));
      service.on('close', () => { portSessions.delete(service); });
      service.start();
      try {
        event.sender.postMessage('ink-engine:port-open-reply', null, [client]);
      } catch {
        service.close();
        portSessions.delete(service);
      }
    } catch {
      /* port açılamadı: renderer invoke yedeğine düşer, sessiz devam. */
    }
  });

  ipcMain.handle('ink-engine:status', () => {
    const ok = tryLoad();
    return {
      ok,
      kind: ok ? 'cpp' : 'js',
      error: loadError,
    };
  });

  ipcMain.handle('ink-engine:tip', (_e, kind, a, b, c, d, f) => {
    if (!tryLoad()) return { ok: false, error: loadError };
    if (!KINDS.includes(kind)) return { ok: false, error: 'bilinmeyen iş' };
    /* numbers: [px, ...] - a=px, diğer dört sayı işe göre. */
    const nums = [a, b, c, d, f].map(Number);
    if (nums.some(n => !Number.isFinite(n))) {
      return { ok: false, error: 'sayı değil' };
    }
    const size = Math.trunc(nums[0]);
    if (!(size > 0) || size > 1024) {
      return { ok: false, error: 'boyut aralık dışı' };
    }
    try {
      const result = kind === 'noiseTip'
        ? core.noiseTip(size, nums[1], nums[2], nums[3], nums[4])
        : core.watercolorTip(size, nums[1], nums[2], nums[3], nums[4]);
      return { ok: true, fn: kind, stat: result.stat, data: result.data };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });

  /* EVRE 2: damla emisyonu. Aktarımlar: points(Float64Array, stride 7:
     x,y,p,s,t,a,br — p/s/t/a yoksa NaN, br 0/1), spacing, sx, sy,
     stableOnly, jitter, taperStart, taperEnd, progressOffset,
     totalLength (NaN = yok), strokeId.
     Cevap: { ok, count, data: Float64Array stride 9
     (x,y,k,p,s,t,a,br,tilted) }. JS emisyondaki "yok" alanlar NaN
     olarak döner — tüketiciya üretim sırasında yeniden aynen taşınır. */
  ipcMain.handle('ink-engine:dabs', (
    _e, points, spacing, sx, sy, stableOnly, jitter, taperStart,
    taperEnd, progressOffset, totalLength, strokeId) => {
    if (!tryLoad()) return { ok: false, error: loadError };
    const flen = points && points.length != null ? points.length : -1;
    if (!(flen >= 7) || flen % 7 !== 0) {
      return { ok: false, error: 'nokta tamponu stride 7 olmalı' };
    }
    const n = flen / 7;
    if (n > 200000) return { ok: false, error: 'nokta sınırı aşıldı' };
    /* totalLength bilinçli NaN olabilir (yok sayım); diğerleri sayı olmalı. */
    const guard = [spacing, sx, sy, stableOnly, jitter, taperStart,
      taperEnd, progressOffset];
    if (guard.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      return { ok: false, error: 'sayı değil' };
    }
    if (typeof totalLength !== 'number') {
      return { ok: false, error: 'totalLength sayı değil' };
    }
    if (typeof strokeId !== 'string' || strokeId.length > 512) {
      return { ok: false, error: 'strokeId aralık dışı' };
    }
    try {
      const result = core.dabList(points, spacing, sx, sy,
        stableOnly ? 1 : 0, jitter, taperStart, taperEnd, progressOffset,
        totalLength, strokeId);
      return { ok: true, count: result.count, data: result.data };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  /* EVRE 4: undo karo dilimleri. src: Uint8ClampedArray bölge RGBA
     (satır adımı srcW*4), slices: Int32Array stride 4 relX,relY,w,h
     (karo kutularının bölgeye göre konumu). Cevap: { ok, count,
     data: Uint8Array } — dilim sırasıyla BİTİŞİK: karo başına
     w*h*4 bayt, satır-bazlı. JS bunu dilim başına görünümle keser. */
  ipcMain.handle('ink-engine:tiles', (_e, src, srcW, srcH, slices) => {
    if (!tryLoad()) return { ok: false, error: loadError };
    if (typeof srcW !== 'number' || !Number.isFinite(srcW) ||
        typeof srcH !== 'number' || !Number.isFinite(srcH)) {
      return { ok: false, error: 'sayı değil' };
    }
    const w = Math.trunc(srcW), h = Math.trunc(srcH);
    if (w <= 0 || h <= 0 || w > 8192 || h > 8192) {
      return { ok: false, error: 'bölge boyutu aralık dışı' };
    }
    const slen = src && src.length != null ? src.length : -1;
    if (slen < w * h * 4 || slen % 4 !== 0) {
      return { ok: false, error: 'bölge tamponu kisa' };
    }
    const ilen = slices && slices.length != null ? slices.length : -1;
    if (!(ilen >= 4) || ilen % 4 !== 0) {
      return { ok: false, error: 'dilim tamponu stride 4 olmalı' };
    }
    if (ilen / 4 > 4096) return { ok: false, error: 'dilim sınırı aşıldı' };
    try {
      const result = core.tileSlice(src, w, h, slices);
      return { ok: true, count: result.count, data: result.data };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
}

module.exports = { register };
