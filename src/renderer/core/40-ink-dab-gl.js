/* TailRef app — WebGL2 damla önizleme motoru
   ------------------------------------------------------------------
   Çizim modunda canlı vuruş önizlemesi iki arka uçla üretilir:

     GPU (WebGL2) : görsel katmanı bir kez dokuya yüklenir, damlalar
                    bir FBO üzerinde biriktirilir. Her karede yalnızca
                    YENİ damlalar çizilir → maliyet O(yeni damla).
     CPU (2B)     : WebGL2 yoksa aynı artımlı mantık kalıcı bir 2B
                    tuval üzerinde çalışır (piksel paritesi referansı).

   Pişirme (pointerup) her zaman mevcut 2B yolu kullanır; belge modeli,
   geri alma ve dışa aktarma değişmez. Bu modül yalnızca SUNUMU hızlandırır.

   Önizleme tuvali ekran çözünürlüğündedir: görselin yalnızca EKRANDA
   GÖRÜNEN parçası × DPR. Böylece her karede katman boyutunda (örn. 4K)
   tampon kopyalanmaz; GPU'da yalnızca görünen kutu işlenir. */

'use strict';

/* Önizleme tuvalinin üst sınırı (piksel). Önizleme görünür kutuyla
   sınırlandığı için normalde ekran boyutunda kalır; bu sayı yalnızca
   güvenlik ağıdır. Çok büyük önizleme tuvallerinde WebGL tuvalini 2B
   tuvale basan `drawImage` bazı sürücülerde sessizce boş sonuç veriyor
   (bkz. INK_PERFORMANCE.md · yüksek yakınlaştırma). */
const INK_DAB_GL_MAX_PIXELS = 67108864;   // 2^26

const inkDabGl = {
  tried: false,
  ok: false,
  disabled: false,
  canvas: null,
  gl: null,
  prog: null,
  buf: null,
  fbo: null,
  accTex: null,
  baseTex: null,
  loc: { pos: -1, uv: -1, tex: null, alpha: null },
  textures: new Map(),
  texCount: 0,
  texLimit: 12,
  layerW: 0,
  layerH: 0,
  gw: 0,
  gh: 0,
  dpr: 1,
  view: null,
  drawn: 0,
  dabs: 0,
  frames: 0,
  lastMs: 0,
  maxTex: 0,
  vbuf: new Float32Array(16),
  blend: 0,
};

/* ---------------------------------------------------------
   kurulum
   --------------------------------------------------------- */
function inkDabGlSetup() {
  const s = inkDabGl;
  if (s.tried) return s.ok;
  s.tried = true;
  if (s.disabled) return false;
  if (typeof WebGL2RenderingContext === 'undefined') return false;

  let canvas = null;
  let gl = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Kanvas yalnızca aynı görev içinde drawImage ile okunur; tampon
      // korumaya gerek yok (korumak her karede tam kopya demekti).
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
  } catch {
    gl = null;
  }
  if (!gl) return false;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[ink-gl] shader derlenemedi:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vsSrc = [
    '#version 300 es',
    'in vec2 aPos;',
    'in vec2 aUV;',
    'out vec2 vUV;',
    'void main(){ vUV = aUV; gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');
  const fsSrc = [
    '#version 300 es',
    'precision mediump float;',
    'in vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform float uAlpha;',
    'out vec4 outColor;',
    'void main(){ outColor = texture(uTex, vUV) * uAlpha; }',
  ].join('\n');

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return false;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[ink-gl] program link failed: ', gl.getProgramInfoLog(prog));
    return false;
  }

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    tex: gl.getUniformLocation(prog, 'uTex'),
    alpha: gl.getUniformLocation(prog, 'uAlpha'),
  };
  if (loc.pos < 0 || loc.uv < 0) return false;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, s.vbuf.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(loc.uv);
  gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 16, 8);

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    s.ok = false;
    s.accTex = null;
    s.fbo = null;
    s.baseTex = null;
    // Bağlam öldüğü için deleteTexture anlamsız; yalnızca defteri temizle.
    s.textures.clear();
    s.texCount = 0;
  });

  s.canvas = canvas;
  s.gl = gl;
  s.prog = prog;
  s.buf = buf;
  s.loc = loc;
  s.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  s.blend = 0;
  s.ok = true;
  return true;
}

/* ---------------------------------------------------------
   yardımcılar
   --------------------------------------------------------- */
