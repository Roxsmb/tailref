'use strict';

/* =========================================================
   capture-docs.js — documentation screenshots and GIF clips
   ---------------------------------------------------------
   Launches the real app in an isolated profile, fills it with
   original demo artwork generated in the renderer, captures
   PNG screenshots and GIF frame sequences with CDP, and asks
   scripts/build-gif.py (Pillow) to assemble the clips.

   Everything is synthetic: no third-party artwork, no personal
   files, no network. The Pinterest/ArtStation panels are shown
   against a local fixture page and the fixture says so.

   Usage:
     node scripts/capture-docs.js
     node scripts/capture-docs.js --only=board,pose3d
     node scripts/capture-docs.js --keep

   Output: docs/screenshots/*.png and docs/screenshots/*.gif
   ========================================================= */

const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const TMP = path.join(os.tmpdir(), 'tailref-doc-capture');
const DEBUG_PORT = 9651;
const APP_PORT = 5551;
const FIXTURE_PORT = 5552;
const W = 1600;
const H = 900;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const onlyArg = process.argv.find(arg => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const keep = process.argv.includes('--keep');
const want = name => !only || only.has(name);

/* ---------------- CDP ---------------- */

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 60000);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text || 'evaluate failed';
    throw new Error(detail.split('\n')[0]);
  }
  return result.result.value;
}

async function waitFor(ws, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(ws, expression)) return true;
    } catch { /* retry */ }
    await sleep(350);
  }
  throw new Error('timeout waiting for ' + (label || expression));
}

