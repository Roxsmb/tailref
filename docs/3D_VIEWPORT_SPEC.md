# TailRef Studio — 3D Viewport Yenileme Spesifikasyonu

> Sürüm: taslak 1 · 27.10.2026 (uygulama durumu: 28.10.2026)
> Kapsam: `pose3d.js` (312 satır, tek dosya) → Liquid Glass HUD + profesyonel kamera,
> pozlama, ışık ve yakalama (capture) altyapısı.
> Hedef sürüm: **1.2.0** — 3D motoru + capture suite birlikte tamamlandı (P0–P6).

---

## 0. Ön not: stack uyuşmazlığı

Talep edilen mimari başlığı "**Modular Python / PySide**" diyor; bu depo **Electron +
three.js (r160)** üzerine kurulu. Bu belge, aynı kavramsal modülleri (`ViewportWidget`,
`PosingController`, `CameraManager`, `RenderExporter`) **JavaScript ES modülleri**
olarak tanımlar; PySide/Qt karşılıkları Ek-C'de bire bir eşlenmiştir.

- Bu depoda Python yok → PySide'a geçiş **yeni bir ürün** demektir, refactor değil.
- Qt'ye taşınacaksa `webview`/IndexedDB/Pinterest entegrasyonu da yeniden yazılır.
- Karar: **mevcut stack'te kalınır**, modülerlik `src/renderer/pose3d/` altında sağlanır.

---

## 1. Mevcut durum (baz çizgi)

`pose3d.js` içindeki sorumluluklar (hepsi tek dosyada):

| Blok | Satır | Sorun |
|---|---|---|
| Renderer / tonemap / outline | 23–29 | ACES sabit, exposure 1.65 sabit kodlu |
| Gökyüzü gradient (CanvasTexture) | 30–50 | HDRI yok, döndürülemez |
| Kamera + OrbitControls + Maya mouse | 51–70 | Tek kamera, preset yok, lens yok |
| Işık rigi (7 ışık, sabit) | 71–78 | 3-point kontrol yok, sıcaklık yok |
| Grid | 78 | Shadow catcher yok |
| Toon + outline sistemi | 92–176 | Material slot seçimi yok |
| `installCharacter()` | 177–233 | Rig tespiti isim listesine gömülü; A/T-pose ayrımı yok |
| Controller küreleri | 202–231 | Erişilebilirlik/ölçek yok, tıklama hedefi çok küçük |
| `solveIK()` | 235–279 | Sadece 2–3 kemikli zincir; undo yok |
| Gizmo / klavye | 285–289 | Sadece rotate/translate; scale yok |
| Screenshot | 290 | `toDataURL`, 1x, pass yok, alpha yok |
| Panel aç/kapa/boyut | 291–295 | Liquid Glass yok, otomatik gizleme yok |

**Kritik teknik borç:** `pose3d.js` global `window` dinleyicileri + `app.js` global
kısayolları çakışıyor (F, 1, W/E/R, X/Y/Z). Yeni mimaride tuş kapsamı (scope)
zorunlu.

---

## 2. UI Layout Specification

### 2.1 Panel anatomisi

```
┌──────────────────────────────────────────────────────────┐  ← glass shell (radius 16)
│ ⣿  3D VIEWPORT            [Persp ▾] [◐] [⤢] [✕]         │  ← Header (drag handle, 34px)
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │                                                  │   │  ← Viewport (canvas, radius 12)
│   │              MODEL / SCENE                       │   │
│   │                                                  │   │
│   │  [Camera chip]                    [Axis cube]    │   │  ← HUD overlay (pointer-events:none)
│   │                                                  │   │     çocuklar pointer-events:auto
│   │  [guides: rule of thirds…]                       │   │
│   └──────────────────────────────────────────────────┘   │
│   ╭──────────────────────────────────────────────────╮   │  ← Floating dock (56px, alt-orta)
│   │  W  E  R  │  ⛶  F  │  ◐  │  ⬤ Capture          │   │
│   ╰──────────────────────────────────────────────────╯   │
├──────────────────────────────────────────────────────────┤
│  ▸ Kamera   ▸ Işık   ▸ Poz   ▸ Sahne   ▸ Görünüm        │  ← Accordion rail (collapsible)
└──────────────────────────────────────────────────────────┘
```

**Bölgeler ve ölçüler**