function inkDabGlMul(m, t) {
  // m · t  (Canvas2D `translate/rotate/scale` semantiği: sonraki soldan değil,
  // mevcut dönüşümün sağına eklenir).
  return [
    m[0] * t[0] + m[2] * t[1],
    m[1] * t[0] + m[3] * t[1],
    m[0] * t[2] + m[2] * t[3],
    m[1] * t[2] + m[3] * t[3],
    m[0] * t[4] + m[2] * t[5] + m[4],
    m[1] * t[4] + m[3] * t[5] + m[5],
  ];
}

/** Görsel tuvalini (damga ucu, katman) GL dokusuna çevirir; önbellekli. */
function inkDabGlTextureFor(image) {
  const s = inkDabGl;
  if (!image) return null;
  const cached = s.textures.get(image);
  if (cached) {
    // LRU: son kullanılanı sona taşı (Map ekleme sırası).
    s.textures.delete(image);
    s.textures.set(image, cached);
    return cached;
  }
  const gl = s.gl;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  } catch {
    gl.deleteTexture(tex);
    return null;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  s.textures.set(image, tex);
  s.texCount++;
  // GPU bellek sınırı: en eski uç dokusunu bırak. WeakMap anahtarı GC'ye
  // bırakıyordu ama GL dokusu hiç silinmiyordu (vuruş başına sızıntı).
  while (s.textures.size > s.texLimit) {
    const oldest = s.textures.keys().next().value;
    const old = s.textures.get(oldest);
    s.textures.delete(oldest);
    try { gl.deleteTexture(old); } catch { /* bağlam kaybı */ }
    s.texCount = Math.max(0, s.texCount - 1);
  }
  return tex;
}

/** Önbellekteki tüm uç dokularını serbest bırakır (disable / bağlam kaybı). */
function inkDabGlPurgeTextures() {
  const s = inkDabGl;
  const gl = s.gl;
  if (gl) {
    for (const tex of s.textures.values()) {
      try { gl.deleteTexture(tex); } catch { /* bağlam kaybı */ }
    }
  }
  s.textures.clear();
  s.texCount = 0;
}