async function capture(ws, file) {
  const result = await send(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  const bytes = fs.statSync(file).size;
  console.log('  PNG ' + path.basename(file) + '  ' + (bytes / 1024).toFixed(0) + ' KB');
  return bytes;
}

/* Screenshots are rendered at 2× and reduced here, so text and hairlines
   stay sharp instead of being captured at 1× and blurred. */
function shrinkPng(file, width) {
  execFileSync('python', [
    path.join(ROOT, 'scripts', 'shrink-png.py'),
    file,
    String(width || 1600),
  ], { stdio: 'inherit' });
}

async function captureDoc(ws, name) {
  const file = path.join(OUT, name);
  await capture(ws, file);
  shrinkPng(file, 1600);
  return file;
}



/* ---------------- page-side helpers ---------------- */

const PAGE_HELPERS = String.raw`
(() => {
  const D = window.__doc = {};
  const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  function grain(g, w, h, alpha, count) {
    for (let i = 0; i < count; i += 1) {
      const x = (i * 7919) % w;
      const y = (i * 104729) % h;
      g.fillStyle = 'rgba(20,14,8,' + (alpha * (0.25 + ((i * 37) % 100) / 200)).toFixed(3) + ')';
      g.fillRect(x, y, 1.3, 1.3);
    }
  }

  D.art = function art(kind, w, h) {
    w = w || 1200;
    h = h || 800;
    const c = make(w, h);
    const g = c.getContext('2d');

    if (kind === 'dusk') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#101a35');
      sky.addColorStop(0.42, '#3d3558');
      sky.addColorStop(0.68, '#a65e63');
      sky.addColorStop(0.85, '#e99c6b');
      sky.addColorStop(1, '#f7cb92');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      const sx = w * 0.68, sy = h * 0.55, sr = w * 0.07;
      const glow = g.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 2.6);
      glow.addColorStop(0, 'rgba(255,238,196,1)');
      glow.addColorStop(0.35, 'rgba(255,208,142,.75)');
      glow.addColorStop(1, 'rgba(255,180,120,0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(sx, sy, sr * 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe9b8';
      g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      const ridge = (base, amp, color, seed) => {
        g.beginPath();
        g.moveTo(0, h);
        g.lineTo(0, base);
        for (let x = 0; x <= w; x += 8) {
          const t = x / w;
          const y = base
            - Math.sin(t * Math.PI * (1.6 + seed * 0.4) + seed) * amp
            - Math.sin(t * Math.PI * 5.3 + seed * 2) * amp * 0.18;
          g.lineTo(x, y);
        }
        g.lineTo(w, h);
        g.closePath();
        g.fillStyle = color;
        g.fill();
      };
      ridge(h * 0.68, h * 0.10, 'rgba(48,44,78,.72)', 1);
      ridge(h * 0.77, h * 0.08, 'rgba(33,31,58,.85)', 2);
      ridge(h * 0.87, h * 0.05, 'rgba(17,17,33,.95)', 3);
      for (let i = 0; i < 24; i += 1) {
        g.fillStyle = 'rgba(255,208,150,' + Math.max(0, 0.20 - i * 0.006).toFixed(3) + ')';
        g.fillRect(w * 0.60 - i * 4, h * 0.90 + i * 3, w * 0.16 + i * 8, 1.4);
      }
    }

    if (kind === 'city') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#080d1e');
      sky.addColorStop(0.55, '#15203c');
      sky.addColorStop(1, '#2c3350');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      const moon = g.createRadialGradient(w * 0.78, h * 0.18, 4, w * 0.78, h * 0.18, w * 0.09);
      moon.addColorStop(0, 'rgba(255,244,214,.95)');
      moon.addColorStop(0.25, 'rgba(255,236,190,.55)');
      moon.addColorStop(1, 'rgba(255,230,180,0)');
      g.fillStyle = moon;
      g.beginPath(); g.arc(w * 0.78, h * 0.18, w * 0.09, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff3d2';
      g.beginPath(); g.arc(w * 0.78, h * 0.18, w * 0.026, 0, Math.PI * 2); g.fill();
      const heights = [0.22, 0.34, 0.27, 0.45, 0.31, 0.52, 0.25, 0.40, 0.33, 0.47, 0.29, 0.43];
      let x = -10, i = 0;
      while (x < w) {
        const bw = w * (0.045 + (i % 5) * 0.011);
        const bh = h * heights[i % heights.length];
        g.fillStyle = 'rgba(9,12,24,' + (0.86 + (i % 3) * 0.04).toFixed(2) + ')';
        g.fillRect(x, h - bh, bw, bh);
        g.fillStyle = 'rgba(255,203,120,.72)';
        for (let wy = h - bh + 10; wy < h - 12; wy += 16) {
          for (let wx = x + 7; wx < x + bw - 7; wx += 13) {
            if (((wx * 3 + wy * 7 + i * 11) % 23) < 8) g.fillRect(wx, wy, 3.4, 5.2);
          }
        }
        x += bw + w * 0.006;
        i += 1;
      }
      g.fillStyle = 'rgba(8,10,20,.55)';
      g.fillRect(0, h * 0.90, w, h * 0.10);
      for (let k = 0; k < 30; k += 1) {
        g.fillStyle = 'rgba(255,196,120,' + (0.05 + (k % 5) * 0.015).toFixed(3) + ')';
        g.fillRect((k * 53) % w, h * 0.90 + (k * 7) % (h * 0.09), 20 + (k % 4) * 12, 1.5);
      }
    }

    if (kind === 'bloom') {
      const bg = g.createRadialGradient(w * 0.5, h * 0.42, 10, w * 0.5, h * 0.5, w * 0.75);
      bg.addColorStop(0, '#1d3a34');
      bg.addColorStop(0.55, '#12241f');
      bg.addColorStop(1, '#0a1412');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      const stem = (x0, y0, x1, y1, bend) => {
        g.strokeStyle = '#3d7a5c';
        g.lineWidth = 7;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1);
        g.stroke();
      };
      stem(w * 0.44, h * 1.02, w * 0.52, h * 0.34, -w * 0.06);
      stem(w * 0.62, h * 1.02, w * 0.58, h * 0.52, w * 0.04);
      stem(w * 0.30, h * 1.02, w * 0.36, h * 0.58, w * 0.03);
      const leaf = (cx, cy, rx, ry, angle) => {
        g.save();
        g.translate(cx, cy);
        g.rotate(angle);
        g.fillStyle = '#2f6b4f';
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      };
      leaf(w * 0.38, h * 0.62, w * 0.075, h * 0.024, -0.5);
      leaf(w * 0.62, h * 0.72, w * 0.07, h * 0.022, 0.55);
      leaf(w * 0.48, h * 0.78, w * 0.065, h * 0.020, 0.2);
      const flower = (cx, cy, r) => {
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          g.save();
          g.translate(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
          g.rotate(a);
          g.fillStyle = k % 2 ? '#e4778f' : '#f08fa2';
          g.beginPath(); g.ellipse(0, 0, r * 0.72, r * 0.34, 0, 0, Math.PI * 2); g.fill();
          g.restore();
        }
        g.fillStyle = '#f2c45a';
        g.beginPath(); g.arc(cx, cy, r * 0.30, 0, Math.PI * 2); g.fill();
      };
      flower(w * 0.52, h * 0.30, w * 0.085);
      flower(w * 0.58, h * 0.52, w * 0.06);
      flower(w * 0.36, h * 0.56, w * 0.05);
    }

    if (kind === 'flow') {
      g.fillStyle = '#0a0c17';
      g.fillRect(0, 0, w, h);
      const colors = ['#ff6b6b', '#ffb86b', '#ffe66b', '#5ee6a8', '#5bb8ff', '#a78bfa'];
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (let i = 0; i < colors.length; i += 1) {
        g.strokeStyle = colors[i];
        g.globalAlpha = 0.62;
        g.lineWidth = w * (0.020 + i * 0.0035);
        g.beginPath();
        const y0 = h * (0.16 + i * 0.115);
        g.moveTo(-w * 0.05, y0);
        g.bezierCurveTo(
          w * 0.30, y0 - h * (0.10 + i * 0.012),
          w * 0.62, y0 + h * (0.16 - i * 0.010),
          w * 1.05, y0 - h * (0.04 + i * 0.008)
        );
        g.stroke();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    if (kind === 'palette') {
      g.fillStyle = '#14151d';
      g.fillRect(0, 0, w, h);
      const colors = [
        '#f4efe6', '#e8d9c3', '#d8b98f', '#b8895c',
        '#c8402f', '#e4778f', '#7c5cff', '#5bb8ff',
        '#2f6b4f', '#5ee6a8', '#f2c45a', '#2a2c38',
      ];
      const cols = 4, rows = 3;
      const pad = w * 0.06;
      const cw = (w - pad * 2) / cols;
      const ch = (h - pad * 2) / rows;
      for (let r = 0; r < rows; r += 1) {
        for (let cidx = 0; cidx < cols; cidx += 1) {
          const i = r * cols + cidx;
          g.fillStyle = colors[i];
          const x = pad + cidx * cw + 6;
          const y = pad + r * ch + 6;
          g.beginPath();
          if (g.roundRect) g.roundRect(x, y, cw - 12, ch - 12, 14);
          else g.rect(x, y, cw - 12, ch - 12);
          g.fill();
        }
      }
    }

    if (kind === 'paper') {
      g.fillStyle = '#f5efe3';
      g.fillRect(0, 0, w, h);
      grain(g, w, h, 0.05, 5200);
      const vignette = g.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.85);
      vignette.addColorStop(0, 'rgba(255,255,255,0)');
      vignette.addColorStop(1, 'rgba(120,98,66,.12)');
      g.fillStyle = vignette;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,100,70,.10)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, h * 0.82);
      g.lineTo(w, h * 0.82);
      g.stroke();
    }

    return c.toDataURL('image/png');
  };

  D.reset = function reset() {
    state.items = [];
    state.links = [];
    state.trash = [];
    state.groupParents = {};
    state.groupTitles = {};
    state.groupImportant = {};
    selection = new Set();
    selectionOrder = [];
    undoStack.length = 0;
    redoStack.length = 0;
    editingId = null;
    state.view = { x: 0, y: 0, scale: 1 };
    applyView();
    syncAll();
    return true;
  };

  D.image = async function image(dataUrl, name, x, y, w, h, rot) {
    /* CSP blocks fetch(data:) in the renderer; decode the base64 directly. */
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    await addFiles([new File([blob], name + '.png', { type: 'image/png' })],
      screenToWorld({ x: x + w / 2, y: y + h / 2 }));
    const it = state.items[state.items.length - 1];
    it.x = x;
    it.y = y;
    it.w = w;
    it.h = h;
    it.rot = rot || 0;
    selection = new Set();
    selectionOrder = [];
    syncAll();
    applyView();
    return it.id;
  };

  D.label = function label(text, x, y, size, color) {
    addText(screenToWorld({ x, y }));
    const it = state.items[state.items.length - 1];
    const t = elMap.get(it.id).querySelector('.text');
    t.textContent = text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    commitEdit();
    it.fontSize = size || 26;
    it.color = color || '#e9ecf5';
    it.bold = true;
    it.w = Math.max(220, text.length * (size || 26) * 0.74 + 56);
    it.h = Math.max(44, (size || 26) * 1.9);
    selection = new Set();
    selectionOrder = [];
    syncAll();
    applyView();
    return it.id;
  };

  D.clearSel = function clearSel() {
    selection = new Set();
    selectionOrder = [];
    syncSelection();
    return true;
  };

  D.inkReady = function inkReady() {
    const cv = document.getElementById('inkEditorCanvas');
    const fit = inkEditorComputeFit();
    D.cv = cv;
    D.fit = fit;
    return JSON.stringify({
      open: typeof inkEditorIsOpen === 'function' ? inkEditorIsOpen() : false,
      x: fit.x, y: fit.y, w: fit.w, h: fit.h,
    });
  };

  D.inkLayout = function inkLayout() {
    const st = inkWorkspaceUi.state;
    if (st) {
      st.panels = { layers: true, brush: true, color: false, history: false, advanced: false };
      st.swap = false;
      st.density = 'loose';
      st.layersWidth = 272;
      st.brushWidth = 304;
    }
    document.body.classList.remove('ink-brush-closed');
    const ref = document.getElementById('psReferencePanel');
    if (ref) ref.hidden = true;
    inkWorkspaceMoveDocks();
    inkWorkspaceApplyPanels(true);
    inkWorkspaceApplyLayout();
    if (typeof inkCloseColorWheel === 'function') inkCloseColorWheel();
    const tools = document.getElementById('inkToolbox');
    if (tools) tools.hidden = false;
    return true;
  };

  D.setBrush = function setBrush(size, color, opacity, hardness) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('inkSize', size);
    set('inkOpacity', opacity == null ? 100 : opacity);
    set('inkHardness', hardness == null ? 82 : hardness);
    /* The engine's stabiliser flattens deliberate peaks at its default 20%;
       screenshots are drawn programmatically, so keep raw input. */
    set('inkSmoothing', 0);
    if (color && typeof inkSetColor === 'function') inkSetColor(color, false);
    return true;
  };

  D.pen = function pen(type, nx, ny, pressure) {
    const f = D.fit;
    D.cv.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: 'pen',
      isPrimary: true,
      clientX: f.x + nx * f.w,
      clientY: f.y + ny * f.h,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : pressure,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
    }));
    return true;
  };

  /* Paint bucket: only works on image-linked layers, which is what the ink
     study is opened on. */
  D.fillAt = function fillAt(nx, ny, color) {
    if (color && typeof inkSetColor === 'function') inkSetColor(color, false);
    inkSetTool('fill');
    D.pen('pointerdown', nx, ny, 0.5);
    D.pen('pointerup', nx, ny, 0);
    inkSetTool('brush');
    return true;
  };

  D.fx = function fx(type) {
    const it = inkScopedImageItem();
    if (!it) return 'no-item';
    it.fx = { stack: [{ type: type, params: {}, opacity: 1, visible: true, blend: 'normal', seed: 20261120 }] };
    inkFxEnsure(it);
    inkFxInvalidate(it.id);
    inkSyncDom(it);
    inkEditorInvalidate();
    /* Bring the Effects tab of the right dock to the front. */
    const fxTab = document.querySelector('#v5RightDock .v5-layer-tab[data-tab="fx"]');
    if (fxTab) fxTab.click();
    inkSyncFxPanel();
    const section = document.getElementById('inkFxSection');
    if (section) { section.hidden = false; section.open = true; }
    return it.fx.stack.map(f => f.type).join(',');
  };

  D.fxBrowser = function fxBrowser(on) {
    if (typeof inkFxUi !== 'undefined') inkFxUi.browserOpen = !!on;
    inkSyncFxPanel();
    const section = document.getElementById('inkFxSection');
    if (section) {
      section.hidden = false;
      section.open = true;
      section.scrollIntoView({ block: 'nearest' });
    }
    return true;
  };

  D.pose3dPose = function pose3dPose() {
    const d = window.__pose3dDebug;
    if (!d) return 'not-ready';
    d.posing.resetTo('a-pose');
    const rot = (names, x, y, z) => {
      const bone = d.rig.findBone(names);
      if (!bone) return;
      bone.rotation.x += x || 0;
      bone.rotation.y += y || 0;
      bone.rotation.z += z || 0;
    };
    rot(['spine', 'mixamorigspine'], 0.02, 0.12, 0);
    rot(['chest', 'spine1', 'mixamorigspine1'], 0, 0.14, 0);
    rot(['neck', 'mixamorigneck'], 0, -0.12, 0);
    rot(['head', 'mixamorighead'], 0.04, -0.18, 0);
    d.posing.followBones();
    d.viewport.invalidate();
    return d.bones.length;
  };

  D.pose3dCam = function pose3dCam(az, radius, height, targetY) {
    const d = window.__pose3dDebug;
    d.controls.target.set(0, targetY == null ? 0.95 : targetY, 0);
    d.camera.position.set(Math.sin(az) * radius, height, Math.cos(az) * radius);
    d.controls.update();
    d.viewport.renderFrame();
    return true;
  };

  D.pose3dDamping = function pose3dDamping(on) {
    const d = window.__pose3dDebug;
    if (d && d.controls) d.controls.enableDamping = !!on;
    return true;
  };

  D.pose3dGuides = function pose3dGuides(mode) {
    const el = document.getElementById('poseGuidesMode');
    if (el) {
      el.value = mode;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  };

  D.theme = function theme(name) {
    themeSet('reference', name);
    return document.documentElement.dataset.theme || '';
  };

  D.settings = function settings(cat) {
    const el = document.getElementById('settings');
    /* openStudioPanel toggles, so only toggle when the hub is closed;
       repeated calls then just switch category. */
    if (el && el.hidden && typeof settingsHubToggle === 'function') settingsHubToggle();
    settingsNavSelect(cat || 'appearance');
    if (el) {
      el.style.left = '150px';
      el.style.top = '58px';
      el.style.width = '1300px';
      el.style.height = '790px';
      /* The hub normally floats with a translucent panel; for documentation
         shots it must sit above the docks and read as one opaque window. */
      el.style.zIndex = '50000';
      el.style.background = 'rgb(22,23,29)';
      el.style.backdropFilter = 'none';
    }
    return true;
  };

  D.closeSettings = function closeSettings() {
    if (typeof closeStudioPanel === 'function') closeStudioPanel(settingsEl);
    return true;
  };

  D.openPanel = function openPanel(which) {
    const panel = document.getElementById(which === 'pinterest' ? 'pinterestPanel' : 'artstationPanel');
    if (!panel) return 'no-panel';
    openStudioPanel(panel);
    if (which === 'pinterest' && typeof ensurePinterestView === 'function') ensurePinterestView();
    if (which === 'artstation' && typeof ensureArtStationView === 'function') ensureArtStationView();
    panel.style.left = '150px';
    panel.style.top = '70px';
    panel.style.width = '1300px';
    panel.style.height = '764px';
    panel.style.zIndex = '49000';
    panel.style.background = 'rgb(20,21,27)';
    return panel.hidden ? 'hidden' : 'open';
  };

  /* <webview> keeps the guest surface at the height it had on attach, so size
     it explicitly right before the shot, after the panel has laid out. */
  D.panelLayout = function panelLayout(which) {
    const panel = document.getElementById(which === 'pinterest' ? 'pinterestPanel' : 'artstationPanel');
    if (!panel) return 'no-panel';
    const body = panel.querySelector('.floatingPanelBody');
    const view = panel.querySelector('webview');
    if (!body || !view) return 'no-view';
    const others = Array.from(body.children).filter(child => child !== view);
    const used = others.reduce((sum, child) => sum + child.getBoundingClientRect().height + 8, 0);
    view.style.flex = '0 0 auto';
    view.style.height = Math.max(260, Math.floor(body.clientHeight - used)) + 'px';
    return JSON.stringify({ body: body.clientHeight, used: Math.round(used), h: view.style.height });
  };

  /* Keep the right dock on Layers for shots that are not about effects. */
  D.layersTab = function layersTab() {
    const tab = document.querySelector('#v5RightDock .v5-layer-tab[data-tab="layers"]');
    if (tab) tab.click();
    if (typeof inkFxUi !== 'undefined') inkFxUi.browserOpen = false;
    if (typeof inkSyncFxPanel === 'function') inkSyncFxPanel();
    return true;
  };

  D.closePanel = function closePanel(which) {
    const panel = document.getElementById(which === 'pinterest' ? 'pinterestPanel' : 'artstationPanel');
    if (panel && typeof closeStudioPanel === 'function') closeStudioPanel(panel);
    return true;
  };

  return true;
})();
`;

/* ---------------- demo fixture pages ---------------- */

let pinterestFixtureHtml = '<!doctype html><meta charset="utf-8"><title>Demo</title><p>loading</p>';
let artstationFixtureHtml = '<!doctype html><meta charset="utf-8"><title>Demo</title><p>loading</p>';

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = request.url || '/';
      const html = url.startsWith('/artstation') ? artstationFixtureHtml : pinterestFixtureHtml;
      const body = Buffer.from(html, 'utf8');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      response.end(body);
    });
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function fixtureCard(art, key, title, tag, height) {
  return '<figure class="card">'
    + '<img style="height:' + height + 'px" src="' + art[key] + '" alt="">'
    + '<figcaption class="cap"><b>' + title + '</b><span>' + tag + '</span></figcaption>'
    + '</figure>';
}