| Bölge | Yükseklik | Davranış |
|---|---|---|
| Header | 34 px | Sürükle-taşı, çift tık = expand; panel sürükleme mevcut `17-floating-panels.js` ile uyumlu |
| Viewport | `flex:1`, min 220 px | `aspect` serbest; ResizeObserver → `resize()` |
| Floating dock | 44 px, `bottom:12px`, ortalı | Navigasyon sırasında görünmez (bkz. 2.4) |
| Accordion rail | 32 px collapsed / 260 px açık | Tek bölüm açık (accordion), durum `localStorage` |
| Status chip | 20 px, sol-alt | Lens / ortho ölçeği / FPS (hover'da) |

Panel boyutları: `--panel-min-w:320`, `--panel-max-w:980`, `--panel-min-h:380`.
Expanded mod mevcut davranışı korur (760 px → `min(980, 100vw-28)`).

### 2.2 Liquid Glass tasarım token'ları

`style.css` başına eklenecek (tema değişkenlerinden **türetilir**, böylece 10 tema
otomatik uyum sağlar):

```css
:root{
  /* cam yüzey */
  --glass-bg:        color-mix(in srgb, var(--panel) 58%, transparent);
  --glass-bg-strong: color-mix(in srgb, var(--panel) 82%, transparent);
  --glass-border:    rgba(255,255,255,.08);
  --glass-border-hi: rgba(255,255,255,.16);
  --glass-highlight: inset 0 1px 0 rgba(255,255,255,.10);
  --glass-shadow:    0 18px 48px rgba(0,0,0,.46), 0 2px 8px rgba(0,0,0,.32);
  --glass-blur:      18px;
  --glass-saturate:  140%;

  /* HUD */
  --hud-bg:          rgba(12,16,22,.55);
  --hud-border:      rgba(255,255,255,.08);
  --hud-radius:      10px;
  --hud-gap:         8px;
  --hud-icon:        18px;

  /* materyal/ölçek */
  --radius-glass:    16px;
  --radius-inset:    12px;

  /* hareket — mevcut --motion-* / --ease-* ile aynı aile */
  --hud-fade:        var(--motion-fast, .16s) var(--ease-out, cubic-bezier(.2,.8,.2,1));
}
```

Uygulama kuralları:

```css
#pose3dPanel{
  background: transparent;           /* cam kabuk ayrı katman */
  border: 0;
  box-shadow: none;
  isolation: isolate;
}
#pose3dPanel::before{                 /* cam katmanı */
  content:"";
  position:absolute; inset:0; z-index:-1;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-glass);
  box-shadow: var(--glass-shadow), var(--glass-highlight);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```

`@supports not (backdrop-filter: blur(1px))` → `--glass-bg` opaklığını %92'ye çıkar.
`prefers-reduced-transparency: reduce` → blur 0, opak zemin (mevcut
`prefers-reduced-motion` yaklaşımıyla aynı desen).

**Theme uyumu:** `[data-theme="paper"]` gibi açık temalarda `--glass-border` beyaz
kalırsa görünmez olur; tema bloğuna ek:

```css
[data-theme="paper"]{
  --glass-border: rgba(0,0,0,.08);
  --glass-highlight: inset 0 1px 0 rgba(255,255,255,.55);
  --glass-bg: color-mix(in srgb, var(--panel) 72%, transparent);
  --hud-bg: rgba(255,255,255,.55);
}
```

### 2.3 HUD bileşen envanteri

| Bileşen | Konum | Etkileşim | Durumlar |
|---|---|---|---|
| **Camera chip** | sol-üst 8 px | tık → kamera paneli; tekerlek → lens | `Persp 50mm` / `Ortho 2.4m` |
| **Axis cube** | sağ-üst 8 px | tık → view preset; sürükle → orbit | hover'da eksen vurgusu, 120 ms |
| **Guide overlay** | tam katman | `pointer-events:none` | 3 kip + kapalı |
| **Gizmo switcher** | dock, sol blok | `W/E/R`, basılı gösterir | translate/rotate/scale/off |
| **Focus chip** | alt-sol | `F` = seçime odak; tık = tüm sahne | seçim yoksa disabled |
| **Capture** | dock, sağ | `Ctrl+Shift+S` modal, `Ctrl+Shift+Alt+S` hızlı | modal açıkken `aria-busy` |
| **Presentation** | header `◐` uzun basış | tüm chrome'u gizle (sunum/ekran kaydı) | `Esc` çıkar |
| **Status chip** | sol-alt 8 px | hover'da detay | `FPS · 24.3k tri · 8 bones sel.` |

HUD kuralları:
- HUD katmanı `position:absolute; inset:0; pointer-events:none`; **her çocuk**
  `pointer-events:auto`. Böylece viewport'un orbit alanı HUD yüzünden ölmesin.
- Dokunma hedefleri ≥ 28×28 px (mevcut controller küreleri 3D'de kalır, HUD değil).
- Tüm ikonlar `index.html`'deki mevcut SVG sprite'ına eklenir; satır içi `onclick` yok (CSP).
- `aria-pressed` / `aria-expanded` mevcut `poseRigToggle` deseniyle aynı.

### 2.4 Otomatik gizlenme (auto-collapse) durum makinesi

```
        pointerdown / wheel / Alt+drag
IDLE ─────────────────────────────────► NAVIGATING
  ▲                                        │
  │ 700 ms hareket yok                     │ 250 ms
  └────────────── HUD_FADED ◄──────────────┘
        (opacity .15, dock 60% küçük)
                     │
   pointermove (kenar 40 px) / tuş / focus
                     ▼
                  IDLE (tam görünür)
```

- `NAVIGATING`: dock + chip'ler `opacity:0`, `translateY(6px)`; sadece 1 px kenar
  tutamacı kalır. `will-change: opacity, transform`.
- `KiOSK/presentation`: tüm HUD + panel başlığı gizlenir; `Esc` ile dönüş.
- **Capture sırasında** (modal veya hızlı render): `document.body.dataset.capturing`
  → HUD, grid, gizmo, rig, guide, background gizlenir. Ama asıl PNG **offscreen
  render** ile alınır; DOM hiçbir zaman kareye girmez (bkz. 5.4). Bu bayrak yalnızca
  ekran kaydı/sunum için görsel temizlik sağlar.
- `prefers-reduced-motion` → geçişler `--motion-instant`.

### 2.5 2D tuval ile kesintisiz bütünleşme

1. **Kenarlık yok:** panel `border:0`, cam katman `inset:0`; canvas ile panel arasında
   opak çizgi kalmaz.
2. **Köşe uyumu:** canvas `border-radius: var(--radius-inset)`; cam kabuk
   `var(--radius-glass)` → 4 px iç boşluk hissi.
3. **Kenar erimesi (feather):** istenirse `#pose3dCanvas{ mask-image:
   radial-gradient(120% 120% at 50% 50%, #000 60%, transparent 100%) }` → 2D tuval
   ile yumuşak geçiş. Varsayılan kapalı (`data-feather`), çünkü ölçüm/kompozisyon
   için keskin kenar gerekir.
4. **Saydam mod:** kamera arka planı `null` + `alpha:true` → 3D pencere arkasındaki
   2D tahta görünür (PNG kesimi için birebir aynı görüntü).
5. **Ortak zemin:** 3D gradient arka plan, tema `--bg` ile karıştırılır
   (`linear-gradient(var(--bg), transparent)` scrim), böylece tema değişince 3D
   pencere "yabancı" durmaz.
6. **Gölge paylaşımı:** panel gölgesi tek (`--glass-shadow`); canvas'a ayrı gölge yok.

### 2.6 QSS karşılığı (Qt'ye taşınırsa)

QSS'te `backdrop-filter` **yoktur**. Karşılıklar:

| CSS | QSS / Qt |
|---|---|
| `backdrop-filter: blur()` | `QGraphicsBlurEffect` (pahalı) veya Windows'ta `DwmSetWindowAttribute` + `ACCENT_ENABLE_ACRYLICBLURBEHIND`; alternatif: `QQuickWidget` + Qt Quick `MultiEffect` |
| `border-radius` | `border-radius: 16px` (QSS destekler) |
| `box-shadow` | `QGraphicsDropShadowEffect` |
| `rgba()` | `rgba(255,255,255,0.08)` (QSS destekler) |
| CSS değişkeni | `QPalette` + tema başına QSS string |

---

## 3. Modüler mimari (Electron + three.js)

### 3.1 Tasarım ilkeleri

1. **Tek yönlü veri akışı:** UI → `Command` → state → `invalidate()` → render.
   Modüller birbirinin DOM'una dokunmaz.
2. **Sahne sahibi tek:** `Viewport` dışında hiçbir modül `renderer`/`scene` tutmaz.
3. **Komut + geri alma:** her mutasyon `Command` (undo/redo tek yığın).
4. **Talep üzerine render:** sürekli `requestAnimationFrame` yerine
   `invalidate(reason)`; sekme/panel gizliyken tamamen durur.
5. **Dispose sözleşmesi:** her modül `dispose()`; model değişiminde geometri,
   materyal, texture, render target serbest bırakılır (mevcut kodda yok).
6. **Test edilebilirlik:** DOM'a bağlı olmayan saf sınıflar (`CameraManager`,
   `PoseLibrary`, `LightingRig`) → Node testlerinde mock THREE ile koşabilir.

### 3.2 Dosya ağacı

```
pose3d.js                     → ince giriş (mevcut <script type="module"> korunur)
src/renderer/pose3d/
  bootstrap.js                → sahne kurulumu, modül wiring, global API
  core/
    Viewport.js               → renderer, sahne, resize, render döngüsü, dispose
    SceneGraph.js             → model yükleme (FBX/GLTF/GLB/OBJ), normalize, dispose
    RenderPipeline.js         → tonemap, post FX (SSAO, DoF, vignette), outline
    CameraManager.js          → persp/ortho, preset, lens, F-focus, framing
    SelectionManager.js       → bone/mesh/material slot seçimi, raycast, hover
    History.js                → command stack (undo/redo), transaction
    EventBus.js               → tipli pub/sub (on/emit/off)
  posing/
    Rig.js                    → iskelet tarama, rol eşleme, T/A-pose
    PosingController.js       → FK/IK, kemik seçimi, sürükleme, snap
    GizmoManager.js           → TransformControls sarmalayıcı + ring gizmo
    PoseLibrary.js            → kaydet/yükle, IndexedDB, JSON import/export
  environment/
    LightingRig.js            → key/fill/rim, Kelvin→RGB, shadow ayarları
    Environment.js            → HDRI/gradient/solid/saydam, rotasyon, blur
    ShadowFloor.js            → shadow catcher + grid
  capture/
    RenderExporter.js         → offscreen render, pass'ler, ölçek, blob
    CapturePresets.js         → 1x/2x/4x/4K/8K, alpha, pass seçimi
  ui/
    Hud.js                    → chip/dock/cube, auto-hide state machine
    PanelSections.js          → accordion bölümleri (kamera, ışık, poz, sahne)
    CameraPanel.js            → lens/FOV/DoF/tonemap/guide kontrolleri
    PosePanel.js              → preset listesi, T/A-pose, rig görünürlüğü
    CaptureModal.js           → çözünürlük/pass/alpha/clipboard/hedef
    Guides.js                 → rule-of-thirds, golden ratio, crosshair (SVG)
  bridge/
    BoardBridge.js            → pose-screenshot / pose-capture → app.js
  util/
    three-helpers.js          → dispose, cloneMaterial, boundingBox, Kelvin
    debounce.js
```

`build-app.js` kapsamı **dışında**: `pose3d.js` zaten native ES modül olarak
yükleniyor, bundle'a girmiyor. Ancak `package.json → build.files` ve
`scripts/smoke-test.js` kritik dosya listesine **`src/renderer/pose3d/`** ve yeni
`vendor/` dosyaları eklenmeli.

### 3.3 Modül API'leri

```js
// core/Viewport.js
export class Viewport {
  constructor({ canvas, bus, quality = 'auto' });
  get renderer(); get scene(); get camera();   // salt okunur erişim
  invalidate(reason);                          // bir sonraki karede render
  resize();                                    // ResizeObserver → boyut
  setQuality('low'|'medium'|'high');
  dispose();
}
```

```js
// core/CameraManager.js
export class CameraManager {
  constructor({ viewport, controls, bus });
  setMode('perspective'|'orthographic');
  setLens(mm);                    // 18–200 → vFov = 2*atan(12/mm)
  setOrthoScale(worldUnits);      // dikey dünya yüksekliği
  preset('front'|'back'|'left'|'right'|'top'|'bottom');
  frame(object3d | Box3, { animate = true });
  focusSelection();               // F — seçim yoksa frameAll()
  pickFocusPoint();               // DoF için tıkla-seç
  get state();                    // { mode, lens, orthoScale, fov, target, distance }
}
```

```js
// posing/PosingController.js
export class PosingController {
  constructor({ rig, gizmo, history, bus });
  selectBone(bone);               // ring gizmo + HUD güncelle
  beginDrag(); endDrag();         // transaction aç/kapa
  applyPose(pose, { animate });
  capturePose(name);              // PoseLibrary'ye snapshot
  resetTo('t-pose'|'a-pose');
  setIKEnabled(bool);
}
```

```js
// capture/RenderExporter.js
export class RenderExporter {
  constructor({ viewport, pipeline, sceneGraph });
  async render({ scale, width, height, alpha, passes, format, quality });
  // → { blob, dataUrl, width, height, passes: { beauty, alpha, depth, normal, wire } }
  async toClipboard(result);
  toBoard(result);                // BoardBridge
}
```

```js
// bridge/BoardBridge.js
export class BoardBridge {
  sendImage(blob, meta);          // window.dispatchEvent('pose-capture')
  // app.js: 22-init.js — 'pose-screenshot' (geriye uyum) + 'pose-capture' (yeni)
}
```

### 3.4 Durum modeli ve olaylar

```js
const state = {
  camera:   { mode:'perspective', lens:50, fov:26.99, orthoScale:2.4, dof:{on:false, focus:1.2, fstop:2.8} },
  render:   { tone:'agx', exposure:1.0, contrast:0, vignette:0, quality:'high', ssao:false },
  env:      { mode:'hdri'|'solid'|'transparent', hdriRot:0, intensity:1, blur:0, bgVisible:true },
  lights:   { key:{intensity, Kelvin, dir}, fill:{...}, rim:{...}, shadows:true, softness:0.6 },
  pose:     { selectedBoneId:null, gizmo:'rotate', ik:true, preset:null },
  scene:    { hiddenMeshes:[], isolated:null, wireframe:false, outline:0.004 },
  capture:  { scale:2, alpha:true, passes:['beauty'], target:'board' }
};
```

Kurallar:
- `bus.emit('state:changed', patch)` → ilgili modüller kendi alt kümelerini dinler.
- `History` yalnızca **kullanıcı mutasyonlarını** kaydeder (kamera/UI hariç).
- Kalıcılık: `pose` + `environment` + `camera` `localStorage` (panel bazlı,
  `tailref-floating-*` deseniyle aynı); `posePresets` IndexedDB `meta` anahtarı.
- UI durumu `dataset` ile CSS'e yansır (`data-capturing`, `data-nav`, `data-feather`)
  → JS stilleri hesaplamaz.

### 3.5 Render döngüsü

```js
let dirty = true;
const invalidate = () => { dirty = true; };
function loop() {
  requestAnimationFrame(loop);
  if (!dirty || panel.hidden || document.hidden) return;
  dirty = false;
  pipeline.render();          // composer veya doğrudan render
}
```

- `controls.addEventListener('change', invalidate)`.
- Animasyon (focus tween, pose geçişi) `dirty` bayrağını kendi iter.
- Panel gizli → RAF devam eder ama erken çıkar (GPU %0).
- `IntersectionObserver` + `document.visibilitychange` → tam duraklatma.

### 3.6 Vendor ve paketleme etkisi

Yeni gereksinimler (three r160'ta **yok**, r168+ önerilir):

| İhtiyaç | r160 durumu | Çözüm |
|---|---|---|
| `scene.environmentRotation` | ❌ | r163+ yükselt **veya** skybox mesh döndür + PMREM'i önceden pişir |
| `scene.environmentIntensity` | ❌ | r163+ / `PMREMGenerator` çıkışını ölçekleyen özel materyal |
| `GTAOPass` / `SSAOPass` | ❌ paketli değil | `vendor/postprocessing/*` ekle |
| `BokehPass` (DoF) | ❌ | ekle |
| `RGBELoader` (`.hdr`) | ❌ | ekle |
| `OBJLoader` | ❌ | ekle |
| `EffectComposer` + `ShaderPass` + `OutputPass` | ❌ | ekle |
| `OutlineEffect` | ✅ | r168'de API değişimi → spike'ta doğrula |

**Öneri:** `vendor/` r160 → **r170 LTS-benzeri sabit sürüm** yükseltmesi ayrı bir
spike (P0). Başarısız olursa geri dönüş planı: r160 kalır, HDRI rotasyonu skybox
mesh ile, SSAO yerine SSAOPass'ın r160 kopyası, DoF BokehPass r160.

Paketleme:
```jsonc
// package.json build.files
"pose3d.js",
"src/renderer/pose3d/**",
"vendor/**",              // veya tek tek listele
```
`scripts/smoke-test.js` kritik listesine: `pose3d.js` (var), `src/renderer/pose3d/core/Viewport.js`,
`vendor/postprocessing/EffectComposer.js`, `vendor/loaders/RGBELoader.js`, `.hdr` örneği.

---

## 4. Özellik spesifikasyonları

### 4.1 Kamera motoru

| Özellik | Teknik yaklaşım | Kabul kriteri |
|---|---|---|
| Orbit / pan / zoom | `OrbitControls` + Maya mouse eşlemesi (mevcut) | Alt+sol/orta/sağ birebir korunur |
| Persp ↔ Ortho | İki kamera örneği; geçişte `target`, `distance` eşlenir (`orthoScale = 2*d*tan(vFov/2)`) | Geçişte model zıplamaz (< 0.5 px) |
| Lens 18–200 mm | `vFov = 2·atan(12/mm)`, slider + preset (18/24/35/50/85/135/200) | 50 mm ≈ 39.6° dikey |
| Ortho scale | Dikey dünya yüksekliği (m), slider 0.2–20 | Zoom ile senkron |
| Numpad preset | `1/3/7` ön/sağ/üst, `Ctrl+1/3/7` arka/sol/alt, `5` persp↔ortho, `0` frame all | 200 ms yumuşak geçiş |
| F — odak | Seçili kemik/mesh `Box3` → `frame()`; seçim yoksa tüm sahne | Sapma < 2 px |
| Focus picker (DoF) | tık → raycast → kamera mesafesi; odak düzlemi halkası | Değer panelde mm olarak |
| Klavye kapsamı | Yalnızca `panel.contains(activeElement)` **veya** `viewportHovered` iken | 2D tuvalin F/1 kısayolları bozulmaz |

**Klavye çakışma matrisi** (zorunlu test): `F`, `1`, `3`, `5`, `7`, `0`, `W/E/R`,
`X/Y/Z`, `Q`, `A`. Kural: 3D panel odaklı değilse **hiçbirini** yakalama.

### 4.2 Görüntü ayarları (tone / lens / DoF)

- **Tone mapping:** `NoToneMapping | Linear | Reinhard | Cineon (Filmic) | ACESFilmic | AgX`.
  r160'ta AgX var (`AgXToneMapping = 6`) → ek lisans yok.
- **Exposure:** `renderer.toneMappingExposure` 0.1–4, log slider.
- **Contrast / Vignette:** post pass (`ShaderPass`) ile **hem önizleme hem export**
  aynı shader'dan geçer. CSS `filter` kullanılmaz (export'a girmez).
- **DoF:** `BokehPass(focus, aperture, maxblur)`; `f/1.4–f/22` → aperture
  `0.0001 + 0.02/(fstop²)` (ampirik), `maxblur` 0–0.02. Alpha export'ta DoF kapalı
  (kenar halesi).
- **Composition guides:** ayrı SVG katmanı; export'a **girmez** (opsiyonel
  `includeGuides`).