/** GL piksel uzayında (0..gw, 0..gh) dörtgen yazar; doku aralığı verilebilir. */
function inkDabGlQuadUV(x0, y0, x1, y1, u0, v0, u1, v1) {
  const s = inkDabGl;
  const gl = s.gl;
  const w = s.gw || s.canvas.width;
  const h = s.gh || s.canvas.height;
  const cx0 = (x0 / w) * 2 - 1;
  const cx1 = (x1 / w) * 2 - 1;
  const cy0 = 1 - (y0 / h) * 2;
  const cy1 = 1 - (y1 / h) * 2;
  const v = s.vbuf;
  v[0] = cx0; v[1] = cy0; v[2] = u0; v[3] = v0;
  v[4] = cx1; v[5] = cy0; v[6] = u1; v[7] = v0;
  v[8] = cx0; v[9] = cy1; v[10] = u0; v[11] = v1;
  v[12] = cx1; v[13] = cy1; v[14] = u1; v[15] = v1;
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** GL piksel uzayında (0..gw, 0..gh) dörtgen yazar (tam doku). */
function inkDabGlQuadRaw(x0, y0, x1, y1) {
  inkDabGlQuadUV(x0, y0, x1, y1, 0, 0, 1, 1);
}

/** Dönüşüm matrisli damla dörtgeni. */
function inkDabGlEmit(m, dx, dy, dw, dh, alpha) {
  const s = inkDabGl;
  const gl = s.gl;
  const w = s.gw;
  const h = s.gh;
  const px = (x, y) => {
    const gx = m[0] * x + m[2] * y + m[4];
    const gy = m[1] * x + m[3] * y + m[5];
    return [(gx / w) * 2 - 1, 1 - (gy / h) * 2];
  };
  const a = px(dx, dy);
  const b = px(dx + dw, dy);
  const c = px(dx, dy + dh);
  const d = px(dx + dw, dy + dh);
  const v = s.vbuf;
  v[0] = a[0]; v[1] = a[1]; v[2] = 0; v[3] = 0;
  v[4] = b[0]; v[5] = b[1]; v[6] = 1; v[7] = 0;
  v[8] = c[0]; v[9] = c[1]; v[10] = 0; v[11] = 1;
  v[12] = d[0]; v[13] = d[1]; v[14] = 1; v[15] = 1;
  gl.uniform1f(s.loc.alpha, alpha);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ---------------------------------------------------------
   başlat / bitir
   --------------------------------------------------------- */
/**
 * Önizleme oturumu açar: katmanı dokuya yükler, FBO'yu katman kopyasıyla
 * doldurur.
 *
 * `view` yalnızca GÖRÜNÜR kutu kadardır (görsel kutusunun ekranla
 * kesişimi), `fx/fy/fw/fh` ise görselin tamamının ekrandaki kutusudur.
 * Yakınlaştırınca görsel kutusu ekrandan çok daha büyük olur; önizlemeyi
 * tam kutu boyutunda ayırmak yüz milyonlarca piksellik bir tuval
 * istiyordu ve bu boyutta `drawImage` sessizce boş sonuç verip katmanın
 * tamamı vuruş boyunca kayboluyordu. Görünür kutu ile önizleme daima
 * ekran çözünürlüğünde kalır.
 *
 * @param {HTMLCanvasElement} layerCanvas
 * @param {{x:number,y:number,w:number,h:number,fx:number,fy:number,fw:number,fh:number}} view
 * @param {number} dpr
 */
function inkDabGlBegin(layerCanvas, view, dpr) {
  const s = inkDabGl;
  if (!layerCanvas || !layerCanvas.width || !layerCanvas.height) return false;
  if (!view || !(view.w > 0.5) || !(view.h > 0.5)) return false;
  // `fx/fy/fw/fh` verilmezse görünüm kutunun tamamı sayılır (eski imza).
  const fx = Number.isFinite(view.fx) ? view.fx : view.x;
  const fy = Number.isFinite(view.fy) ? view.fy : view.y;
  const fw = Number.isFinite(view.fw) ? view.fw : view.w;
  const fh = Number.isFinite(view.fh) ? view.fh : view.h;
  if (!(fw > 0.5) || !(fh > 0.5)) return false;
  if (!inkDabGlSetup()) return false;
  const gl = s.gl;
  if (!gl || (gl.isContextLost && gl.isContextLost())) return false;

  const scale = Math.max(1, Math.min(3, Number(dpr) || 1));
  const gw = Math.max(1, Math.round(view.w * scale));
  const gh = Math.max(1, Math.round(view.h * scale));
  if (gw > s.maxTex || gh > s.maxTex) return false;
  if (gw * gh > INK_DAB_GL_MAX_PIXELS) return false;

  // Önizlemenin kapladığı katman aralığı (0..1).
  const u0 = clamp((view.x - fx) / fw, 0, 1);
  const v0 = clamp((view.y - fy) / fh, 0, 1);
  const uw = clamp(view.w / fw, 0, 1);
  const vh = clamp(view.h / fh, 0, 1);
  if (!(uw > 0) || !(vh > 0)) return false;

  if (s.canvas.width !== gw || s.canvas.height !== gh) {
    s.canvas.width = gw;
    s.canvas.height = gh;
  }
  s.gw = gw;
  s.gh = gh;
  s.dpr = scale;
  s.view = {
    x: view.x, y: view.y, w: view.w, h: view.h,
    fx, fy, fw, fh,
  };
  s.layerW = layerCanvas.width;
  s.layerH = layerCanvas.height;

  gl.useProgram(s.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(s.loc.tex, 0);

  // Görsel katmanı → doku
  if (!s.baseTex) s.baseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, s.baseTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layerCanvas);
  } catch {
    return false;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Biriktirme hedefi
  if (!s.accTex) s.accTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, s.accTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  if (!s.fbo) s.fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.accTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return false;
  }

  gl.viewport(0, 0, gw, gh);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Katman kopyasının görünür parçasını hedefe bas.
  gl.bindTexture(gl.TEXTURE_2D, s.baseTex);
  gl.uniform1f(s.loc.alpha, 1);
  inkDabGlQuadUV(0, 0, gw, gh, u0, v0, u0 + uw, v0 + vh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  s.drawn = 0;
  s.blend = 0;
  return true;
}

/** Açık önizlemenin verilen görünümle eşleşip eşleşmediği. */
function inkDabGlMatches(view, dpr) {
  const s = inkDabGl;
  if (!s.ok || !s.view || !view) return false;
  const scale = Math.max(1, Math.min(3, Number(dpr) || 1));
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const fx = Number.isFinite(view.fx) ? view.fx : view.x;
  const fy = Number.isFinite(view.fy) ? view.fy : view.y;
  const fw = Number.isFinite(view.fw) ? view.fw : view.w;
  const fh = Number.isFinite(view.fh) ? view.fh : view.h;
  return s.dpr === scale &&
    near(s.view.x, view.x) && near(s.view.y, view.y) &&
    near(s.view.w, view.w) && near(s.view.h, view.h) &&
    near(s.view.fx || 0, fx) && near(s.view.fy || 0, fy) &&
    near(s.view.fw || 0, fw) && near(s.view.fh || 0, fh);
}

/**
 * Vuruşun yeni damlalarını GPU'da biriktirir.
 * `inkDrawStrokeOnContext` aynen çalışır; ctx yerine bir "sink" alır.
 */
function inkDabGlApply(stroke, opts) {
  const s = inkDabGl;
  if (!s.ok || !stroke || !opts) return false;
  const gl = s.gl;
  if (!gl || (gl.isContextLost && gl.isContextLost())) return false;

  // Katman pikseli → önizleme pikseli. Önizleme görselin yalnızca görünür
  // parçasını kapladığı için ölçeğe ek olarak bir öteleme de gerekir.
  const view = s.view || { x: 0, y: 0, w: s.gw, h: s.gh, fx: 0, fy: 0, fw: s.gw, fh: s.gh };
  const uw = clamp(view.w / Math.max(0.001, view.fw), 0.0001, 1);
  const vh = clamp(view.h / Math.max(0.001, view.fh), 0.0001, 1);
  const u0 = clamp((view.x - view.fx) / Math.max(0.001, view.fw), 0, 1);
  const v0 = clamp((view.y - view.fy) / Math.max(0.001, view.fh), 0, 1);
  const sx = s.gw / (uw * Math.max(1, s.layerW));
  const sy = s.gh / (vh * Math.max(1, s.layerH));
  const sink = inkDabGlSink([
    sx, 0, 0, sy,
    -u0 * s.layerW * sx,
    -v0 * s.layerH * sy,
  ]);
  const t0 = performance.now();

  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
  gl.viewport(0, 0, s.gw, s.gh);
  gl.useProgram(s.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(s.loc.tex, 0);
  gl.enable(gl.BLEND);

  try {
    if (typeof inkDrawStrokeOnContext !== 'function') return false;
    inkDrawStrokeOnContext(sink, stroke, opts);
  } catch (error) {
    console.warn('[ink-gl] dab draw failed: ', error);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return false;
  }

  const added = Math.max(0, sink.count - s.drawn);
  s.drawn = sink.count;
  s.dabs += added;
  s.frames++;
  s.lastMs = performance.now() - t0;
  if (typeof inkPerfSpan === 'function') inkPerfSpan('glPreview', s.lastMs);
  if (typeof inkPerfCount === 'function') inkPerfCount('glDabs', added);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return true;
}

/** Biriktirilen dokuyu kanvasa basar (drawImage öncesi, aynı görevde). */
function inkDabGlPresent() {
  const s = inkDabGl;
  if (!s.ok || !s.accTex) return false;
  const gl = s.gl;
  const w = s.canvas.width;
  const h = s.canvas.height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.useProgram(s.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.accTex);
  gl.uniform1i(s.loc.tex, 0);
  gl.uniform1f(s.loc.alpha, 1);
  // FBO dokusunun 0. satırı GL'de ALT satırdır; kanvasta ise 0. satır ÜST.
  // Bu yüzden sunumda dikey UV çevrilir (aksi halde önizleme ters görünür).
  const v = s.vbuf;
  v[0] = -1; v[1] = 1; v[2] = 0; v[3] = 1;
  v[4] = 1; v[5] = 1; v[6] = 1; v[7] = 1;
  v[8] = -1; v[9] = -1; v[10] = 0; v[11] = 0;
  v[12] = 1; v[13] = -1; v[14] = 1; v[15] = 0;
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function inkDabGlCanvas() {
  return inkDabGl.canvas;
}

/** Oturumu kapatır; dokuları ve tamponu serbest bırakır. */
function inkDabGlRelease() {
  const s = inkDabGl;
  const gl = s.gl;
  if (gl) {
    if (s.accTex) gl.deleteTexture(s.accTex);
    if (s.baseTex) gl.deleteTexture(s.baseTex);
    if (s.fbo) gl.deleteFramebuffer(s.fbo);
  }
  s.accTex = null;
  s.baseTex = null;
  s.fbo = null;
  // Uç dokuları önbellekte kalır: her vuruşta yeniden yüklememek için.
  // Bellek sınırı `texLimit` LRU'su ve `disable()` temizliğiyle korunur.
  s.drawn = 0;
  s.layerW = 0;
  s.layerH = 0;
  s.view = null;
  s.blend = 0;
  if (s.canvas) {
    s.canvas.width = 1;
    s.canvas.height = 1;
    s.gw = 1;
    s.gh = 1;
  }
  return true;
}

/* ---------------------------------------------------------
   ctx benzeri "sink"ler
   --------------------------------------------------------- */
/**
 * WebGL2 sink'i: Canvas2D `inkDrawStrokeOnContext` çağrılarını GPU
 * dörtgenlerine çevirir. Daha önce çizilmiş damlalar (indeks < drawn)
 * atlanır → her karede yalnızca yeni damlalar işlenir.
 */
function inkDabGlSink(baseMatrix) {
  const s = inkDabGl;
  const gl = s.gl;
  return {
    count: 0,
    _m: baseMatrix ? baseMatrix.slice() : [1, 0, 0, 1, 0, 0],
    _stack: [],
    _alpha: 1,
    _comp: 'source-over',

    get globalAlpha() { return this._alpha; },
    set globalAlpha(value) {
      const n = Number(value);
      this._alpha = Number.isFinite(n) ? clamp(n, 0, 1) : 1;
    },
    get globalCompositeOperation() { return this._comp; },
    set globalCompositeOperation(value) {
      this._comp = value || 'source-over';
    },

    save() {
      this._stack.push({ m: this._m.slice(), a: this._alpha, c: this._comp });
    },
    restore() {
      const prev = this._stack.pop();
      if (!prev) return;
      this._m = prev.m;
      this._alpha = prev.a;
      this._comp = prev.c;
    },
    translate(x, y) { this._m = inkDabGlMul(this._m, [1, 0, 0, 1, x, y]); },
    rotate(angle) {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      this._m = inkDabGlMul(this._m, [c, sn, -sn, c, 0, 0]);
    },
    scale(x, y) { this._m = inkDabGlMul(this._m, [x, 0, 0, y, 0, 0]); },

    drawImage(image, dx, dy, dw, dh) {
      const index = this.count++;
      if (index < s.drawn) return;
      if (!image) return;
      const w = dw === undefined ? image.width : dw;
      const h = dh === undefined ? image.height : dh;
      if (!(w > 0) || !(h > 0)) return;

      const erase = this._comp === 'destination-out';
      const blend = erase ? 2 : 1;
      if (blend !== s.blend) {
        if (erase) gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        s.blend = blend;
      }

      const tex = inkDabGlTextureFor(image);
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      inkDabGlEmit(this._m, dx, dy, w, h, this._alpha);
    },
  };
}

/**
 * 2B yedek sink'i: gerçek CanvasRenderingContext2D'ye devreder, ancak
 * `skip` indeksine kadar olan damlaları atlar. Böylece WebGL2 yoksa da
 * her karede tüm vuruş yeniden çizilmez.
 */
function inkDabSink2d(ctx) {
  return {
    // Yalnızca geçiş sayacı; gerçek damla indeksi `inkDrawStrokeOnContext`
    // tarafından döndürülür (tek damla birden çok damga çizebilir).
    count: 0,
    get globalAlpha() { return ctx.globalAlpha; },
    set globalAlpha(value) { ctx.globalAlpha = value; },
    get globalCompositeOperation() { return ctx.globalCompositeOperation; },
    set globalCompositeOperation(value) { ctx.globalCompositeOperation = value; },
    save() { ctx.save(); },
    restore() { ctx.restore(); },
    translate(x, y) { ctx.translate(x, y); },
    rotate(angle) { ctx.rotate(angle); },
    scale(x, y) { ctx.scale(x, y); },
    drawImage(image, dx, dy, dw, dh) {
      this.count++;
      if (dw === undefined) ctx.drawImage(image, dx, dy);
      else ctx.drawImage(image, dx, dy, dw, dh);
    },
  };
}

/* ---------------------------------------------------------
   köprü (HUD / bench / testler)
   --------------------------------------------------------- */
function inkDabGlStats() {
  const s = inkDabGl;
  return {
    supported: !!s.ok,
    disabled: !!s.disabled,
    textures: s.texCount,
    dabs: s.dabs,
    frames: s.frames,
    lastMs: Math.round(s.lastMs * 100) / 100,
    layerW: s.layerW,
    layerH: s.layerH,
    width: s.gw,
    height: s.gh,
    maxTex: s.maxTex,
  };
}

window.__inkGl = {
  stats: inkDabGlStats,
  supported: () => inkDabGlSetup(),
  release: inkDabGlRelease,
  present: inkDabGlPresent,
  disable() {
    inkDabGl.disabled = true;
    inkDabGlRelease();
    inkDabGlPurgeTextures();
    inkDabGl.ok = false;
    return false;
  },
  enable() {
    inkDabGl.disabled = false;
    inkDabGl.tried = false;
    inkDabGl.ok = false;
    return inkDabGlSetup();
  },
};
