'use strict';
/* ======================================================================
   TailRef kapısı — preload MessagePort zaman aşımı (saf Node + vm)
   ======================================================================
   Gerçek src/preload/preload.js kaynağı, Electron API'leri stub'lanmış bir
   vm bağlamında çalıştırılır. Test edilen kod preload'un kendisidir;
   stub'lar yalnız platform sınırıdır (Electron olmadan koşan saf kapı).

   Kapsam:
   1) Port açılınca tileSlice isteği transfer listesiyle gönderilir.
   2) Yanıt gelirse istek çözülür ve zamanlayıcı temizlenir.
   3) Yanıt gelmezse zaman aşımı isteği hata olarak çözer (asılı kalmaz),
      port kapatılır ve sonraki çağrı invoke yedeğine düşer.
   ====================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
}

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');

function boot() {
  const listeners = new Map();
  const sent = [];
  const invokes = [];
  const timers = [];
  const cleared = [];
  let api = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } },
    ipcRenderer: {
      send: (channel) => sent.push(channel),
      on: (channel, fn) => {
        const list = listeners.get(channel) || [];
        list.push(fn);
        listeners.set(channel, list);
      },
      invoke: (...args) => { invokes.push(args); return Promise.resolve({ ok: false, fallback: true }); },
    },
    webFrame: { setZoomFactor() {}, getZoomFactor() { return 1; } },
    webUtils: {},
  };
  const sandbox = {
    require: (name) => {
      if (name !== 'electron') throw new Error('beklenmeyen require: ' + name);
      return electron;
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, id: timers.length + 1 });
      return timers.length;
    },
    clearTimeout: (id) => { cleared.push(id); },
    console: { warn() {}, error() {}, log() {} },
  };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'preload.js' });
  return { api, listeners, sent, invokes, timers, cleared };
}

function fakePort() {
  return {
    sent: [],
    closed: false,
    onmessage: null,
    postMessage(msg, transfer) { this.sent.push({ msg, transfer }); },
    close() { this.closed = true; },
  };
}

function openPort(env) {
  const port = fakePort();
  const handler = (env.listeners.get('ink-engine:port-open-reply') || [])[0];
  check('preload: port-open isteği gönderilir', env.sent.includes('ink-engine:port-open'));
  check('preload: port-open yanıt dinleyicisi bağlanır', typeof handler === 'function');
  if (handler) handler({ ports: [port] });
  return port;
}

(async () => {
  try {
    /* --- 1+2) Yanıt gelen istek --------------------------------------- */
    {
      const env = boot();
      check('preload: tailref köprüsü açılır', !!(env.api && typeof env.api.enginePortTiles === 'function'));
      const port = openPort(env);
      const src = new Uint8ClampedArray(4);
      const slices = new Int32Array([0, 0, 1, 1]);
      const pending = env.api.enginePortTiles(src, 1, 1, slices);
      const wire = port.sent[0];
      check('preload: tileSlice port üzerinden gider', !!wire && wire.msg.fn === 'tileSlice' && wire.msg.w === 1);
      check('preload: tamponlar transfer listesinde', Array.isArray(wire && wire.transfer) && wire.transfer.length === 2);
      const timer = env.timers[0];
      check('preload: istek zamanlayıcısı kurulur', !!timer && timer.ms >= 1000, timer ? timer.ms + ' ms' : 'yok');
      if (port.onmessage) {
        port.onmessage({ data: { id: wire.msg.id, ok: true, count: 4, data: new Uint8Array([9, 9, 9, 9]) } });
      }
      const reply = await pending;
      check('preload: port yanıtı isteği çözer', reply.ok === true && reply.count === 4);
      check('preload: yanıtta zamanlayıcı temizlenir', timer && env.cleared.includes(timer.id));
    }

    /* --- 3) Yanıt gelmeyen istek -------------------------------------- */
    {
      const env = boot();
      const port = openPort(env);
      const pending = env.api.enginePortTiles(new Uint8ClampedArray(4), 1, 1, new Int32Array([0, 0, 1, 1]));
      const timer = env.timers[0];
      check('preload: asılı istek için zamanlayıcı var', !!timer);
      if (timer) timer.fn();
      const reply = await pending;
      check('preload: zaman aşımı isteği çözer (asılı kalmaz)', reply.ok === false && reply.timeout === true);
      check('preload: zaman aşımında port kapatılır', port.closed === true);
      const fallback = await env.api.enginePortTiles(new Uint8ClampedArray(4), 1, 1, new Int32Array([0, 0, 1, 1]));
      check('preload: sonraki istek invoke yedeğine düşer',
        fallback.fallback === true && env.invokes.length === 1 && env.invokes[0][0] === 'ink-engine:tiles');
    }
  } catch (e) {
    console.error('TEST HATASI:', e.stack || e.message);
    fail += 1;
  }

  console.log(`\n${fail === 0 ? 'TÜM TESTLER GEÇTİ' : fail + ' TEST BAŞARISIZ'} (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