### 4.3 Pozlama

- **Rig tespiti:** `Rig.build(root)`:
  1. `SkinnedMesh` var mı? → `skeleton.bones`.
  2. Yoksa `isBone` taraması (mevcut).
  3. OBJ/rigsiz → "static" mod; poz paneli devre dışı, sadece gizmo.
- **Rol eşleme:** isim normalizasyonu (`cleanName`) + eşanlamlı tablo (Mixamo,
  endüstriyel 3D adlandırmaları) + **hiyerarşi yedeği** (pelvis'in en uzun
  alt zinciri = bacak; X işareti = L/R). Mevcut `controllerRules` tablosu buraya taşınır.
- **Ring gizmo:** seçili kemikte 3 `TorusGeometry` (X/Y/Z renkleri), `depthTest:false`,
  `renderOrder:30`, hover'da `opacity .6 → 1` + kalınlık +%20. Sürükle → eksen
  etrafında `Quaternion` güncelle; `Shift` = 15° snap, `Ctrl` = 1°.
- **FK/IK:** mevcut `solveIK` korunur; zincir tanımı role göre (upperArm→forearm→hand,
  thigh→shin→foot). IK sırasında pole hedefi ayrı halka.
- **PoseLibrary:** `{ id, name, createdAt, rigSignature, bones:{uuid:[px,py,pz,qx,qy,qz,qw]} }`
  → IndexedDB `meta` (`pose-presets`). 20 kayıtla sınırla, JSON import/export.
  `rigSignature` = ilk 8 kemik adı hash'i; uyuşmazsa "kemik eşlemesi eksik" uyarısı.