function makePinterestFixture(art) {
  const cards = [
    fixtureCard(art, 'dusk', 'Dusk ridge', 'study', 250),
    fixtureCard(art, 'bloom', 'Botanical', 'reference', 290),
    fixtureCard(art, 'city', 'Night city', 'moodboard', 210),
    fixtureCard(art, 'flow', 'Flow study', 'colour', 190),
    fixtureCard(art, 'palette', 'Palette 01', 'palette', 230),
    fixtureCard(art, 'dusk', 'Warm haze', 'study', 180),
    fixtureCard(art, 'bloom', 'Petal detail', 'texture', 240),
    fixtureCard(art, 'city', 'Skyline', 'silhouette', 260),
    fixtureCard(art, 'flow', 'Ribbon', 'shape', 200),
    fixtureCard(art, 'palette', 'Palette 02', 'palette', 220),
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>TailRef demo reference feed</title><style>'
    + ':root{color-scheme:dark}*{box-sizing:border-box}'
    + 'body{margin:0;background:#0e0f13;color:#e9e9f0;font:14px/1.45 system-ui,"Segoe UI",sans-serif}'
    + 'header{display:flex;align-items:center;gap:14px;padding:15px 26px;border-bottom:1px solid #22242d;'
    + 'position:sticky;top:0;background:#0e0f13;z-index:2}'
    + '.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#ff5a5f,#7c5cff);'
    + 'display:grid;place-items:center;font-weight:800;font-size:15px}'
    + 'h1{font-size:15px;margin:0;font-weight:600}'
    + '.pill{font-size:11px;padding:4px 10px;border-radius:999px;background:#1c1e27;color:#9aa0b4;'
    + 'border:1px solid #2a2d38}'
    + 'input{margin-left:auto;width:250px;background:#161821;border:1px solid #262936;color:#cfd3e1;'
    + 'border-radius:999px;padding:9px 15px;outline:none}'
    + '.masonry{columns:4;column-gap:16px;padding:22px 26px 60px}'
    + '.card{break-inside:avoid;margin:0 0 16px;border-radius:16px;overflow:hidden;background:#161821;'
    + 'border:1px solid #22242e}'
    + '.card img{width:100%;display:block;object-fit:cover}'
    + '.cap{padding:10px 12px;font-size:12px;color:#9aa0b4;display:flex;justify-content:space-between;gap:8px}'
    + '.cap b{color:#d8dbea;font-weight:600}'
    + '</style></head><body>'
    + '<header><div class="logo">T</div><h1>Reference feed</h1>'
    + '<span class="pill">local demo fixture</span><input placeholder="Search references"></header>'
    + '<div class="masonry">' + cards.join('') + '</div></body></html>';
}

function makeArtStationFixture(art) {
  const cards = [
    fixtureCard(art, 'dusk', 'Dusk ridge', 'environment', 230),
    fixtureCard(art, 'bloom', 'Botanical', 'illustration', 230),
    fixtureCard(art, 'city', 'Night city', 'concept', 230),
    fixtureCard(art, 'flow', 'Flow study', 'abstract', 230),
    fixtureCard(art, 'palette', 'Palette 01', 'colour key', 230),
    fixtureCard(art, 'paper', 'Paper texture', 'material', 230),
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>TailRef demo project</title><style>'
    + ':root{color-scheme:dark}*{box-sizing:border-box}'
    + 'body{margin:0;background:#101014;color:#e9e9f0;font:14px/1.45 system-ui,"Segoe UI",sans-serif}'
    + 'header{display:flex;align-items:center;gap:14px;padding:15px 28px;border-bottom:1px solid #23252e;'
    + 'position:sticky;top:0;background:#101014;z-index:2}'
    + '.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#13a8ff,#7c5cff);'
    + 'display:grid;place-items:center;font-weight:800;font-size:15px}'
    + 'h1{font-size:15px;margin:0;font-weight:600}'
    + '.pill{font-size:11px;padding:4px 10px;border-radius:999px;background:#1c1e27;color:#9aa0b4;'
    + 'border:1px solid #2a2d38}'
    + '.hero{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;padding:26px 28px 8px}'
    + '.hero img{width:100%;height:300px;object-fit:cover;border-radius:18px;display:block}'
    + '.hero h2{margin:8px 0 6px;font-size:26px;line-height:1.2}'
    + '.hero p{margin:0;color:#9aa0b4;max-width:36ch}'
    + '.tag{display:inline-block;margin:12px 8px 0 0;font-size:12px;padding:5px 10px;border-radius:999px;'
    + 'background:#1a1c25;border:1px solid #292c38;color:#c9cee0}'
    + '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:20px 28px 60px}'
    + '.card{margin:0;border-radius:16px;overflow:hidden;background:#161821;border:1px solid #22242e}'
    + '.card img{width:100%;display:block;object-fit:cover}'
    + '.cap{padding:10px 12px;font-size:12px;color:#9aa0b4;display:flex;justify-content:space-between;gap:8px}'
    + '.cap b{color:#d8dbea;font-weight:600}'
    + '</style></head><body>'
    + '<header><div class="logo">A</div><h1>ArtStation</h1>'
    + '<span class="pill">local demo fixture</span></header>'
    + '<section class="hero"><img src="' + art.dusk + '" alt="">'
    + '<div><h2>Night City — visual development</h2>'
    + '<p>A demo project page served locally so the panel can be documented '
    + 'without redistributing third-party artwork.</p>'
    + '<span class="tag">environment</span><span class="tag">colour script</span>'
    + '<span class="tag">TailRef demo</span></div></section>'
    + '<div class="grid">' + cards.join('') + '</div></body></html>';
}

/* ---------------- app ---------------- */

function electronPath() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('electron not found (npm install)');
  return found;
}

function launch(userDataDir) {
  const env = {
    ...process.env,
    TailRef_USER_DATA: userDataDir,
    TailRef_PORT: String(APP_PORT),
    TailRef_TEST_SCREEN: process.env.TailRef_TEST_SCREEN || '3',
    TailRef_PINTEREST_URL: 'http://127.0.0.1:' + FIXTURE_PORT + '/',
    TailRef_ARTSTATION_URL: 'http://127.0.0.1:' + FIXTURE_PORT + '/artstation',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath(), [
    '.',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--no-sandbox',
  ], { cwd: ROOT, env, stdio: 'ignore' });
}

async function attach() {
  let page = null;
  const started = Date.now();
  while (Date.now() - started < 45000 && !page) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json')).json();
      page = list.find(target => target.type === 'page' && target.url.includes(':' + APP_PORT));
    } catch { /* not ready */ }
    if (!page) await sleep(400);
  }
  if (!page) throw new Error('debug port did not open');
  const ws = await connect(page.webSocketDebuggerUrl);
  await send(ws, 'Page.enable', {});
  await waitFor(ws,
    "typeof state !== 'undefined' && typeof stage !== 'undefined' && !!stage.clientWidth",
    45000, 'renderer');
  return ws;
}

