/* 3D gezinme şeması — saf yardımcı (three.js gerektirmez, birim test edilir).

   İki endüstri alışkanlığı desteklenir:

   maya (endüstri standardı, varsayılan)
     Alt + sol    → orbit
     Alt + orta   → pan
     Alt + sağ    → dolly (zoom)
     Düz sol/sağ basış serbest kalır (seçim, gizmo, bağlam menüsü).

   blender
     Orta         → orbit
     Shift + orta → pan
     Ctrl + orta  → dolly (zoom)
     Sol/sağ basış serbest kalır.

   Her iki şemada tekerlek zoom yapar (OrbitControls varsayılanı). */

export const POSE_NAV_STORAGE_KEY = 'tailref-pose3d-nav';
export const POSE_NAV_PRESETS = ['maya', 'blender'];

/** Bilinmeyen/boş değer endüstri standardına (maya) düşer. */
export function normalizeNavPreset(value) {
  return value === 'blender' ? 'blender' : 'maya';
}

/**
 * Basış anındaki değiştirici tuşlara göre fare düğmesi eşlemesi.
 * Dönüş: { LEFT, MIDDLE, RIGHT } — her biri 'ROTATE' | 'PAN' | 'DOLLY' | null.
 */
export function navMouseMap(preset, mods = {}) {
  const alt = !!mods.alt;
  const ctrl = !!mods.ctrl;
  if (normalizeNavPreset(preset) === 'blender') {
    /* Shift'e DOKUNMA: OrbitControls, ROTATE eyleminde Shift/Ctrl gördüğünde
       kendisi PAN'a geçiyor. Burada Shift'i PAN'a çevirirsek OrbitControls
       PAN + Shift'i tekrar ROTATE'e çevirir (Shift+orta ters çalışıyordu).
       Ctrl'ü biz DOLLY'ye alıyoruz; yoksa o da PAN'a düşerdi. */
    return {
      LEFT: null,
      MIDDLE: ctrl ? 'DOLLY' : 'ROTATE',
      RIGHT: null,
    };
  }
  return {
    LEFT: alt ? 'ROTATE' : null,
    MIDDLE: alt ? 'PAN' : null,
    RIGHT: alt ? 'DOLLY' : null,
  };
}

/** Kısa insan-okur özet (toast/yardım metni). */
export function navPresetHint(preset) {
  return normalizeNavPreset(preset) === 'blender'
    ? 'Blender: middle = orbit · Shift + middle = pan · Ctrl + middle = zoom'
    : 'Industry standard: Alt + left = orbit · Alt + middle = pan · Alt + right = zoom';
}