- **T-pose / A-pose:** mutlak dünya-uzayı hedefleme (`Rig.aimArms`). T-pose kolları
  yataya (0°), A-pose yataydan 45° aşağıya getirir. Bind pozu T de A da olsa sonuç aynıdır;
  kolun dışa doğru işareti mevcut kemik yönünden türetildiği için aynalı rig'lerde de
  doğru tarafa açılır. Omuz/kol kemiği bulunamazsa T-pose'a düşer + toast.
- **Sub-mesh / slot:** `SceneGraph.parts` → `{ mesh, materialSlot, name }`;
  göz ikonu = `visible`, tek tık = izole (diğerleri `visible=false`, `Esc` geri).
  Materyal slotu bazlı gizleme `geometry.groups` + çoklu materyal için desteklenir.
- **Undo:** `History` (mevcut 50 sınırı korunur), drag = tek transaction.

### 4.4 Işık ve ortam

- **3-point rig:** Key/Fill/Rim `DirectionalLight`; her biri için:
  - yön: küre üzerinde sürüklenebilir hedef (gizmo halkası)
  - sıcaklık: 2000–12000 K → `Kelvin→RGB` (Tanner Helland yaklaşımı)
  - yoğunluk: 0–10 (fiziksel birim değil, sanatçı dostu)
- **Gölge:** `PCFSoftShadowMap`, harita 1024/2048/4096 (kalite), `shadow.radius`,
  `bias -0.0005`, `normalBias 0.02`; zemin `ShadowMaterial` (opaklık kaydırıcı) +
  isteğe bağlı grid.
- **HDRI:** `.hdr` yükleme (`RGBELoader`) → `PMREMGenerator.fromEquirectangular`;
  `scene.environment`; background modları:
  - `solid`: düz renk (`--bg` ile tema uyumlu)
  - `transparent`: `scene.background = null`, `alpha:true`
  - `hdri`: `scene.background = envTexture`, `backgroundBlurriness = blur`
  - rotasyon: `scene.environmentRotation` (r163+) veya skybox mesh
- **SSAO:** `SSAOPass` (kernelRadius 8, minDistance .001, maxDistance .05,
  output `Default`), sadece `quality >= medium`; kapatınca composer maliyeti düşer.
  Silhouette ayrımı için `outline` + SSAO birlikte kullanılabilir.
- **Kalite kademeleri:** Low (no SSAO, 1024 shadow, DPR 1.5), Medium, High (4K shadow,
  DPR 2). `renderer.capabilities` + GPU string ile "auto".

### 4.5 Capture suite

| Özellik | Yaklaşım | Not |
|---|---|---|
| Kısayol | `Ctrl+Shift+S` modal, `Ctrl+Shift+Alt+S` son ayarlarla hızlı | 2D `Ctrl+E` ile çakışmaz; global `keydown` app.js'te tek noktada |
| Ölçek | 1x/2x/4x + 4K (3840×2160) / 8K (7680×4320) | `renderer.capabilities.maxTextureSize` kontrolü; 8K RGBA ≈ 132 MB → uyarı |
| Alpha | `setClearAlpha(0)`, `scene.background=null`, `premultipliedAlpha:false` | PNG cutout |
| Beauty | normal pipeline (composer dahil) | tonemap/vignette export'ta da var |
| Alpha/Silhouette | override `MeshBasicMaterial({color:0x000000})`, beyaz zemin **veya** saydam | 2 seçenek: matte / mask |
| Depth | `MeshDepthMaterial({depthPacking:RGBADepthPacking})` + normalize shader | 8-bit PNG → kullanıcıya "16-bit değil" notu |
| Normal | `MeshNormalMaterial` | düz/mavi normal |
| Wireframe | override `MeshBasicMaterial({wireframe:true})` | lineart ile karışmasın |
| Clipboard | `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])` | 127.0.0.1 güvenli bağlam; başarısızsa `window.tailref.copyImage` IPC |
| Tahtaya gönder | `BoardBridge.sendImage(blob)` → `pose-capture`; `22-init.js` `addFiles` | `pose-screenshot` geriye uyum için korunur |

**Offscreen render akışı:**

```
1. panel gizli değilse mevcut boyut; hedef = (w*scale, h*scale) veya preset
2. gizmo/HUD/grid/rig/guide → visible=false (geçici, try/finally ile geri)
3. offscreen canvas (DOM'a eklenmez) + ayrı WebGLRenderer (paylaşımlı context yok)
   VEYA aynı renderer + WebGLRenderTarget + readPixels
4. pass başına render → ImageData → OffscreenCanvas → toBlob
5. dispose: render target, geçici materyal, override
```