async function closeWelcome(ws) {
  /* The dialog is shown a moment after the first paint; wait for it so a
     fast check cannot "close" it before it exists. */
  const deadline = Date.now() + 12000;
  let seen = false;
  while (Date.now() < deadline) {
    const visible = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      return !!(w && !w.hidden);
    })()`);
    if (visible) { seen = true; break; }
    await sleep(300);
  }
  if (!seen) return;

  for (let i = 0; i < 40; i += 1) {
    const done = await evaluate(ws, `(() => {
      const w = document.getElementById('persistenceWelcome');
      if (!w || w.hidden) return true;
      if (!document.querySelector('.pwOption.is-selected')) {
        document.querySelector('.pwOption[data-mode="auto"]')?.click();
      }
      const b = document.getElementById('pwContinue');
      if (b && !b.disabled) b.click();
      return !!w.hidden;
    })()`);
    if (done) return;
    await sleep(300);
  }
  throw new Error('welcome dialog did not close');
}

/* ---------------- clips ---------------- */

function qbez(p0, p1, p2, count) {
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const e = t * t * (3 - 2 * t);
    const x = (1 - e) * (1 - e) * p0[0] + 2 * (1 - e) * e * p1[0] + e * e * p2[0];
    const y = (1 - e) * (1 - e) * p0[1] + 2 * (1 - e) * e * p1[1] + e * e * p2[1];
    const pressure = Math.max(0.12, 0.18 + 0.74 * Math.sin(Math.PI * t));
    points.push([x, y, pressure]);
  }
  return points;
}

function circlePoints(cx, cy, radius, count) {
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    points.push([
      cx + Math.cos(a) * radius,
      cy + Math.sin(a) * radius,
      0.30 + 0.38 * Math.abs(Math.sin(a * 2)),
    ]);
  }
  return points;
}

/* Catmull-Rom through the control points: smooth, predictable curves that
   read as deliberate drawing rather than random scribbles. */
function catmull(ctrl, per) {
  const out = [];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < P.length - 2; i += 1) {
    const a = P[i - 1];
    const b = P[i];
    const c = P[i + 1];
    const d = P[i + 2];
    for (let s = 0; s < per; s += 1) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * b[0] + (-a[0] + c[0]) * t
          + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2
          + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3),
        0.5 * (2 * b[1] + (-a[1] + c[1]) * t
          + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2
          + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3),
      ]);
    }
  }
  out.push(ctrl[ctrl.length - 1].slice());
  return out;
}

/* A tiny wobble keeps long lines from looking machine-ruled. */
function wobble(points, amp, seed) {
  return points.map((p, i) => [
    p[0] + Math.sin(i * 0.63 + seed) * amp * 0.4,
    p[1] + Math.sin(i * 0.47 + seed * 2.1) * amp,
  ]);
}

/* Pressure profile → the engine turns it into a tapered brush line.
   Returns the sampled [x, y, pressure] triplets the pointer API expects. */
function inkStroke(points, size, color, taper) {
  const n = Math.max(2, points.length);
  return points.map((p, i) => {
    const t = i / (n - 1);
    let pressure;
    if (taper === 'even') pressure = 0.70;
    else if (taper === 'start') pressure = 0.88 - 0.46 * t;
    else if (taper === 'end') pressure = 0.34 + 0.52 * t;
    else if (taper === 'leaf') pressure = 0.95 - 0.78 * t;
    else pressure = 0.24 + 0.62 * Math.sin(Math.PI * Math.min(1, t * 0.94 + 0.03));
    return [p[0], p[1], Math.max(0.12, Math.min(1, pressure))];
  });
}

/* Screen-print style landscape: every shape is a closed outline drawn with
   the brush, then filled with the paint bucket in the same colour. Flat
   colour blocks read instantly and look designed, which line work at this
   size does not. */
function posterOps() {
  const ink = '#1b1826';
  const ops = [];

  const stroke = (points, size, color, taper) =>
    ops.push({ kind: 'outline', color, size, points: inkStroke(points, size, color, taper) });

  /* Botanical ink study: a single stem with alternating leaves. Smooth,
     tapered curves are what the brush renders best, and the subject stays
     readable at the size the workspace is shown. */
  const stemCtrl = [
    [0.295, 0.975], [0.315, 0.870], [0.360, 0.780], [0.425, 0.700],
    [0.480, 0.610], [0.545, 0.525], [0.600, 0.430], [0.665, 0.345],
    [0.712, 0.250], [0.748, 0.150],
  ];
  const stem = catmull(stemCtrl, 9);
  stroke(stem, 24, ink, 'start');

  const at = t => {
    const i = Math.min(stem.length - 2, Math.max(0, Math.round(t * (stem.length - 1))));
    const p = stem[i];
    const q = stem[i + 1];
    return { p, a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
  };

  const leaf = (bx, by, angle, len, wid, size) => {
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const px = -ay;
    const py = ax;
    const pts = [];
    const N = 24;
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      const u = t * len;
      const w = wid * Math.pow(Math.sin(Math.PI * t), 0.8);
      pts.push([bx + ax * u + px * w, by + ay * u + py * w]);
    }
    for (let i = N - 1; i >= 1; i -= 1) {
      const t = i / N;
      const u = t * len;
      const w = wid * Math.pow(Math.sin(Math.PI * t), 0.8);
      pts.push([bx + ax * u - px * w, by + ay * u - py * w]);
    }
    pts.push(pts[0].slice());
    stroke(pts, size, ink, 'even');
    /* central vein */
    const v0 = [bx + ax * len * 0.06, by + ay * len * 0.06];
    const v1 = [bx + ax * len * 0.92, by + ay * len * 0.92];
    stroke([v0, v1], Math.max(4, Math.round(size * 0.42)), ink, 'leaf');
  };

  const leaves = [
    [0.13, -1, 0.215, 0.052],
    [0.25, 1, 0.240, 0.058],
    [0.38, -1, 0.210, 0.050],
    [0.51, 1, 0.225, 0.054],
    [0.63, -1, 0.185, 0.045],
    [0.74, 1, 0.165, 0.040],
    [0.85, -1, 0.130, 0.032],
  ];
  for (const [t, side, len, wid] of leaves) {
    const { p, a } = at(t);
    /* Leaves leave the stem at roughly 55°, alternating sides. */
    leaf(p[0], p[1], a + side * 0.96 - 0.18, len * 1.25, wid * 1.25, 15);
  }

  /* Terminal bud. */
  const tip = at(0.985);
  leaf(tip.p[0], tip.p[1], tip.a - 0.10, 0.115, 0.026, 12);

  return ops;
}

async function drawStroke(ws, stroke) {
  await evaluate(ws, `__doc.setBrush(${stroke.size}, ${JSON.stringify(stroke.color)})`);
  const points = stroke.points;
  await evaluate(ws, `__doc.pen('pointerdown', ${points[0][0]}, ${points[0][1]}, ${points[0][2]})`);
  /* Points go in small batches: one round trip per batch keeps the drawing
     quick while still letting the engine see every sample. */
  for (let i = 1; i < points.length; i += 6) {
    const batch = points.slice(i, i + 6);
    const list = batch
      .map(p => `[${p[0].toFixed(5)}, ${p[1].toFixed(5)}, ${p[2].toFixed(3)}]`)
      .join(',');
    await evaluate(ws, `(() => { for (const p of [${list}]) __doc.pen('pointermove', p[0], p[1], p[2]); return true; })()`);
  }
  const last = points[points.length - 1];
  await evaluate(ws, `__doc.pen('pointerup', ${last[0]}, ${last[1]}, 0)`);
  await sleep(60);
}

async function captureBoard(ws, art) {
  console.log('board');
  await evaluate(ws, '__doc.reset()');
  const items = [
    ['dusk', 'Dusk ridge', 112, 126, 356, 237, -2.0],
    ['city', 'Night city', 506, 96, 300, 200, 1.6],
    ['bloom', 'Botanical', 844, 148, 246, 246, -1.2],
    ['flow', 'Flow study', 1108, 120, 222, 148, 2.0],
    ['palette', 'Palette 01', 300, 470, 320, 213, 1.0],
    ['paper', 'Paper texture', 686, 472, 300, 200, -1.4],
  ];
  for (const [key, name, x, y, w, h, rot] of items) {
    await evaluate(ws, `__doc.image(${JSON.stringify(art[key])}, ${JSON.stringify(name)}, ${x}, ${y}, ${w}, ${h}, ${rot})`);
  }
  await evaluate(ws, `__doc.label('NIGHT CITY', 1048, 486, 34, '#e9ecf5')`);
  await evaluate(ws, `__doc.label('colour + texture study', 1048, 552, 20, '#9aa3b8')`);
  await evaluate(ws, '__doc.clearSel()');
  await sleep(700);
  await captureDoc(ws, 'board.png');
}

async function prepareInk(ws, art) {
  const id = await evaluate(ws, `__doc.image(${JSON.stringify(art.paper)}, 'ink study', 620, 300, 1600, 1000, 0)`);
  await evaluate(ws, `modeEnterDraw(${JSON.stringify(id)})`);
  await sleep(1400);
  const ready = JSON.parse(await evaluate(ws, '__doc.inkReady()'));
  if (!ready.open) throw new Error('ink editor did not open');

  await evaluate(ws, '__doc.inkLayout()');
  await sleep(700);
  return id;
}

async function drawInk(ws) {
  for (const op of posterOps()) {
    if (op.kind === 'fill') {
      await evaluate(ws, `__doc.fillAt(${op.at[0]}, ${op.at[1]}, ${JSON.stringify(op.color)})`);
      await sleep(120);
      continue;
    }
    await drawStroke(ws, op);
  }
  await sleep(500);
}

async function captureInk(ws) {
  console.log('ink');
  await evaluate(ws, '__doc.inkLayout()');
  /* Leave the toolbox on a realistic brush state; the last drawn stroke is a
     tiny bird, which would otherwise show as "9 px". */
  await evaluate(ws, `__doc.setBrush(44, '#1b1826')`);
  await sleep(600);
  await captureDoc(ws, 'ink.png');
}

async function captureFx(ws) {
  console.log('fx');
  await evaluate(ws, '__doc.inkLayout()');
  await sleep(400);
  const applied = await evaluate(ws, `__doc.fx('watercolor')`);
  if (applied === 'no-item') throw new Error('no scoped image for FX');
  await sleep(1500);
  await evaluate(ws, '__doc.fxBrowser(true)');
  await sleep(700);
  await captureDoc(ws, 'fx.png');
}

async function capturePose3d(ws) {
  console.log('pose3d');
  await evaluate(ws, 'modeEnter3d()');
  await waitFor(ws, 'window.__pose3dReady === true', 45000, 'pose3d ready');
  await sleep(1600);
  await evaluate(ws, '__doc.pose3dPose()');
  await evaluate(ws, `__doc.pose3dGuides('thirds')`);
  await evaluate(ws, '__doc.pose3dCam(-0.58, 3.35, 1.62, 0.96)');
  await sleep(700);
  await captureDoc(ws, 'pose3d.png');
}

async function captureThemes(ws) {
  console.log('themes');
  await evaluate(ws, 'modeExit3d({ toReference: true })');
  await sleep(1000);
  await evaluate(ws, '__doc.layersTab()');
  await evaluate(ws, `__doc.settings('appearance')`);
  await sleep(1000);
  await captureDoc(ws, 'themes.png');
}

/* One screenshot per settings page worth documenting. The hub stays open;
   __doc.settings() only switches category after the first call. */
async function captureSettings(ws) {
  await evaluate(ws, '__doc.layersTab()');
  const pages = [
    ['drawing', 'settings-drawing.png'],
    ['interface', 'settings-interface.png'],
    ['performance', 'settings-performance.png'],
    ['storage', 'settings-storage.png'],
    ['about', 'settings-about.png'],
    ['shortcuts', 'settings-shortcuts.png'],
  ];
  for (const [cat, file] of pages) {
    console.log(file);
    await evaluate(ws, `__doc.settings(${JSON.stringify(cat)})`);
    await sleep(900);
    await captureDoc(ws, file);
  }
}

async function capturePanels(ws, art) {
  console.log('panels');
  pinterestFixtureHtml = makePinterestFixture(art);
  artstationFixtureHtml = makeArtStationFixture(art);
  await evaluate(ws, '__doc.closeSettings()');
  await sleep(500);

  const opened = await evaluate(ws, `__doc.openPanel('pinterest')`);
  if (opened !== 'open') throw new Error('pinterest panel did not open: ' + opened);
  await sleep(5500);
  console.log('  layout ' + await evaluate(ws, `__doc.panelLayout('pinterest')`));
  await sleep(700);
  await captureDoc(ws, 'pinterest.png');
  await evaluate(ws, `__doc.closePanel('pinterest')`);
  await sleep(800);

  const openedArt = await evaluate(ws, `__doc.openPanel('artstation')`);
  if (openedArt !== 'open') throw new Error('artstation panel did not open: ' + openedArt);
  await sleep(5500);
  console.log('  layout ' + await evaluate(ws, `__doc.panelLayout('artstation')`));
  await sleep(700);
  await captureDoc(ws, 'artstation.png');
  await evaluate(ws, `__doc.closePanel('artstation')`);
  await sleep(400);
}

/* ---------------- main ---------------- */

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailref-docs-'));
  const fixture = await startFixtureServer();
  const app = launch(userDataDir);
  let ws = null;

  try {
    ws = await attach();
    await closeWelcome(ws);
    await send(ws, 'Emulation.setDeviceMetricsOverride', {
      width: W,
      height: H,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await sleep(1200);
    await closeWelcome(ws);
    await sleep(400);
    await evaluate(ws, PAGE_HELPERS);

    const art = JSON.parse(await evaluate(ws, `JSON.stringify({
      dusk: __doc.art('dusk'),
      city: __doc.art('city'),
      bloom: __doc.art('bloom'),
      flow: __doc.art('flow'),
      palette: __doc.art('palette'),
      paper: __doc.art('paper')
    })`));

    if (want('board')) await captureBoard(ws, art);

    const needInk = want('ink') || want('fx');
    if (needInk) {
      await prepareInk(ws, art);
      await drawInk(ws);
      if (want('ink')) await captureInk(ws);
      if (want('fx')) await captureFx(ws);
    }

    /* The 3D clip comes from a real screen recording (scripts/pose-video.py).
       The CDP fallback only runs when explicitly asked for. */
    if (only ? want('pose3d') : process.env.TailRef_CAPTURE_POSE3D === '1') {
      await capturePose3d(ws);
    }
    if (want('themes')) await captureThemes(ws);
    if (want('settings')) await captureSettings(ws);
    if (want('pinterest') || want('artstation')) await capturePanels(ws, art);

    console.log('\nDONE · ' + OUT);
  } finally {
    try { ws && ws.close(); } catch { /* silent */ }
    try { app.kill(); } catch { /* silent */ }
    try { fixture.close(); } catch { /* silent */ }
    await sleep(1200);
    if (!keep) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* silent */ }
      try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* silent */ }
    } else {
      console.log('kept: ' + userDataDir + '\nkept: ' + TMP);
    }
  }
})().catch(error => {
  console.error('\nCAPTURE FAILED: ' + (error.stack || error.message));
  process.exitCode = 1;
});
