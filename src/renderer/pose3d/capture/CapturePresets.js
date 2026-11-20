/* Capture ölçekleri, boyut presetleri, pass ve arka plan tanımları.
   Saf yardımcılar: DOM/WebGL bilmez, test edilebilir. */

export const SCALE_OPTIONS = [1, 2, 4];

export const SIZE_PRESETS = {
  '4k': { label: '4K', width: 3840, height: 2160 },
  '8k': { label: '8K', width: 7680, height: 4320 },
};

export const CAPTURE_PASSES = [
  { id: 'beauty', label: 'Beauty', hint: 'Tone-mapped final frame' },
  { id: 'alpha', label: 'Alpha', hint: 'Black silhouette, transparent background' },
  { id: 'depth', label: 'Depth', hint: '8-bit gray depth' },
  { id: 'normal', label: 'Normal', hint: 'Surface normals' },
  { id: 'wireframe', label: 'Wire', hint: 'Wireframe' },
];

export const PASS_IDS = CAPTURE_PASSES.map(pass => pass.id);

export const BACKGROUNDS = ['scene', 'transparent', 'white'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* İstenen ölçek/preset/boyutu somut piksel boyutuna çevirir.
   base: 1x kabul edilen kaynak boyut (tuvalin çizim tamponu).
   maxTexture: renderer.capabilities.maxTextureSize — aşılırsa oran korunarak küçültülür. */
export function resolveSize(request = {}, base = {}, maxTexture = 4096) {
  const baseWidth = Math.max(16, Math.round(Number(base.width) || 380));
  const baseHeight = Math.max(16, Math.round(Number(base.height) || 232));
  const preset = SIZE_PRESETS[request.preset] ? request.preset : null;

  let width;
  let height;
  let scale = null;

  if (preset) {
    width = SIZE_PRESETS[preset].width;
    height = SIZE_PRESETS[preset].height;
  } else {
    scale = clamp(Number(request.scale) || 1, 0.1, 8);
    width = Math.round(baseWidth * scale);
    height = Math.round(baseHeight * scale);
  }

  /* Elle verilen boyut (önizleme gibi) preset/ölçeği geçersiz kılar. */
  const customWidth = Number(request.width);
  const customHeight = Number(request.height);
  if (customWidth >= 16 && customHeight >= 16) {
    width = Math.round(customWidth);
    height = Math.round(customHeight);
  }

  const limit = Math.max(256, Math.round(Number(maxTexture) || 4096));
  let clamped = false;
  if (width > limit || height > limit) {
    const factor = limit / Math.max(width, height);
    width = Math.floor(width * factor);
    height = Math.floor(height * factor);
    clamped = true;
  }

  width = Math.max(16, Math.round(width));
  height = Math.max(16, Math.round(height));

  return { width, height, preset, scale, clamped, limit, base: { width: baseWidth, height: baseHeight } };
}

/* RGBA render target tahmini: 8 bit/kanal. */
export function estimateBytes(width, height) {
  return Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4;
}

export function formatBytes(bytes) {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function describeSize(size) {
  if (!size) return '';
  return `${size.width} × ${size.height} · RGBA ≈${formatBytes(estimateBytes(size.width, size.height))} · PNG`;
}

/* 8K RGBA ≈ 127 MB: GPU belleği uyarısı. Diğer boyutlar yalnızca bilgi satırı. */
export function memoryWarning(size) {
  if (!size) return null;
  const bytes = estimateBytes(size.width, size.height);
  if (size.preset === '8k' || bytes >= 96 * 1024 * 1024) {
    return {
      level: 'danger',
      text: `8K ≈ ${formatBytes(bytes)} RGBA. Capture may slow down and stress GPU memory.`,
    };
  }
  return null;
}