> Ayrı renderer seçilirse tüm texture'lar yeniden yüklenir (bellek). Bu yüzden
> **aynı renderer + RenderTarget** tercih edilir; `readRenderTargetPixels` ile
> alınan veri `ImageData`'ya çevrilir (Y ekseni ters → flip).

**HUD'un kareye girmemesi:** PNG DOM'dan değil WebGL'den üretildiği için HUD
otomatik olarak dışarıda kalır; `data-capturing` yalnızca ekran kaydı/sunum için.

---

## 5. Yol haritası

| Faz | İçerik | Çıktı | Süre (gün) |
|---|---|---|---|
| **P0** | Vendor spike (r160→r170), modül iskeleti, `Viewport`/`EventBus`/`History`, mevcut davranışın birebir taşınması, `pose3d-test.js` | Regresyonsuz modüler taban | 3 |
| **P1** | Liquid Glass token'ları, HUD (chip/dock/cube), auto-hide, presentation mode, tema uyumu | Görsel katman | 3–4 |
| **P2** | `CameraManager`: persp/ortho, lens, preset, F-focus, focal picker, guides | Kamera paneli | 3–4 |
| **P3** | `Rig` + `PosingController` + ring gizmo + PoseLibrary + T/A-pose + submesh | Poz sistemi | 5–6 |
| **P4** | `LightingRig` + `Environment` (HDRI/rot/blur) + shadow catcher + SSAO + tonemap/DoF | Işık & render | 5–6 |
| **P5** | `RenderExporter` + modal + pass'ler + clipboard + board köprüsü | Capture suite | 4–5 |
| **P6** | Kalite kademeleri, dispose denetimi, paketleme, testler, README | 1.2.0 sürümü | 3–4 |

Toplam: **~26–32 geliştirici günü**. Bağımsız paralellenebilir: P1 (UI) ∥ P0 (motor),
P5 (capture) P4 bitmeden başlayabilir (beauty/alpha tek başına).

### Faz kabul kriterleri (özet)

- **P0:** `npm test` + `npm run test:desktop` yeşil; `pose3d.js` < 60 satır; her modül
  `dispose()`; model değiştir→bellek artışı < %5 (heap snapshot).
- **P1:** 10 temanın tamamında cam okunabilir (kontrast ≥ 4.5:1 metin için);
  navigasyon sırasında HUD 250 ms içinde solar; `prefers-reduced-motion` ve
  `reduced-transparency` destekli; panel sürükleme/resize bozulmaz.
- **P2:** 18–200 mm slider'da FOV doğru; `5` geçişinde model kaymaz; `F` sapması
  < 2 px; 2D tuvalin `F`/`1` kısayolları panel odaklı değilken çalışır.
- **P3:** Mixamo FBX + glTF rig otomatik tanınır; T-pose'a dönüş birebir; preset
  kaydet/yükle 20/20; submesh gizle/izole çalışır; undo drag başına 1 adım.
- **P4:** 3 ışık bağımsız; HDRI rotasyonu 0–360; shadow yumuşaklığı; SSAO
  medium+ kalitede; tonemap presetleri gözle ayrışır; FPS ≥ 30 (GTX 1050 sınıfı).
- **P5:** 1x/2x/4x/4K/8K; alpha PNG'de arka plan tam saydam; 5 pass ayrı ayrı;
  clipboard'a PNG; tahtaya yeni öğe olarak düşer; 8K'da bellek uyarısı.
- **P6:** `app.asar` yalnızca `build.files`; smoke test yeni dosyaları doğrular;
  her modül `dispose()` sunar ve tek çağrıda bırakır; `pose3d-unit.js` yeşil;
  README + THIRD_PARTY_NOTICES güncel.

---

## 6. Test stratejisi

1. **Birim (Node, DOM'suz):** `CameraManager` FOV/ortho dönüşümü, `Kelvin→RGB`,
   `PoseLibrary` serileştirme/uyuşmazlık, `History` coalescing, `CapturePresets`
   çözünürlük/bellek hesabı.
2. **Entegrasyon (CDP, mevcut `desktop-smoke.js` deseni):** panel aç → preset uygula
   → `renderer.info` doğrula; capture 512×512 alpha → piksel alfa örnekle; tahtaya
   gönder → `state.items` +1.
3. **Görsel regresyon:** 3 referans kare (persp/ortho/alpha) → base64 diff eşiği %2.
4. **Performans:** `renderer.info.render.calls` < 180; 100 kemikli rigde poz sürükleme
   60 fps (RTX dışı, medium kalite); panel gizliyken 0 draw call.
5. **Regresyon:** 2D tuval testleri (`npm test`, `test:desktop`, `test:close`)
   değişmeden geçmeli; klavye çakışma matrisi.

---

## 7. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| three.js r170 yükseltmesi mevcut toon/outline/IK'yı bozar | Yüksek | P0 spike + `vendor/` snapshot + geri dönüş planı (r160) |
| Postprocessing + `OutlineEffect` çakışması (outline kendi render'ını yapar) | Orta | Outline'ı composer pass'ine sar; reviewda görsel doğrula |
| SSAO + skinned mesh depth | Orta | `MeshDepthMaterial` skinning otomatik (r151+); testte 100 kemik |
| 8K export bellek/GPU limiti | Orta | `maxTextureSize` + toplam piksel cap; tile fallback |
| Klavye kısayolu çakışması (F/1/W/E/R) | Yüksek | Kapsam kuralı + otomatik test |
| Cam efektinin GPU maliyeti | Düşük | `reduced-transparency`, düşük kalite modunda blur kapalı |
| Panel sürükleme HUD tarafından engellenir | Orta | HUD `pointer-events:none`, çocuklar `auto` |
| HDRI dosyası lisansı | Yasal | Kendi üretilen gradient/prosedürel env varsayılan; HDRI kullanıcı yükler |

---

## 8. Açık kararlar (onay gerekiyor)

1. **three.js sürümü:** r170'e yükselt (önerilen) mi, r160'ta kalıp yama mı?
2. **HDRI:** paketle gelen varsayılan bir HDRI olsun mu (lisans + ~2 MB), yoksa
   yalnızca prosedürel gradient + kullanıcı yüklemesi mi?
3. **DoF/SSAO:** postprocessing bağımlılığı kabul mü, yoksa "ucuz sahte DoF"
   (arka planı CSS blur) yeterli mi?
4. **Kapsam:** tek sürümde tümü (P0–P6) mi, yoksa P0–P2 (görsel + kamera) önce
   yayınlanıp P3–P5 sonra mı?
5. **Capture:** 8K gerekli mi (bellek/GPU), yoksa 4K tavan mı?

---

## Ek-A: Liquid Glass örnek markup

```html
<section id="pose3dPanel" hidden data-feather="off" aria-label="3D viewport">
  <header class="glassHead">
    <button class="grip" aria-label="Taşı"></button>
    <b>3D VIEWPORT</b>
    <span class="headActions">
      <button id="poseCamChip" class="hudChip">Persp · 50mm</button>
      <button id="posePresentation" aria-pressed="false" title="Sunum modu">◐</button>
      <button id="btnPose3dExpand" aria-label="Büyüt"></button>
      <button id="btnPose3dClose" aria-label="Kapat"></button>
    </span>
  </header>

  <div class="viewportWrap">
    <canvas id="pose3dCanvas"></canvas>

    <div class="hudLayer" aria-hidden="false">
      <div id="poseGuides" class="guides" data-guide="thirds"></div>
      <div id="poseAxisCube" class="axisCube" role="group" aria-label="Görünüm"></div>
      <div id="poseStatus" class="statusChip">Persp · 50mm</div>
      <div id="poseDock" class="hudDock" role="toolbar">
        <button data-gizmo="translate" aria-pressed="false">W</button>
        <button data-gizmo="rotate" aria-pressed="true">E</button>
        <button data-gizmo="scale" aria-pressed="false">R</button>
        <span class="sep"></span>
        <button id="poseFocus" title="Seçime odaklan (F)">⛶</button>
        <button id="poseCapture" title="Yakala (Ctrl+Shift+S)">⬤</button>
      </div>
    </div>
  </div>

  <div class="accordion">
    <details id="poseSecCamera"><summary>Kamera</summary>…</details>
    <details id="poseSecLight"><summary>Işık</summary>…</details>
    <details id="poseSecPose"><summary>Poz</summary>…</details>
    <details id="poseSecScene"><summary>Sahne</summary>…</details>
  </div>
</section>
```

## Ek-B: Capture modal alanları

| Alan | Tip | Varsayılan |
|---|---|---|
| Çözünürlük | segment: 1x · 2x · 4x · 4K · 8K + genişlik/yükseklik | 2x |
| Arka plan | saydam · katı · HDRI | saydam |
| Pass'ler | beauty · alpha · depth · normal · wireframe (çoklu) | beauty |
| Hedef | panoya kopyala · tahtaya ekle · diske kaydet | tahtaya ekle |
| Kılavuzları dahil et | toggle | kapalı |

## Ek-C: PySide/Qt eşlemesi (yalnızca ayrı ürün için)

| Bu proje (JS) | PySide6 karşılığı |
|---|---|
| `Viewport` (WebGLRenderer) | `QOpenGLWidget` + `QOpenGLFunctions_4_5` veya `QQuickWidget` + Qt Quick 3D |
| `CameraManager` | `QObject` + arcball controller; `QMatrix4x4` projeksiyon |
| `OrbitControls` | özel fare/tekerlek handler; `QPropertyAnimation` ile geçiş |
| `PosingController` | `QObject` + `QUndoStack`; kemik seçimi `QPickEvent` (Qt3D) |
| `PoseLibrary` | `QSettings` / SQLite (`QSqlDatabase`) |
| `RenderExporter` | `QOffscreenSurface` + `QOpenGLFramebufferObject` + `QImage.save` |
| `Hud` | `QWidget` + QSS, `QGraphicsBlurEffect`/Acrylic |
| `CaptureModal` | `QDialog` + `QFormLayout` |
| Clipboard | `QGuiApplication.clipboard().setImage()` |

Not: Qt'de `backdrop-filter` yok; cam efekti platforma özgü (Windows Acrylic,
macOS `NSVisualEffectView`) gerekir. Bu, mevcut Electron uygulamasının yerini
**almaz**; ayrı bir masaüstü ürün olur.

---

## 9. Uygulama durumu

> Bu bölüm spesifikasyonu değil, uygulamanın durumunu tutar. Son güncelleme: 28.10.2026.

| Faz | Durum | Not |
|---|---|---|
| P0 — Vendor + modüler taban | ✅ tamam | three.js r170, `src/renderer/pose3d/` iskeleti, `test:pose3d` |
| P1 — Liquid Glass + HUD | ✅ tamam | cam token'lar, `data-nav` auto-hide, sunum modu, kılavuzlar |
| P2 — Kamera motoru | ✅ tamam | persp/ortho, lens, preset, numpad, `F`, klavye kapsamı |
| P3 — Poz sistemi | ✅ tamam | `PoseLibrary` (IndexedDB `meta/pose-presets`, 20 kayıt, JSON), T/A-pose, parça gizle/izole, `Ctrl+Z` |
| P4 — Işık & ortam | ✅ tamam | 3-point rig + Kelvin, PCFSoft gölge + shadow catcher, HDRI/PMREM, composer (outline→SSAO→DoF→Output→grade), tone mapping, kalite kademeleri |
| P5 — Capture suite | ✅ tamam | `RenderExporter` (1x/2x/4x/4K/8K, 5 pass, alpha), modal + önizleme, pano/tahta/disk, `pose-capture` köprüsü |
| P6 — Paketleme & doküman | ✅ tamam | sürüm 1.2.2; tüm modüllerde `dispose()` + tek noktadan kapatma, `pose3d-unit.js`, README/THIRD_PARTY_NOTICES güncel |

P3 kapsam notları:

- A-pose, omuz Z rotasyonu yerine **dünya uzayında kol yönünü hedefleme** ile uygulanır
  (`Rig.aimArms`): mutlak açı, Mixamo ebeveyn dönüşleriyle uyumludur.
- `PoseLibrary` kayıtları `rigSignature` (ilk 8 kemik adı) taşır. İmza uyuşmazsa kemikler `id → tam ad → normalize ad` sırasıyla eşlenir ve listede `≠ rig` rozeti görünür.
- Parça görünürlüğü toon outline nesnesini de kapatır; izolasyon `Esc` ile geri alınır.
- Test: `node scripts/pose3d-smoke.js` → 31/31.

P4 kapsam notları:

- Render hattı: `OutlineRenderPass` → `SSAOPass` (opsiyonel) → `BokehPass` (opsiyonel) →
  `OutputPass` → kontrast/vinyet `ShaderPass` (ekrana son yazan). `renderer.toneMapping`
  tek kaynak; tone mapping `OutputPass` içinde bir kez uygulanır.
- `OutputPass.material.blending = NoBlending` saydam arka planı korur. `SSAOPass` alfa'yı
  da çarpıyordu (gövde yarı saydam görünüyordu) → `blendSrcAlpha = Zero`, `blendDstAlpha = One`.
  `BokehShader` alfa'yı `1.0` yazıyordu → `tColor` alfa'sına çevrildi.
- SSAO yalnızca lineart kapalı ve kalite ≥ orta iken etkin: normal pass outline
  mesh'lerini de çizer, aksi halde gövde kirli görünür.
- Lineart kalınlığı varsayılanı 0.004 (panel kaydırıcısı 40). Eski 0.04 değeri
  OutlineEffect'i 10× şişirip gövdeyi siyah lekelerle kaplıyordu; kaydırıcı artık açılışta
  sahne değerinden senkronlanır.
- Toon malzeme + 3 ışık doygunluğa gidiyordu; varsayılanlar Key 1.5 / Fill 0.5 / Rim 1.0,
  hemisphere 0.22, emissive 0.05.
- HDRI dosyası `RGBELoader.parse()` ile okunur: CSP `connect-src 'self'` blob: isteklerini
  engellediği için `File → objectURL → fetch` yolu çalışmıyor.
- Zemin `ShadowMaterial` + isteğe bağlı grid; `outlineParameters.visible = false` ile
  lineart dışında tutulur.
- Test: `node scripts/pose3d-smoke.js` → 52/52.

P5 kapsam notları:

- Yakalama **aynı renderer** ile yapılır: tuval geçici olarak hedef boyuta alınır
  (`setPixelRatio(1)` + `setSize(w,h,false)`), composer aynı ölçüye getirilir, kare
  2D tuvale kopyalanıp PNG'ye çevrilir; kamera oranı, near/far, yardımcı görünürlükleri,
  arka plan ve piksel oranı `finally` içinde geri yüklenir. Tuvalin CSS boyutu değişmez.
- 1x = tuvalin çizim tamponu (ekranda görünen piksel sayısı). 2x/4x bunu katlar;
  4K/8K tam 16:9'dur (3840×2160 / 7680×4320). `capabilities.maxTextureSize` aşılırsa
  oran korunarak küçültülür ve modal bunu bildirir. 8K ≈ 127 MB RGBA uyarısı gösterilir.
- Pass'ler: **Beauty** normal composer hattından geçer (ton eşleme + kontrast/vinyet).
  Alpha/Depth/Normal/Wireframe composer'ı atlar; `scene.overrideMaterial` ile tek geçişte
  çizilir. Gizmo, controller'lar, iskelet, ızgara ve toon outline'lar gizlenir; zemin
  yalnızca Beauty'de kalır (gölge yakalayıcı).
- Alpha: siyah siluet + saydam zemin; istenirse beyaz zemin (matte). Depth:
  `MeshDepthMaterial` + `BasicDepthPacking` (yakın beyaz) ve kameranın near/far'ı öznenin
  kamera-uzayı derinlik aralığına daraltılır. Çıktı 8-bit'tir.
- Kompozisyon kılavuzları DOM/SVG olduğu için PNG'ye 2D tuval üzerinde çizilir.
- Pano: önce `navigator.clipboard.write`, olmazsa `window.tailref.copyImage` →
  `clipboard-image` IPC (`nativeImage` + `clipboard.writeImage`). Diske kaydetme
  `save-image` IPC'si ile PNG baytlarını olduğu gibi yazar (yeniden kodlama yok).
- Tahta köprüsü: `BoardBridge.sendResults()` → `pose-capture` (çoklu pass tek olay) →
  `22-init.js` `addFiles` → `pose-capture-done` el sıkışması. `pose-screenshot` korunur.
- Kısayollar: `Ctrl+Shift+S` modal, `Ctrl+Shift+Alt+S` son ayarlarla hızlı tahtaya.
  Panel kapalıysa önce açılır; 2D `Ctrl+S` kaydı etkilenmez.
- Test: `node scripts/pose3d-smoke.js` → 67/67 (P5 sonunda; P6 ile 70/70).

P6 kapsam notları:

- **Sürüm 1.2.0:** `package.json` + `package-lock.json` (kök ve `packages[""]`).
  `build.files` zaten `pose3d.js`, `src/renderer/pose3d/**`, `vendor/**` ve
  `THIRD_PARTY_NOTICES.md` dosyalarını kapsıyor; `app.asar` dışında 3D kaynağı kalmaz.
- **Dispose denetimi:** 17 modülün tamamı `dispose()` sunar (smoke testi sınıf bazında
  denetler). DOM dinleyicileri `AbortController` sinyaliyle tek seferde kaldırılır
  (`PanelController`, `Hud`, `CaptureModal`); zamanlayıcılar ve `URL.createObjectURL`
  önizlemesi de temizlenir.
- **Tek noktadan kapatma:** `window.tailrefDispose3d()` sabit sırayla çalışır —
  panel → HUD → kılavuzlar → pozlama → gizmo → exporter → tahta köprüsü → kütüphane →
  geçmiş → rig → iskelet → ışık → ortam → sahne grafiği → render hattı → kamera →
  viewport. İkinci çağrı `false` döner; `__pose3dReady=false`, `__pose3dDebug=null`.
  Adım adım `renderer.info.memory` izi `window.__pose3dTeardownStats` içinde tutulur.
- **GPU kaynakları:** model yüklüyken 73 geometri / 8 doku; kapatma sonrası 1 / 2 kalır.
  Kalan miktar `three` postprocessing pass'leri ve `TransformControls`'un sabit
  rezidüsüdür (vendor), bu yüzden test `≤ 1 geometri / ≤ 2 doku` eşiğiyle doğrular.
- **Birim testleri:** `node scripts/pose3d-unit.js` → 17/17. `CapturePresets` saf modülü
  `data:` URL ile yüklenir (paket CommonJS); 1x/2x/4K/8K, `maxTextureSize` kırpması,
  0.1x alt sınırı, bellek/biçim metinleri ve 8K uyarısı sınanır. `npm test` zinciri artık
  `build-app → pose3d-unit → smoke-test → pinterest-test`.
- Test: `node scripts/pose3d-smoke.js` → 70/70; `node scripts/pose3d-unit.js` → 17/17.

1.2.1 kapsam notu (tam ekran):

- **Maya tarzı tam ekran:** başlıktaki ⤢ (`#btnPose3dFullscreen`) veya `Shift+F`, paneli
  `document.documentElement` üzerinde native Fullscreen API ile açar; API reddedilirse
  aynı görünüm pencere içinde `pose3d-fullscreen` sınıfıyla uygulanır. Yalnızca 3D
  viewport ekranı kaplar — başlık ve akordiyon `display:none`, HUD ve dock kalır.
  HUD'a **Çık** chip'i (`#poseFullscreenExit`) eklenir; `Esc`, tekrar ⤢ veya chip çıkarır.
- **Durum yönetimi:** sınıf istekten önce iyimser uygulanır (`_fullscreenWanted` jetonu
  erken çıkışta bekleyen isteği iptal eder); panel gizlenirse `MutationObserver` tam
  ekrandan çıkar; sürükleme/boyutlandırma ve pencere `resize` sırasında konum kısıtlama
  tam ekranda devre dışıdır. `dispose()` sınıfı ve native tam ekranı bırakır.
- **İzin:** `main.js` `ALLOWED_PERMISSIONS` kümesine `fullscreen` eklendi (Electron izin
  isteğini reddettiğinde native tam ekran çalışmıyordu).
- Test: `node scripts/pose3d-smoke.js` → 72/72 (tam ekranda tuval = görünüm, çıkışta
  panel/tuval eski ölçüsüne döner).

1.2.2 kapsam notu (poz, lineart, çöp):

- **Eşit controller çapı:** Tüm controller'lar (rol, parmak, genel) tek yarıçap
  `size.y * 0.0045` ve aynı küre çözünürlüğü (16×10) ile üretilir. Eski 0.008 / 0.0025 /
  0.002 ayrımı elde ve parmakta farklı boyutlar oluşturuyordu; artık yalnızca renk rolü
  belirtir.
- **Gerçek T / açık A:** `Rig.toTPose()` → `aimArms(0)` (yatay), `Rig.toAPose()` →
  `aimArms(45)` (mutlak açı). Eski sürüm yalnızca temel rotasyona dönüyordu; bind pozu
  A olduğu için "T-pose" A-pose gibi görünüyordu. A-pose ise mevcut duruşa 35° eklediği
  için kollar gövdeye yapışıyordu. `aimArms` kol yönünü dünya uzayında hedefler, işareti
  mevcut kol yönünden alır (aynalı rig uyumlu).
- **Lineart aralığı:** Panel kaydırıcısı 5–100 yerine **2–300** (0.0002–0.03); ince
  çizgiden kalın kontura kadar. Varsayılan 40 (0.004) korunur.
- **Çöp geri getirme:** Geri getirme, geri al (`Ctrl+Z`) ile aynı `item-enter`
  animasyonunu kullanır; öğeler çöpten uçmadan, tahtadaki yerlerinde kademeli fade +
  hafif yukarı kayma + büyüme ile belirir. Eski `flyItemFromTrash` yolu geri getirmede
  çağrılmaz (fonksiyon silme animasyonu için `flyItemToTrash` ile ortak sınıfı korur).
- Test: `node scripts/pose3d-smoke.js` → 74/74 (T 0°, A 45°, tekrar T 0°, 66 controller
  eşit çap); `node scripts/desktop-smoke.js` → 11/11 (çöp sonrası öğe konumu korunuyor).

1.2.3 kapsam notu (3D ayarları popup):

- **Büyütülmüş görünümde ayarlar:** Genişletme düğmesine basınca (veya tam ekranda)
  alttaki `.poseAccordion` flex akışından çıkıp sağda sabit konumlu, cam yüzeyli bir
  popup olarak otomatik açılır. Genişletilmiş panelde `⚙ Ayarlar` chip'i popup'ı
  açıp kapatır. Dışına tıklama ve `Esc` popup'ı kapatır. Tam ekrandan/ genişletmeden
  çıkınca popup kapanır ve akordiyon eski satır içi yerine döner.
- **Görünürlük:** Ayarlar chip'i yalnızca büyütülmüş/tam ekran görünümde görünür;
  normal panelde gizlidir. Genişletilmiş panelde 3D viewport artık panel genişliğini
  kullanır (eski 480 px içerik sınırı kaldırıldı).
- Test: `node scripts/pose3d-smoke.js` → 74/74 (tam ekranda ayarlar `block/fixed`,
  çıkışta `block/static` ve viewport eski ölçüsüne döner).

1.2.4 kapsam notu (panel tutamağı ve tam ekran HUD):

- **Pencere sürükleme bölgesi panelleri yutmuyor:** Chromium `-webkit-app-region:drag`
  alanlarını z-index'e göre kırpmaz. Üst şeride (`#windowDragStrip`, 0–64 px) veya üst
  dock'a (`#barDock`, 64–112 px) taşan bir panelin başlığına basmak pencereyi taşıyor,
  panel bir daha tutulamıyordu. İki katmanlı düzeltme: (1) yüzen panellerin üst/alt
  sınırı artık dock kutusundan hesaplanıyor (`floatingTopLimit` / `floatingBottomLimit`);
  sürükleme, boyutlandırma ve kayıtlı konum geri yükleme bu limitleri uygular.
  (2) Panellere ve tüm çocuklarına `-webkit-app-region:no-drag` verildi; üst üste binen
  panellerde tıklama hangi panel görünüyorsa ona gider.
- **Tam ekran 3D:** `body.pose3d-fullscreen-open` iken `#windowDragStrip` tamamen kapanır
  ve `#bar` sürükleme bölgesi olmaktan çıkar. Böylece sağ üstteki `⚙ Ayarlar` ve `⤡ Çık`
  chip'leri tıklanabilir kalır; `⤡ Çık` her zaman tam ekrandan çıkarır.
- **Ayar popup'ı:** Ekrana tıklamak popup'ı kapatmaz; popup başlığından
  (`.poseSettingsHead`) yatay/dikey sürüklenebilir.
- **Çöp kutusu paneli aynı sınırlarda:** `#trashPanel` kendi sürükleme/kapatma
  mantığını korur ama diğer yüzen panellerle aynı `floatingTopLimit` /
  `floatingBottomLimit` sınırlarını kullanır. Kayıtlı konum açılışta, dock
  değişince ve sürükleme sırasında yeniden sınırlanır. Böylece panel ana araç
  çubuğunun (üst dock) üstüne binemez; eskiden üst şeride taşıp pencere
  kontrollerinin/araç çubuğunun altında kalıyor ve başlığından tutulamıyordu.
- Test: `node scripts/desktop-smoke.js` → 19/19 (üst üste binen panel öne alınır,
  başlıktan sürüklenir, yukarı sürükleme üst dock altında 124 px'te durur, çöp
  paneli de açılışta ve sürüklemede aynı sınırda kalıp tutulabilir);
  `node scripts/pose3d-smoke.js` → 79/79 (tam ekranda ayarlar açık kalır, çıkış chip'i
  çalışır, popup sürüklenir).

1.2.5 kapsam notu (görünüm presetleri ve yerel gizmo):

- **Kaybolan karakter:** `CameraManager` bileşeninde `controls.update()` her karede
  çağrılmıyordu. Preset yalnızca `camera.position`'ı taşıyor, kamera eski yönüne
  bakmaya devam ediyordu; karakter kadraj dışında kalıyor, tekerlek kaydırınca
  OrbitControls `update()` çalıştığı için geri geliyordu. Artık `viewport.onFrame`
  içinde aktif kontrolcünün `update()`'i her karede çalışır (damping de bunu
  gerektirir) ve tween sonrası kamera hedefe bakar. Doğrulama:
  `cameraManager.isFacingTarget()` (`dot(viewDir, targetDir) ≥ 0.999`).
- **Üst/alt görünümde ters fare:** Preset, üst/alt için `camera.up`'ı `(0,0,∓1)`
  yapıyordu; OrbitControls `_quat`'ı kurulumda `camera.up`'tan bir kez hesapladığı
  için sonraki orbit sürüklemesi ters/karışık çalışıyordu. `up` artık hep `(0,1,0)`;
  üst/alt preset bakış yönüne `0.04` eğim verir (lookAt tekilliği yok, kuzey +Z).
  Kutuplarda `minPolarAngle = 0.02`, `maxPolarAngle = π − 0.02` ile kamera
  kilitlenmiyor.
- **Yerel gizmo eksenleri:** `GizmoManager.space` (`local` varsayılan / `world`),
  ayarlar panelinde **Yerel / Global** düğmeleriyle değiştirilir. Seçilen controller
  halkasının quaternion'ı kemiğin dünya rotasyonuna eşitlenir
  (`PosingController.syncHandleRotation`), böylece TransformControls'un local modu
  parmak/kol kontrolcüsünü kendi X/Y/Z eksenlerinde sürükler. Halka, kemik IK veya
  rotasyonla döndüğünde (sürükleme dışında) gizmo da onunla döner.
- **Matematik (neden ayrı fare eşlemesi gerekmez):** TransformControls local modda
  (1) gizmo eksenlerini `q_world` ile döndürür, (2) tıklama ışınını nesne uzayına
  `q_world⁻¹` ile taşır, (3) eksen doğrusu ile kamera ışınının en yakın noktasını
  çözer. Ekran hareketi `d_screen`, eksenin ekran izdüşümü `a_screen` ise eksen
  boyunca hareket `Δ = (d_screen · â_screen) / |a_screen|` olur; bu yüzden fare
  hareketini ayrıca X/Y/Z'ye elle map'lemek gerekmez. Serbest (eksen seçilmemiş)
  sürüklemede ışın, kontrolcü merkezinden geçen ve kameraya bakan düzlemle kesilir.
- Test: `node scripts/pose3d-smoke.js` → 84/84 (üç preset sonrası kamera hedefe
  bakar, up sabit kalır, üst görünümden orbit ters dönmez, yerel gizmo kontrolcü
  rotasyonuna 1.000000 hizalı).


## 3D gezinme şemaları (18 Kasım 2026)

Ayarlar → 3D Pose → **3D navigation** iki fare şeması sunar; seçim
`tailref-pose3d-nav` anahtarında kalıcıdır ve panel açıkken
`tailref:pose3d-nav` olayıyla anında uygulanır.

| Şema | Orbit | Pan | Dolly | Zoom |
| --- | --- | --- | --- | --- |
| Industry standard | Alt + sol | Alt + orta | Alt + sağ | tekerlek |
| Blender | orta | Shift + orta | Ctrl + orta | tekerlek |

- Düz sol/sağ basış seçim ve gizmo içindir; gezinmeyi tetiklemez.
- Blender şemasında Shift + orta, OrbitControls'un yerleşik ROTATE→PAN
  davranışına bırakılır. Shift'i biz de PAN'a eşlersek kontrolcü kombinasyonu
  yeniden ROTATE'e çevirir (belirti: Shift + orta ters çalışır). Bu yüzden
  yalnız Ctrl + orta DOLLY'ye alınır.
- Kamera motoru şemayı `localStorage` boşken varsayılan **industry standard**
  olarak okur; şema değişimi undo üretmez.
- Test: `node tests/pose3d-unit.js` (NavPreset) ve `node scripts/pose3d-smoke.js`.
