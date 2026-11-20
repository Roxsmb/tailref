# TailRef · Artistic Effects Motoru — MASTER SPEC (kullanıcı promptu, kayıt: 2026-11-18)

> Spesifikasyonun TAMAMI (12 bölüm) bu dosyada kelimesi kelimesine saklanır.
> Bu dosya önceki parça promptların (Bölüm 4/7 + kalan-16 efekt listesi) yerine geçen TEK kaynaktır.
> Uygulama sırasında maddeler kontrol listesi olarak kullanılacaktır.

### PROJECT OBJECTIVE

Develop a professional artistic effects engine integrated directly into TailRef's existing Layers system.

The purpose is to provide illustrators, concept artists, digital painters and visual artists with advanced artistic effects inspired by:

- Traditional printmaking.
- Physical painting and drawing mediums.
- Experimental illustration and graphic art.

This is not a photo filter application.

The effects must provide genuine artistic transformations with detailed controls, believable material characteristics and professional rendering quality.

**IMPORTANT: Before writing code, inspect the existing TailRef project architecture. Understand the current canvas, rendering engine, layer system, compositing pipeline, UI framework and project serialization. Integrate the new system without breaking or replacing existing functionality.**

---

# 1. EFFECT CATEGORIES

Create three main effect categories.

## CATEGORY A — PRINTMAKING

Inspired by traditional printing techniques, risograph, screen printing, engraving and physical ink reproduction.

### 1. HALFTONE

Create authentic halftone patterns commonly found in traditional printing, manga, comics and graphic illustration.

Parameters:

**Dot Settings**
- Dot Size
- Dot Spacing
- Dot Angle
- Dot Shape: Circle, Square, Diamond, Line
- Dot Scale
- Dot Rotation

**Image Processing**
- Contrast
- Brightness
- Threshold
- Tonal Sensitivity
- Pattern Intensity
- Edge Preservation

**Appearance**
- Monochrome / Color Mode
- Dot Color
- Background Color
- Invert Pattern

The halftone pattern must respond to the luminance of the original artwork.

### 2. RISOGRAPH

Simulate authentic multi-layer risograph printing.

Parameters:

**Ink Settings**
- Number of Ink Layers
- Ink Color for Each Layer
- Ink Density
- Ink Opacity
- Ink Saturation
- Ink Absorption

**Registration**
- Registration Offset X
- Registration Offset Y
- Independent Channel Offset
- Registration Irregularity

**Texture**
- Paper Grain
- Ink Grain
- Print Imperfections
- Ink Bleeding
- Texture Intensity

**Color**
- Color Separation
- Color Mixing
- Color Overlap
- Contrast

Allow users to create custom multi-color printing combinations.

### 3. CMYK COLOR SEPARATION

Simulate traditional CMYK printing with independent color channels.

Parameters:
- Cyan Offset X / Y
- Magenta Offset X / Y
- Yellow Offset X / Y
- Black Offset X / Y
- Channel Intensity
- Registration Error
- Channel Blur
- Ink Density
- Color Separation Strength
- Background Color

Each channel must have independent controls.

### 4. LINOCUT

Simulate traditional linoleum block printing.

Parameters:
- Carving Density
- Line Thickness
- Carving Direction
- Edge Roughness
- Contrast
- Threshold
- Negative / Positive Mode
- Ink Color
- Paper Color
- Texture Intensity
- Carving Detail

Create organic carved marks instead of simply applying an edge detection filter.

### 5. WOODCUT

Simulate traditional wood engraving and woodblock printing.

Parameters:
- Wood Grain Direction
- Grain Scale
- Engraving Density
- Line Thickness
- Line Spacing
- Directional Variation
- Contrast
- Edge Irregularity
- Ink Color
- Background Color
- Carving Depth Simulation

Create directional engraving patterns that respond to the original artwork's tonal values.

### 6. PAPER GRAIN / DISTRESS

Create realistic traditional paper surfaces and aged printing textures.

Parameters:
- Grain Intensity
- Grain Scale
- Paper Roughness
- Fiber Density
- Surface Variation
- Paper Aging
- Stains
- Scratches
- Edge Wear
- Paper Color
- Texture Contrast
- Random Seed

Support different paper characteristics, including:
- Rough watercolor paper.
- Smooth illustration paper.
- Vintage aged paper.
- Handmade paper.
- Fibrous printmaking paper.

---

## CATEGORY B — TRADITIONAL MEDIA

Inspired by traditional painting, drawing, pigment, charcoal and physical artistic materials.

### 7. WATERCOLOR

Create believable watercolor characteristics.

Parameters:

**Pigment**
- Pigment Diffusion
- Pigment Density
- Pigment Granulation
- Pigment Pooling
- Pigment Variation

**Water Behavior**
- Water Spread
- Absorption
- Edge Diffusion
- Wetness
- Bleeding

**Appearance**
- Edge Darkening
- Paper Texture
- Paper Absorption
- Color Variation
- Transparency
- Texture Intensity

Simulate natural watercolor pigment behavior and uneven absorption.

### 8. OIL PAINT / IMPASTO

Simulate traditional oil painting with visible brush marks and thick paint.

Parameters:
- Brushstroke Size
- Brushstroke Direction
- Stroke Length
- Paint Thickness
- Impasto Depth
- Surface Roughness
- Canvas Texture
- Color Variation
- Lighting Intensity
- Texture Scale
- Brushstroke Density
- Surface Relief

Create convincing painterly surfaces rather than simply blurring or smoothing the image.

### 9. COLORED PENCIL

Simulate traditional colored pencil illustration.

Parameters:
- Pencil Grain Intensity
- Paper Tooth
- Stroke Density
- Stroke Direction
- Stroke Length
- Pressure Variation
- Pigment Coverage
- Color Variation
- Pencil Hardness
- Texture Scale
- Stroke Irregularity
- Layered Pigment Intensity

Preserve the original illustration's details while adding authentic pencil characteristics.

### 10. CHARCOAL

Simulate expressive charcoal drawing.

Parameters:
- Charcoal Grain
- Smudge Intensity
- Smudge Radius
- Softness
- Edge Roughness
- Powder Density
- Contrast
- Paper Texture
- Black Intensity
- Grain Scale
- Charcoal Stroke Variation
- Highlight Preservation

Support both soft charcoal shading and rough expressive charcoal marks.

### 11. CROSSHATCHING

Convert tonal information into traditional crosshatching patterns.

Parameters:
- Primary Angle
- Secondary Angle
- Third Angle
- Fourth Angle
- Line Thickness
- Line Spacing
- Hatch Density
- Directional Variation
- Tone Sensitivity
- Line Color
- Background Color
- Edge Preservation

Hatching density must respond to the tonal values of the original artwork.

### 12. STIPPLING

Create tonal illustrations using procedural dots.

Parameters:
- Dot Density
- Minimum Dot Size
- Maximum Dot Size
- Dot Size Variation
- Distribution Randomness
- Tone Sensitivity
- Clustering
- Edge Preservation
- Dot Color
- Background Color
- Distribution Scale
- Random Seed

Dots must follow image luminance rather than appearing as a uniform pattern.

### 13. DRY BRUSH

Simulate expressive dry brush painting.

Parameters:
- Brush Size
- Brush Direction
- Stroke Length
- Broken Coverage
- Bristle Texture
- Edge Roughness
- Paint Density
- Grain Intensity
- Color Variation
- Texture Scale
- Stroke Irregularity
- Surface Texture

Create broken pigment coverage and visible brush marks.

---

## CATEGORY C — EXPERIMENTAL ILLUSTRATION

Inspired by experimental graphic design, digital art, alternative printing and contemporary illustration.

### 14. DITHERING

Create professional dithering effects.

Parameters:
- Dithering Algorithm
- Pixel / Cell Size
- Color Palette
- Number of Colors
- Threshold
- Contrast
- Brightness
- Dither Intensity
- Pattern Scale
- Monochrome / Color Mode
- Palette Customization

Supported algorithms:
- Bayer Ordered Dithering
- Floyd-Steinberg
- Atkinson
- Jarvis-Judice-Ninke
- Stucki

Each algorithm must implement its actual dithering technique.

### 15. GLITCH ART

Create controlled digital distortion and experimental visual artifacts.

Parameters:
- RGB Displacement
- Horizontal Displacement
- Vertical Displacement
- Block Size
- Block Frequency
- Scanline Intensity
- Noise Amount
- Distortion Strength
- Channel Separation
- Random Seed
- Distortion Direction
- Color Shift

Allow independent control of color channels and geometric distortion.

### 16. CHROMATIC ABERRATION

Create optical RGB channel separation.

Parameters:
- Red Channel Offset X / Y
- Green Channel Offset X / Y
- Blue Channel Offset X / Y
- Separation Distance
- Radial Intensity
- Direction
- Center Position X / Y
- Edge Falloff
- Blend Intensity
- Radius

Support:
- Radial mode.
- Directional mode.
- Custom channel positioning.

### 17. CONTOUR EXTRACTION

Extract visual contours and create artistic line representations.

Parameters:
- Edge Detection Algorithm
- Edge Threshold
- Edge Thickness
- Edge Sensitivity
- Detail Level
- Smoothing
- Line Color
- Background Color
- Invert
- Transparent Background
- Noise Reduction

Supported algorithms:
- Sobel
- Canny
- Laplacian

Preserve important shapes and contours without excessive noise.

### 18. INK BLEED

Simulate ink spreading through physical paper fibers.

Parameters:
- Bleed Amount
- Spread Radius
- Diffusion Strength
- Edge Expansion
- Directional Distortion
- Pigment Density
- Paper Absorption
- Organic Variation
- Edge Darkening
- Random Seed
- Fiber Influence
- Color Bleeding

Create believable ink spreading and organic edge deformation.

### 19. POSTERIZATION

Create controlled graphic illustrations with limited tonal and color ranges.

Parameters:
- Number of Tonal Levels
- Color Reduction
- Contrast
- Brightness
- Saturation
- Threshold
- Color Palette
- Edge Preservation
- Dither Integration
- Color Mode
- Highlight Control
- Shadow Control

Allow users to create distinctive limited-palette illustration styles.

### 20. COLOR HALATION

Create analog-inspired color bleeding around bright areas.

Parameters:
- Highlight Threshold
- Glow Radius
- Spread Amount
- Glow Intensity
- Halation Color
- Color Saturation
- Edge Softness
- Highlight Preservation
- Blend Intensity
- Falloff
- Color Variation
- Highlight Mask

Create controlled colored light diffusion around highlights.

---

# 2. EFFECTS LAYER ARCHITECTURE

Integrate effects directly into the existing Layers panel.

Add a new layer type:

**Effects Layer**

This must not be a separate image editor or external editing application.

Users should be able to:
- Create an Effects Layer.
- Select an effect.
- Change its parameters.
- Toggle visibility.
- Adjust opacity.
- Reorder layers.
- Duplicate layers.
- Delete layers.
- Rename layers.
- Collapse and expand layer properties.

Effects Layers must behave as independent editable objects.

## Non-Destructive Editing

This is a critical requirement.

Never permanently modify the original artwork when applying an effect.

Each effect must store its own configuration and parameters independently.

Users must be able to reopen an effect and change its settings at any time.

Disabling or deleting an Effects Layer must restore the appearance of the artwork without that effect.

The original artwork must remain untouched.

## Effect Stacking

Support unlimited practical effect stacking, subject to available hardware resources.

Example:

1. Original Artwork
2. Halftone
3. Risograph
4. Watercolor
5. Paper Grain
6. Chromatic Aberration

Each effect processes the composited output of the layers beneath it, according to the layer stack order.

Users must be able to:
- Reorder effects.
- Combine multiple effects.
- Change individual effect opacity.
- Disable individual effects.
- Edit each effect independently.
- Create complex combinations.

Changing one effect must never destroy another effect's settings.

Ensure that upstream changes correctly invalidate affected downstream rendering results.

---

# 3. EFFECT PROPERTIES — CONTROL PANEL

Create a unified, dynamic **Effect Properties** inspector.

Do not create 20 completely separate windows.

Instead, use one contextual properties panel that changes depending on the selected Effects Layer.

When the user selects Halftone, show Halftone parameters.

When the user selects Watercolor, show Watercolor parameters.

Apply the same behavior to all 20 effects.

## Control Types

Use appropriate controls for each parameter:

- Sliders for continuous values.
- Numeric inputs for precise adjustments.
- Dropdown menus for modes and algorithms.
- Color pickers for color parameters.
- Checkboxes or toggles for optional features.
- Angle controls for directional parameters.
- Custom palette controls where applicable.

Every control must be connected to the actual rendering engine.

Display numerical values next to sliders.

Support direct numerical editing.

## Parameter Organization

Organize effect parameters into collapsible sections.

Examples:

Halftone:
- Dot Settings
- Image Processing
- Appearance

Risograph:
- Ink Settings
- Registration
- Texture
- Color

Watercolor:
- Pigment
- Water Behavior
- Appearance

Avoid displaying every parameter in one overwhelming list.

Keep the panel compact, professional and easy to navigate.

## Shared Controls

Provide common controls where applicable:

- Effect Opacity.
- Blend Mode.
- Visibility.
- Reset Parameters.
- Reset All.
- Enable / Disable.

Do not expose irrelevant controls for effects that do not support them.

---

# 4. EFFECT BROWSER

Add an effect browser accessible through the existing Layers panel.

Button:

**+ Add Effects Layer**

Clicking this button opens a compact effect selection interface.

The browser must contain three categories:

- Printmaking
- Traditional Media
- Experimental Illustration

Requirements:

- Search effects by name.
- Display effect names.
- Provide meaningful visual preview thumbnails.
- Show category labels.
- Allow users to select an effect.
- Create the corresponding Effects Layer after selection.

Use genuine previews of the effects whenever possible.

Do not use unrelated stock images or decorative placeholder thumbnails.

The effect browser must follow TailRef's existing visual language.

---

# 5. PRESET SYSTEM

Every effect must support presets.

Provide:

**Built-in Presets**
- Professionally designed starting configurations.
- Different artistic variations for each effect.
- Presets must produce visibly different results.

**Custom Presets**
- Save current effect parameters.
- Name custom presets.
- Load saved presets.
- Delete custom presets.
- Restore default parameters.

Examples:

Halftone:
- Classic Comic
- Fine Newspaper
- Large Graphic Dots
- Vintage Manga

Risograph:
- Two-Color Print
- Retro Poster
- Misregistered Ink
- Experimental Layers

Watercolor:
- Soft Wash
- Granulated Pigment
- Heavy Pigment
- Wet-on-Wet

Colored Pencil:
- Fine Pencil
- Rough Sketch
- Dense Pigment
- Soft Coloring

Presets must store the complete parameter configuration of their corresponding effect.

Presets must never permanently alter the original artwork.

---

# 6. NON-DESTRUCTIVE RENDERING ARCHITECTURE

Design the system as a composable processing pipeline.

Conceptually:

Original Layers → Composite Input → Effect 1 → Effect 2 → Effect 3 → Final Canvas Output

Each Effects Layer must:
- Receive the correct composited input.
- Process that input with its own parameters.
- Produce an output with correct alpha transparency.
- Pass the result to the next effect.
- Respect visibility, opacity and layer ordering.

The original layer data must remain separate from effect outputs.

Store effect configurations independently from rendered results.

Use an appropriate rendering architecture based on the existing TailRef implementation.

Do not rewrite the entire rendering engine unless absolutely necessary.

---

# 7. PERFORMANCE AND GPU OPTIMIZATION

Performance is critical, particularly for large, high-resolution illustrations.

Do not recalculate the entire canvas from scratch every time a slider changes.

Implement:

- GPU acceleration where supported.
- Incremental rendering.
- Dirty-region updates where technically applicable.
- Intermediate rendering caches.
- Intelligent cache invalidation.
- Reusable intermediate render textures.
- Optimized rendering passes.
- Debounced or throttled updates where appropriate.
- Lower-resolution previews during continuous slider interaction.
- Full-resolution rendering after interaction finishes.
- Efficient memory management.
- Minimal unnecessary CPU-GPU transfers.

When one effect changes, invalidate only the necessary downstream results.

Do not unnecessarily recalculate unrelated effects.

Maintain responsive canvas interaction while editing parameters.

The system must remain stable when multiple computationally expensive effects are stacked.

If the existing architecture cannot support a particular GPU technique, use the most appropriate optimized alternative rather than introducing an incompatible rendering system.

---

# 8. PROJECT SAVING AND RESTORATION

All Effects Layer configurations must be saved as editable project data.

Persist:

- Effect type.
- Unique layer ID.
- Effect parameters.
- Layer name.
- Visibility.
- Opacity.
- Blend mode, if supported.
- Stack position.
- Preset information.
- Random seeds.
- Effect-specific settings.

When a project is reopened, restore the complete Effects Layer stack.

The user must not have to reapply or reconfigure effects.

Maintain compatibility with existing project files.

Do not break existing save/load functionality.

If necessary, implement a versioned project-data migration strategy.

---

# 9. VISUAL DESIGN AND USER EXPERIENCE

The new system must look and feel like a professional illustration application.

Requirements:

- Follow the existing TailRef design system.
- Maintain consistent typography.
- Use existing spacing and component conventions.
- Avoid unnecessary visual clutter.
- Use clear section labels.
- Use compact professional controls.
- Provide clear hover and selected states.
- Maintain consistent iconography.
- Ensure appropriate panel resizing and scrolling.
- Support the existing application window sizes.

Do not redesign unrelated parts of TailRef.

Do not introduce a completely different visual language.

The effects interface must feel like a native part of the existing application.

---

# 10. IMPLEMENTATION PRIORITIES

Implement the system incrementally.

Do not attempt to implement all 20 effects simultaneously with incomplete functionality.

### PHASE 1 — CORE ARCHITECTURE

Implement:
- Effects Layer data model.
- Non-destructive processing.
- Effect stacking.
- Effect Properties panel.
- Parameter persistence.
- Rendering and caching infrastructure.

### PHASE 2 — FIRST EIGHT EFFECTS

Fully implement and test:

1. Halftone
2. Risograph
3. Watercolor
4. Colored Pencil
5. Crosshatching
6. Dithering
7. Chromatic Aberration
8. Ink Bleed

These eight effects must be genuinely functional before proceeding.

### PHASE 3 — REMAINING TWELVE EFFECTS

Implement:

9. CMYK Color Separation
10. Linocut
11. Woodcut
12. Paper Grain / Distress
13. Oil Paint / Impasto
14. Charcoal
15. Stippling
16. Dry Brush
17. Glitch Art
18. Contour Extraction
19. Posterization
20. Color Halation

### PHASE 4 — FINALIZATION

Complete:
- Effect Browser.
- Preset System.
- Performance optimization.
- Project save/load integration.
- UI polish.
- Testing.

---

# 11. QUALITY ASSURANCE AND ACCEPTANCE CRITERIA

Before considering the system complete, verify the following:

**Effect Quality**
- Every effect produces a distinct and recognizable visual result.
- Every parameter changes the actual rendered output.
- No decorative or fake controls.
- No effects implemented as simple generic overlays.
- No placeholder effects.

**Non-Destructive Behavior**
- Original artwork remains unchanged.
- Effects can be edited after application.
- Effects can be independently disabled or deleted.
- Effects can be reordered without losing their settings.

**Stacking**
- Multiple effects can be combined.
- Each effect maintains independent settings.
- Changing an upstream effect correctly updates downstream effects.

**Performance**
- Slider interaction remains responsive.
- Rendering caches work correctly.
- High-resolution artwork is supported.
- Memory usage remains controlled.
- No unnecessary full-canvas recalculation.

**Project Persistence**
- Save and reopen projects.
- Verify all effects and settings are restored.
- Verify effect ordering and visibility.
- Verify custom presets are preserved.

**UI**
- All 20 effects have dedicated parameter panels.
- All controls are functional.
- No broken or inaccessible settings.
- The interface follows the existing TailRef design language.

---

# 12. FINAL DEVELOPMENT INSTRUCTIONS

Before implementation, inspect the existing codebase and report:

1. How the current Layers system works.
2. How the canvas is rendered.
3. Where the Effects Layer architecture should integrate.
4. Which existing components can be reused.
5. Any technical limitations that could affect implementation.

Then proceed with implementation.

Important restrictions:

- Do not replace the existing Layers system.
- Do not break existing drawing functionality.
- Do not rewrite unrelated application components.
- Do not introduce unnecessary dependencies.
- Do not use placeholder implementations.
- Do not create controls that are disconnected from the rendering engine.
- Do not sacrifice image quality for superficial performance improvements.
- Do not silently skip difficult effects.

If an effect requires a more advanced algorithm, implement the appropriate algorithm rather than approximating it with an unrelated filter.

After each phase, test the actual rendering output before moving forward.

**FINAL GOAL**

Build a professional artistic effects engine specifically designed for illustrators and concept artists.

TailRef should allow artists to transform their illustrations using traditional printmaking, physical painting and drawing materials, and experimental visual techniques — while maintaining complete non-destructive control over every effect.

The result should feel like a serious professional creative tool, not a collection of basic image filters.

---

# Uygulama Planı (özet — TailRef'e uyarlanmış)

## Mimari eşleme (mevcut temel)
- `53-ink-compositor.js` zaten "tek doğruluk kaynağı plan" üretiyor (`inkAttachedDisplayPlan`).
  Efekt zinciri planın ÜSTÜNE aşamalar olarak eklenir: Composite Input → FX1 → FX2 → ...
- Geçersizleştirme: `inkCompositeRuntime.gen` (katman gen sayaçları) + grup raster imzası
  (`inkGroupCacheSig`) deseni, FX aşama önbelleklerine aynen taşınır.
- Görüntüleme: öğe DOM'unda tek `inkFxCanvas` overlay (katman tuvalleri gizlenir).
  Dışa aktarım aynı zinciri kullanır (ekran=export tek kaynak).

## Faz 1 — çekirdek motor (`src/renderer/core/56-ink-fx.js`)
- Veri modeli: `item.fx.stack = [{ id, type, params, opacity, visible, blend, seed }]`
- Deterministik PRNG (mulberry32) — seed efekt kaydında; rastgelelik render'lar arası sabit.
- Aşama önbelleği: her aşama `sig = prevSig + type + params + seed + size`;
  parametre değişimi yalnız o aşamayı ve ALTTAKİLERİ geçersiz kılar (spec C ✓).
- `visible=false` → pass-through (yeniden hesap yok); `blend/opacity` pişirilir (doğruluk).

## Faz 2 — efekt seti (optimize Canvas2D, ctx.filter GPU destekli)
> **ÖLÇEK: 20 efekt** — tüm parametre şemaları MASTER SPEC Bölüm 1'de hazır.
> Her efektin KENDİ parametre şeması vardır; jenerik panel YASAK.
> **Faz 2 ilk dalga (master spec Faz 2):** Halftone, Risograph, Watercolor, Colored Pencil,
> Crosshatching, Dithering, Chromatic Aberration, Ink Bleed (8 efekt — tam çalışmadan geçiş yok).
- Her efekt = `{ id, label, params: [...şema], defaultParams, apply(ctxIn, ctxOut, params, size, seed) }`
- Parametre türleri: slider(+sayısal input), dropdown(algoritma/mod), color picker, toggle
- Örnek şemalar (Bölüm 7'den birebir):
  - **Halftone**: Dot Size, Dot Spacing, Dot Angle, Dot Shape, Contrast, Threshold, Color Mode
  - **Risograph**: Ink Colors, Number of Ink Layers, Ink Density, Registration Offset X/Y, Paper Texture, Grain Intensity
  - **Watercolor**: Pigment Diffusion, Granulation, Pigment Pooling, Edge Darkening, Paper Absorption, Paper Texture
- Implementasyon optimizasyonları: Uint32 tarama, ctx.filter GPU, düşük-çöz önizleme,
  ara doku yeniden kullanımı (reuse intermediate textures).

## Faz 3 — entegrasyon
- Görüntüleme: `inkCompositeSyncItem`'e FX dalı; en az 1 görünür efekt varsa katman
  tuvalleri gizlenip `inkFxCanvas` gösterilir.
- Export: `15-menu-export.js` plan yoluna aynı `inkFxApply` (tek kaynak, ekran=export).

## Faz 4 — FX paneli + Dynamic Properties Inspector (Bölüm 7)
- Panel menüsüne "Efektler" karosu; yığın listesi: göz/opaklık/ad/düzenle/sıra/sil/çoğalt.
- **Bağlama duyarlı inspector**: bir FX katmanı seçilince o efektin kendi kontrolleri
  otomatik görünür (parametre şemasından üretilir — jenerik slider seti YASAK).
  - Slider + yanında sayısal değer (hassas düzenleme), dropdown, color picker, toggle.
  - Collapsible bölümler, ilgili kontroller gruplu; TailRef tasarım dili.
  - Reset to Default; gerçek zamanlı görsel geri bildirim (önbellek boru hattına bağlı).
- **Ortak bölüm** (tüm efektler için): Effect Opacity, Blend Mode, Visibility, Reset Parameters.
  Desteklemeyen efekt için alakasız kontrol GÖSTERİLMEZ.
- **Preset sistemi**: efekt başına preset tarayıcı — built-in + kullanıcı presetleri,
  Save/Delete/Restore Defaults; preset tam parametre konfigürasyonunu saklar.
- Kaydırıcı sürüklenirken önizleme de TAM çözünürlükte hesaplanır; yalnız kare
  sıklığı sınırlanır (son ölçülen zincir süresi × 1.1, 80–400 ms; ara değerler
  atlanır, son değer gecikmeli boyanır).
  Eski 0.35 ölçekli önizleme (aşağıdaki Faz 5 notu) piksel tabanlı parametreleri
  (`blockSize`, bleed, ofsetler, gürültü karoları) ve deterministik RNG dizisini
  ölçekle değiştirdiği için "sürüklerken" ile "bırakınca" bambaşka sonuç
  veriyordu; parite sözleşmesi ekran = commit = export olduğundan bu yol
  kaldırıldı (18 Kasım 2026, tur 5).
- Seçim değişince panel anında güncellenir; her kontrol gerçek render'a bağlı (fake YASAK).

## Faz 5 — kalıcılık + testler
- `item.fx` proje kaydına girer (state-db); pushUndo snapshot fx'i kapsar.
- Presetler: built-in kod içinde; kullanıcı presetleri kalıcı depoda (proje bağımsız).
- `tests/fx-pipeline-test.js`: determinizm (aynı seed → aynı pikseller), önbellek isabeti,
  alt-aşama geçersizleme, disable pass-through, undo/redo, kayıt/reload, preset save/load.
- Inspector testleri: efekt seçimi → doğru kontroller; her kontrol render'ı gerçekten değiştirir.
- Tüm batarya yeniden koşulur (smoke, compositor, ink-smoke, layer-*).

## Durum logu
- [x] Spec kaydedildi (Bölüm 4 + Bölüm 7 — tam prompt)
- [x] Kalan 16 efektin tam parametre tanımları alındı ve kaydedildi (Bölüm 8 — oturum kilitlenince veritabanından kurtarıldı)
- [x] layer-store-test 43/43 yeşil (Faz 5 bataryasında doğrulandı)
- [x] 50-layer-stack.js: sanitize kaldırma + doc-comment doğrulaması TAMAM (`inkDocSanitizeGroups` kaynakta hiç yok; 50:967/988/1012 yorumları kompozitörün `bound` çözümüyle birebir; regresyon testi eklendi: üye klasörden koparılıp en üste taşınsa da parentId sabit, plan girişi `bound` ile klasöre bağlı, klasör görünürlüğü üyeye yansıyor → layer-flip-fold **17/17**)
- [x] Faz 1 çekirdek
- [x] Faz 2 efektler (ilk dalga 8/8 tamam — `65-ink-fx-effects.js`; kalan 12'nin tanımları Bölüm 8'de hazır)
- [x] Faz 3 entegrasyon (20/20 efekt — ayrıntı alttaki durum logunda)
- [x] Faz 4 panel + inspector + preset
- [x] Faz 5 testler

## Durum logu
- [x] MASTER SPEC alındı ve kaydedildi (12 bölüm, tam metin — tek kaynak)
- [x] Eski parça promptlar (Bölüm 4/7 + kalan-16 efekt listesi) silindi — master spec kapsıyor (kurtarma: oturum veritabanı seq 10221/10393/10470)
- [x] layer-store-test 43/43 yeşil (Faz 5 bataryasında doğrulandı; eski 42/43 kırmızısı kapandı)
- [x] 50-layer-stack.js: sanitize kaldırma + doc-comment doğrulaması TAMAM (`inkDocSanitizeGroups` kaynakta hiç yok; 50:967/988/1012 yorumları kompozitörün `bound` çözümüyle birebir; regresyon testi eklendi: üye klasörden koparılıp en üste taşınsa da parentId sabit, plan girişi `bound` ile klasöre bağlı, klasör görünürlüğü üyeye yansıyor → layer-flip-fold **17/17**)
- [x] Bölüm 12: kod tabanı incelemesi + rapor → `docs/fx-bolum12-inceleme.md` (sıradaki: build + test bataryası)
- [x] Faz 1 çekirdek motor (`64-ink-fx.js`: veri modeli `item.fx.stack`, mulberry32 PRNG, `inkFxInputRaster` + `inkFxApplyChain` tek kaynak, aşama sig/önbellek, pass-through, `inkFxChanged`; pilot efekt Halftone; kancalar: 53 ekran dalı + 29 export dalı + `.inkFxCanvas` CSS · test: `tests/fx-pipeline-test.js` 15/15, compositor 24/24, gates saf zincir yeşil, portable + Desktop SHA256 eşit + verify-package yeşil)
- [x] Faz 2 ilk 8 efekt TAMAMLANDI (`65-ink-fx-effects.js`: Risograph · Watercolor · Colored Pencil · Crosshatching · Dithering (gerçek FS/Atkinson/JJN/Stucki çekirdekleri + mono/gameboy/cga/gray4/levels paletleri + Bayer 8×8) · Chromatic Aberration (piksel-başına kanal offsetli örnekleme) · Ink Bleed (premultiplied anizotropik bulanıklık) — her biri master spec Bölüm 1 parametre şemasıyla + ortak yardımcılar (`inkFxSrcData`, `inkFxLumOf`, `inkFxCoarseNoise`, `inkFxNoiseTile`, `inkFxCanvas`, `inkFxPutImageData`) · düzeltmeler: Watercolor `spreadR2` bildirimi + blur altışma hatası + absorption/edgeDiffusion/pigmentVariation bağlama, Colored Pencil `deep` mantığı + labeled blok temizliği, Dithering kernel koordinatları (negatif dx) + çifte yoğunluk çarpanı, CA siyah-zemin/`lighter` hatası → per-pixel rewrite, CA sabit offsetler `separationDistance`'tan bağımsız · test: `tests/fx-pipeline-test.js` 19/19 (registry 8/8 + smoke apply 7 efekt determinizm + gameboy paleti + CA kanal kayması), compositor 24/24, gates saf zincir yeşil, portable + Desktop SHA256 eşit + verify-package yeşil)
- [x] Faz 3 kalan 12 efekt TAMAMLANDI (`66-ink-fx-effects2.js`: CMYK Color Separation (gerçek K=1−max RGB formülü, 4 plaka multiply overprint + tescil sapması + kanal blur) · Linocut (döner ızgara oyma segmentleri, doku kırılmaları) · Woodcut (anizotropik damar gürültüsü kalınlık kısıtı) · Paper Grain/Distress (iki ölçekli tane + lif + eskime + leke + çizik + kenar yıpranması, kaynak multiply) · Oil Paint/Impasto (eğri darbeler + impasto ışık/gölge kenarı + tuval dokusu) · Charcoal (sertlik üssü kaplama + pus + iki ölçekli tane + toz benekleri) — `67-ink-fx-effects3.js`: Stippling (önem örneklemeli dart atışı + mesafe ızgarası + kenar koruması) · Dry Brush (kıl profili paralel çizgiler + kırık kaplama) · Glitch Art (blok kaymaları + RGB displacement + tarama + gürültü) · Contour Extraction (Sobel/Laplacian + gerçek Canny: yön nicemleme + NMS + histerezis; **adaptif eşik**: raw mag p98 histogram referansı — yumuşak görsellerde otomatik yumuşar, Edge Sensitivity/Detail anlamlı kalır) · Posterization (ton+kroma seviyeleri, palet tonlaması, Bayer dither karışımı, kenar koruması) · Color Halation (parlaklık maskesi + çok geçişli yayılma + screen karışım) · yeni yardımcılar: `inkFxHexToRgb`, `inkFxSmoothstep`, `inkFxBoxBlurF32`, `inkFxClamp255` · test: `tests/fx-pipeline-test.js` 19/19 (registry 20/20 + smoke 19 efekt piksel+determinizm, contour cov 0→306 kenar pikseli), compositor 24/24, gates saf zincir yeşil, portable + Desktop SHA256 eşit + verify-package yeşil)
- [x] Faz 4 finalize TAMAMLANDI (`68-ink-fx-data.js`: INK_FX_GROUPS 20 efekt × 3 collapsible bölüm + INK_FX_PRESETS 20 efekt × 3–4 built-in (kısmi override → şema varsayılanlarıyla TAM konfigürasyon) · `69-ink-fx-ui.js`: Katmanlar paneli içinde `#inkFxSection` + `+ FX` butonu, Effect Browser 3 kategori/isim araması/20 GERÇEK önizleme (64×48 örnek raster + `def.apply` çıktısı, `inkFxRng(0x5eed)` sabit seed), tek bağlamsal inspector (slider+numerik eşzamanlı, dropdown/renk/toggle/angle), ortak Opacity/Blend/Visibility/Reset Parameters/Reset All/Enable-Disable, stack satırları (yukarı/aşağı/çoğalt/sil), preset Save/Load/Delete/Restore Defaults + IndexedDB `meta/ink:fx-presets` · `31-ink-ui.js` inkSyncLayersPanel kancası · `index.html`/`style.css` markup+stil · düzeltmeler: grup verisi `[label,...keys]` ayrıştırma, range↔number partner seçicisi tersliği, Ink Bleed keskin katman tam opak çizilip tüm parametreleri görünmez bırakıyordu → bleedAmount'a bağlı opaklık, Dithering presetleri `colorMode:'color'` olmadan paleti eziyordu, Contour "Clean Line" varsayılanla birebir aynıydı, Colored Pencil preset strokeDensity min altı · test: `tests/fx-pipeline-test.js` 27/27 (Faz 4 kontrolleri 19–26 dahil), compositor 24/24, gates 12/12 yeşil, portable + Desktop SHA256 eşit + verify-package PAKET GÜNCEL)
- [x] Faz 5 testler + tam batarya TAMAMLANDI (tam batarya: smoke ✓ · ink-smoke 233/233 · layer-canon 23/23 · layer-store 43/43 · layer-dispose 17/17 · layer-flip-fold 14/14 · compositor 24/24 · fx-pipeline 30/30 · gates 12/12 · portable + Desktop SHA256 eşit + verify-package PAKET GÜNCEL · kalıcılık testi: `createStateSnapshot` → `restoreSnapshot` gerçek disk hattı fx tür/params/opaklık/seed birebir · **parametre taraması**: 20 efektin TÜM parametreleri çıktıyı değiştiriyor (dekoratif kontrol yok) — bu sırada bulunan gerçek kusurlar kapatıldı: CA `edgeFalloff` boolean kapıydı → sürekli üs, Contour `transparentBackground` tek başına etkisizdi + `bgColor` bağımsızdı → opak zemin/renk, Dithering `palette=gameboy/cga/gray4` `colorMode=mono` yüzünden yok sayılıyordu + hata yayılımı renk modunda monoya düşüyordu + `numColors` mono'da işlevsizdi → sabit paletler kendi rengini dayatır, renk modu kanal bazlı hata yayılımı, levels mono nicemleme · **bağımlı parametre altyapısı** (`64-ink-fx.js`: `inkFxParamVisible` + `inkFxParamIsController`, `when: {key,in/is/neq/gte/lte, all/any}`) → Halftone Dot Rotation (circle'da gizli), Risograph Ink 3/4 (inkCount'a bağlı), Dithering numColors/patternScale/colorMode, Glitch displacement eksenleri, Contour bgColor · inspector `data-param-row` + `inkFxUiRefreshVisibility` ile sürükleme kesmeden anında göster/gizle · testler: fx-pipeline 29–30 yeni kontroller)
- [x] Faz 5 ek · sürükleme önizlemesi (spec Bölüm 7-C) TAMAMLANDI (`64-ink-fx.js`: `inkFxPreviewBegin/End/Active` + `INK_FX_PREVIEW_SCALE=0.35`, 400ms güvenlik penceresi; aşama önbelleği `fxId@WxH` anahtarına geçti → önizleme ile tam çözünürlük çakışmıyor; `inkFxSyncItem` önizleme sırasında girdiyi 0.35 ölçekte işleyip ekran kanvasına tam boy geriyor; `inkFxExportDraw` HER ZAMAN tam çözünürlük — ekran=export korunur · `69-ink-fx-ui.js`: range `input` → önizleme başlat, `change` (bırakma) → önizleme bitir + anında tam çözünürlük; yapısal değişiklik/undo `inkFxChanged` önizlemeyi kapatır · bench 1600×1200 + oil-paint/watercolor/paper-grain: tam **734ms** vs önizleme **105–171ms** → **5.3×** hız · test: fx-pipeline **31/31** (kontrol 31: önizleme aşaması `112x84`, bırakınca `320x240`, ekran boyu sabit), compositor 24/24)
  - **DÜZELTME (18 Kasım 2026, tur 5):** 0.35 ölçekli önizleme kaldırıldı. Piksel tabanlı parametreler ve piksel başına tüketilen deterministik RNG ölçekle değiştiği için sürüklerken görünen ile bırakınca oluşan sonuç bambaşkaydı (blok/gökkuşağı artefaktları). Yeni sözleşme: önizleme de tam çözünürlükte hesaplanır, yalnız kare sıklığı ~80 ms ile sınırlanır (`inkFxPreviewShouldSkip` + gecikmeli kuyruk karesi); atlanan karede son hesaplanan raster (`inkFxRuntime.lastRaster`) basılır. `inkFxPreviewSize`/`INK_FX_PREVIEW_SCALE`/`INK_FX_PREVIEW_MAX` silindi. Test: fx-pipeline **53/53** — önizleme aşaması `fx_prev@320x240` (düşük ölçek yok), bırakınca piksel farkı **0**.
- [x] FX görsel kabul turu TAMAMLANDI (`tests/fx-visual-qa.js` + `npm.cmd run qa:fx`: 20 efekt × varsayılan + 65 built-in preset gerçek `def.apply` çıktısıyla 3 kontakt sayfası → `docs/fx-qa/fx-{printmaking,traditional,experimental}.png`; otomatik kontroller: boş çıktı / preset=varsayılan / determinizm → **0 hata**; gözle inceleme sonrası 3 preset iyileştirildi: Risograph "Two-Color Print" varsayılan paletle aynı görünüyordu → mavi+sarı mürekkep, Contour "Sketch Contour" neredeyse görünmezdi → eşik/smoothing ayarı (cov 801→16263), Stippling "Bold Pointillism" dotları birleşip siyaha dönüyordu → yoğunluk/boyut dengelemesi)
- [x] Faz 4 ek · efekt sırası sürükle-bırak TAMAMLANDI (`69-ink-fx-ui.js`: `inkFxUiMoveTo` + satır `draggable`, `dragstart/dragover/drop/dragend` delegasyonu; bırakma noktası satırın üst/alt yarısına göre "önüne/arkasına" çözülür, listenin boş alanına bırakma en sona taşır; sürüklenen efekt seçili kalır; `pushUndo` + `inkFxChanged` → tek undo adımı; kendi üstüne bırakma no-op; `style.css` `.inkLayerRow[draggable]`/`.is-dragging`/`.is-drop-above`/`.is-drop-below` görsel geri bildirimi (katman satırlarına da yarar) · GERÇEK HATA: `draw-v5.js` katman-sürükleme dinleyicisi panel gövdesinde capture fazında `stopPropagation` yapıp `data-layerId` taşımayan FX satırlarının dragstart'ını yutuyordu → FX satırları bu dinleyiciden muaf tutuldu · test: fx-pipeline **32/32** (kontrol 32: alt/üst/boşluk bırakma, DOM sırası = veri sırası, undo tek adım + snapshot doğru, kendi üstüne bırakma sırası/undo'yu değiştirmiyor, işaretler temizleniyor))
- [x] Faz 4 ek · FX bölümü çizim modundaki v5 Katmanlar panelinde TAMAMLANDI (GERÇEK HATA: çizim modunda görünen Katmanlar paneli draw-v5.js tarafından kuruluyor; FX bölümü eski (gizli) dock panelinde kaldığı için arayüzden erişilemiyordu, kullanıcı + FX düğmesini göremiyordu → 69-ink-fx-ui.js inkFxUiMountV5Layers bölüm düğümünü #v5LayerScroll gövdesine taşır (dinleyiciler düğüm kimliğine bağlı olduğu için taşınmadan etkilenmez), inkSyncFxPanel her senkronda yeniden bağlar; draw-v5.js Layers başlığına FX düğmesi (#v5BtnInkAddFx → inkFxUiOpenFromV5) eklendi; draw-v5.css .v5-layers-body .inkFxSection v5 tokenlarıyla biçimlendirildi; EFFECTS satırı kapalıyken de görünür kalır · test: fx-pipeline **33/33** (kontrol 33: bölüm v5 gövdesinde, gizli değil, özet satırı görünür, eski düğme görünmez, FX düğmesi tarayıcıyı açar 20 kart, efekt eklenince stack/DOM/sayaç 1))
- [x] Faz 6 · Layer/FX sekmeleri + çizim tuvalinde efekt TAMAMLANDI (GERÇEK HATA 2: efekt eklendiğinde tahta katmanı değişiyordu ama ÇİZİM EDİTÖRÜ yalnız taban+katmanları çiziyordu; inkEditorRender FX zincirini hiç çağırmıyordu → 36-ink-editor.js içine inkFxEditorRaster (inkFxInputRaster + inkFxApplyChain) eklendi, FX etkinken nihai raster basılır, karo/çip yolları askıya alınır (tileFxSuspended), vuruş sürerken canlı kalem için normal katman yolu korunur · 64-ink-fx.js inkFxChanged ve 69-ink-fx-ui.js inkFxUiTouch artık inkEditorInvalidate çağırır · ARAYÜZ: ayrı EFFECTS bölümü ve başlık FX düğmesi kaldırıldı; draw-v5.js Katmanlar gövdesine Layers / FX sekmeleri eklendi (#v5LayersView, #v5FxView, #v5FxHost), FX sekmesi efekt yığını + 20 kart tarayıcı + parametre inspector görünümünü gösterir, Layers sekmesi listeyi geri getirir; görsel seçili değilken .v5-fx-empty yönlendirmesi · draw-v5.css sekme/FX görünümü stilleri · test: fx-pipeline 34/34 (kontrol 33: sekmeler, gizli eski düğme, 20 kart, efekt ekleme, geri dönüş; kontrol 34: çizim kanvası piksel farkı önce 42 → sonra 66.1 ortalama, 432 örnekten 132 değişti))

- [x] Faz 6 ek · çizim + efekt güvenilirlik turu TAMAMLANDI (GERÇEK HATA 3: tahtada FX kanvası HİÇ oluşmuyordu — `29-ink-render.js` `inkSyncItem`/`inkSyncDom` birleşik düzlemi yalnız `clip` koşulunda çağırıyordu; artık FX etkinken de çağrılır ve efekt kapanınca bayat `.inkFxCanvas` kaldırılır · GERÇEK HATA 4: çizim editörünün commit yolu (`36-ink-editor.js` `inkEditorCommitStroke`) katman neslini/FX önbelleğini tazelemiyordu → efekt açıkken kalem kalkınca vuruş FX girdisine girmiyor, çizim "kayboluyordu"; commit sonunda `inkBumpLayerGen` + `inkFxInvalidate` + `inkSyncDom` + `inkEditorInvalidate` (tahta yolu `30-ink-tools.js` `inkAfterCommitRaster`, worker bitişinde) · undo/redo: `inkFxInputSig` artık katman boya dönemini (`inkPaintEpoch`) de anahtara katar → undo vuruşu efektten çıkarır, redo birebir geri getirir · KULLANICI İSTEĞİ "referans fotoğraf seçip çizim yap" → Layer 1 = fotoğraf (`inkLayerBakePhoto`: boş bağlı katmana fotoğraf pişirilir, `photoBakeSig`; kullanıcı vuruşu ve birleştirme bake'i ezilmez; FX girdisi çifte fotoğraf basmaz) · test: fx-pipeline **41/41** (35: FX girdisi fotoğrafı içerir; 36: posterization siyahı korur; 37: FX açıkken canlı vuruş→commit→undo; 38: FX kapatma overlay+katman görünürlüğü; 39: art arda iki vuruş + tahtadaki FX kanvası vuruşları taşır; 40: undo→redo piksel birebir; 41: "çizim yap" sonrası Layer 1 = fotoğraf, FX fotoğrafı işler, FX kapanınca ham fotoğraf korunur) · tam batarya: smoke ✓ · ink-smoke 233/233 · layer-canon 23/23 · layer-store 43/43 · layer-dispose 17/17 · layer-flip-fold 17/17 · compositor 24/24 · qa:fx 20 efekt/65 preset 0 hata · portable ✓ (115.148.500 bayt) + Desktop SHA256 eşit (`6ED058E2…05F1DEBC`) + verify-package PAKET GÜNCEL + gates 12/12)
- [x] Faz 4 ek · FX paneli insan QA turu (localhost:8787'de gerçek tıklama/sürükleme) TAMAMLANDI — 6 gerçek kusur kapatıldı:
  1) panel başlıklarındaki aç/kapa üçgeni bozuk kodlamayla (`â–¾`) yazılıydı → CSS ile çizilen üçgen
  2) efekt eklenince inspector listenin altına kaçıyor, "Layers | FX" sekmeleri ekrandan çıkıyordu → bölüm sırası summary→stack→inspector→browser + `inkFxUiRevealInspector` yalnız sekmeleri görünür tutacak kadar kaydırır (test 43)
  3) parametre etiketleri ayırt edilemiyordu (5× "Pigment D…") → benzersiz kısa etiketler (test 43)
  4) efekt eklerken tüm zincir baştan hesaplanıyordu → aşama (stage) önbelleği korunur, yalnız yeni aşama ve sonrası hesaplanır; önceki efektlerin `apply` çağrısı 0, önbellek çıktısı taze hesaba piksel birebir (test 42)
  5) arama boş sonuç verince panel çöküyordu → "No effects match this search." + kartların geri gelmesi (test 43)
  6) 8+ efektde yeni eklenen satır listenin altında kalıyordu (panel her senkronda listeyi `replaceChildren` ile kurup `scrollTop`'u sıfırlıyordu) → kaydırma konumu korunur; ekleme/seçme/sıralama sonrası seçili satır görünür alana alınır (`inkFxUi.revealSel` bayrağı sayesinde kullanıcı listeyi kaydırırken panel seçili satıra zıplamaz) (test 44)
- [x] Faz 4 ek · FX etkileşim denetimi (insan gibi sürükleme/tıklama) TAMAMLANDI — 3 kusur daha:
  · slider sürüklemesi 700 ms'lik zaman penceresiyle birden çok undo kaydı bırakıyordu (1.2 sn'lik sürükleme = 2 kayıt, 3 sn'lik = 4-5) → pointerdown'da niyet işaretlenir, ilk `input`ta TEK `pushUndo`, `change` (bırakış) kilidi açar; değer değişmeyen tıklama kayıt bırakmaz (test 45)
  · sayı girişi kırpılan (clamp) değeri kutuya geri yazmıyordu: "0.5" yazan kullanıcı kutuda 0.5 görürken modelde min (2) kalıyordu → uygulanan değer hem number hem range partnerine yazılır (test 47)
  · hazır ayar etiketi efekt TÜRÜNE bağlıydı: aynı türden ikinci efekt, birincinin uyguladığı preset'i "uygulanmış" gösteriyordu → `lastPreset` artık `fx.id` + tür ile anahtarlanır; özel preset silinince boş tür anahtarı haritadan düşer (test 46)
  · ayrıca doğrulandı: blend/opaklık/görünürlük, preset uygula-kaydet-sil, arama filtresi açıkken efekt ekleme, iki görselde ayrı FX yığını, tahta `.inkFxCanvas` = editör rasterı **piksel birebir** (tam boy 1654×1800: diff 0 / 2.977.200 örnek; 96×72 örneklemede de 0), çizimden çıkıp yeniden girince aynı piksel, 20 kart önizlemesi ilk kurulum 104 ms / önbellekli 1 ms
  · test: fx-pipeline **47/47**
- [x] Kapı zinciri onarımı · `symmetry-test.js` 14/16 kırmızıydı; neden ÜRÜN HATASI DEĞİL: "Çizim yap" turunda Layer 1'e fotoğraf pişirildiği için katman opak, test ise "temiz" ölçütünü hâlâ `alfa < 24` ile arıyordu (opak fotoğraf katmanında imkânsız; `far=255` "sızma" sanılıyordu). Test artık vuruştan ÖNCEKİ renge göre fark (AE) ölçüyor: ayna iki tarafta boyandı (AE 334/334), ayna dışı sızma yok (farAe 0), tek undo klonu söktü ve pikseller baseline'a döndü (AE 0/0) → **16/16**
- [x] Faz 4 ek · FX paneli insan QA turu 2 (localhost:8787, gerçek tıklama/sürükleme/klavye) TAMAMLANDI — 6 gerçek kusur + 1 a11y boşluğu:
  · opaklık slider'ının kendi `pointerdown` dinleyicisi + section'ın "ilk input" kilidi aynı sürüklemeye **iki** undo kaydı bırakıyordu (bir Ctrl+Z boşa gidiyordu) → fazladan dinleyici kaldırıldı (tek sürükleme = 1 kayıt)
  · sayı girişinde ok tuşu her basışta ayrı kayıt (3 basış = 3 Ctrl+Z), renk seçicide canlı `input` akışı onlarca kayıt, onay kutusu `input`+`change` ile 2 kayıt bırakıyordu → sayı/renk 700 ms birleştirme penceresi (her input pencereyi tazeler; renk diyaloğu açık kaldığı sürece tek adım), toggle yalnız `input`ta uygulanır; kırpılan değer mevcut değere eşitse hiç kayıt yok (test 48)
  · koşullu parametre satırları `hidden` olsa da görünüyordu: satırın kendi `display:grid` kuralı UA'nın `[hidden]{display:none}` talimatını eziyordu → "Dot Shape = circle" iken uygulanmayan "Dot Rotation" ekranda kalıyordu; `#inkFxInspector [hidden]{display:none!important}` (test 30 + 49)
  · bu turda benim regresyonum: `change` dalında `inkFxUiSetParam` satırı düşmüştü → dropdown değişiklikleri modele yazılmıyordu; mevcut test 30 yakaladı, geri eklendi; test 49 artık açılır listeyi ve gerçek `display` gizlemesini doğruluyor
  · preset etiketi elle parametre değişince temizlenmiyordu (select hâlâ "Classic Comic" gösteriyordu) → `inkFxUiSetParam` etiketi sıfırlar; panel tamamen yeniden kurulmaz (slider sürüklemesi kesilmez) (test 49)
  · a11y: FX satırları yalnız fareyle seçilebiliyordu → satır `tabIndex=0`, Enter/Space seçer, panel yeniden kurulunca odak yeni satıra taşınır, `:focus-visible` çerçevesi; göz/↑/↓/× düğmelerine `aria-label`/`aria-pressed`; işlem sonrası odak aynı düğmeye döner (test 49)
  · doğrulananlar: tahta FX kanvası = **export çıktısı piksel birebir** (3840×2160 item, 8.294.400 piksel, diff 0), saydam PNG'de alfa korunur (köşe alfa 0), özel preset reload sonrası IndexedDB'den geri gelir ve uygulanır (dotSize 33), kopyalama FX yığınını derin klonlar (kaynak etkilenmez), sürükle-bırak sıralama + tek undo, undo paneli tazeler (model + input eşleşir), FX zinciri reload sonrası deterministik (aynı raster imzası)
  · bilinen darboğaz (18 Kasım 2026 tur 6 güncellemesi): su rengi/charcoal ekleme anlık blok üretebilir; önizleme 720 px'e küçültülmüyor (piksel parametreleri + RNG ölçekten etkilendiği için sonuç bırakışla uyuşmuyordu). Bunun yerine tam çözünürlüklü zincir, **son ölçülen zincir süresi × 1.1** (80–400 ms) aralığıyla tazelenir; ağır zincirde ara kareler atlanır, son değer gecikmeli boyanır. Aşama önbelleği sayesinde yalnız değişen efekt yeniden hesaplanır. Tur 6'da ölçülen kazanç (`fx-bench-probe.js`, en iyi 3): Watercolor 1600×1200 372→303 ms, 4K 1671→1424 ms; Ink Bleed 349→189 ms, 4K 1668→986 ms; Charcoal 216→140 ms. Efekt içi geçici diziler `(w,h)` kuşağına bağlı LRU havuzdan (768 MB üst sınır, alımda sıfır dolgu) beslenir; aşama/girdi tuvalleri `clearRect` ile geri dönüştürülür; tam kare `createImageData`+`set` kopyası kaldırıldı. Parite: `fx-hash-probe` 20/20 piksel parmak izi tam, fx-pipeline **53/53** · test: fx-pipeline **53/53**
- [x] Faz 4 ek · FX paneli insan QA turları 3–4 (aynı gün, canlı tıklama/klavye; tur 4: rastgele ayar/ilk kullanıcı keşfi) TAMAMLANDI — 11 arayüz/davranış kusuru + 2 bellek sızıntısı + küçük a11y/dil düzeltmeleri:
  · koşullu parametre satırları `hidden` olsa da ekranda kalıyordu: satırın kendi `display:grid` kuralı UA'nın `[hidden]{display:none}` talimatını eziyordu → \"Dot Shape = circle\" iken uygulanmayan \"Dot Rotation\" görünüyordu; `#inkFxInspector [hidden]{display:none!important}` (test 30 + 49)
  · açılır liste değişikliği modele yazılmıyordu (change dalında `inkFxUiSetParam` satırı düşmüştü — bu turda benim regresyonum); mevcut test 30 yakaladı, satır geri eklendi; test 49 dropdown'ı ve gerçek `display` gizlemesini doğruluyor
  · preset select etiketi parametrelerle tutarsız kalıyordu: elle değişiklikte, \"Reset Parameters\"ta ve Ctrl+Z sonrası hâlâ \"uygulanmış preset\" adı gösteriliyordu → etiket her panel kuruluşunda parametrelerle karşılaştırılır (`inkFxUiPresetMatches`), uyuşmazsa temizlenir (test 49)
  · a11y/odak: FX satırları yalnız fareyle seçilebiliyordu → satır `tabIndex=0`, Enter seçer, `:focus-visible` çerçevesi; göz/↑/↓/× düğmelerine `aria-label`/`aria-pressed`; göz/↑/↓ ve **silme** sonrası odak aynı/komşu satıra döner (liste boşsa FX sekmesine); Space bilinçli olarak kullanılmaz (çizim editöründe Space geçici kaydırma, odağı blur ediyor) (test 49)
  · çift tıklama iki efekti siliyordu: ilk tık satırı kaldırınca ikinci tık yukarı kayan bir sonraki efektin × düğmesine denk geliyordu → gerçek çift tık (`detail > 1`) yok sayılır (test 49)
  · **bellek sızıntısı**: silinen öğenin tam çözünürlüklü FX girdi + aşama tuvalleri `inkFxRuntime` Map'lerinde kalıyordu (4K FX öğesi başına ~100 MB, oturum boyunca birikiyordu) → `inkFxDisposeItem` (`64-ink-fx.js`) + `inkHandleItemsRemoved` kancası (`27-ink-core.js`); undo ile geri gelen öğe FX zincirini yeniden hesaplıyor (test 50)
  · görsel kapsamı değişince FX paneli tazelenmiyordu: A görseline efekt ekleyip çıkıp B'ye \"Çizim yap\" denince FX sekmesi açık kalıyor ve **A'nın efekt listesi** B'de görünüyordu (kontroller tepkisiz) → `modeEnterDraw` kapsam girişinde `inkSyncFxPanel` (test 51)
  · kapatılan parametre grubu panel yeniden kurulunca (göz/↑/↓, ekleme, undo) tekrar açılıyordu → grup durumu `inkFxUi.closedGroups` ile korunur (test 49); sayı kutusunun erişilebilir adı yoktu → `aria-label` (test 46)
  · seçili efekt satırına ikinci kez tıklamak hiçbir şey yapmıyordu: parametre panelinden çıkmak için başka efekt seçmek gerekiyordu → aynı satıra ikinci tıklama seçimi kaldırır (satır vurgusu gider, inspector \"Select an effect row…\" ipucuna döner), üçüncü tıklama yeniden seçer; Enter de aynı şekilde aç/kapa; seçim değişmediği için FX yeniden hesaplanmaz (test 49/52)
  · efekt tarayıcısında çift tıklama efekti **iki kez** ekliyordu (4K'da her ekleme ~1 s blokladığı için kullanıcı iki kez bekliyordu) → gerçek çift tık ikinci tıkı (`detail > 1`) yok sayar (test 52)
  · sıra uçlarındaki ↑ (ilk satır) / ↓ (son satır) düğmeleri etkin görünüp hiçbir şey yapmıyordu → `disabled` + `aria-disabled` (test 52)
  · parametre panelinde tek Türkçe metin (\"Şeffaf\") İngilizce arayüzde kalıyordu → \"Transparent\"; preset adı alanının erişilebilir adı yoktu → `aria-label`; efekt arama alanının da erişilebilir adı yoktu → `aria-label`, liste satırlarına `role=listitem`; \"Delete\" düğmesi kullanıcı preseti seçili değilken de etkindi (sessiz no-op) → yalnız `c:` seçiliyken etkin (test 52)
  · **bellek sızıntısı (efekt silme)**: son efekt silinince zincir hesabı hiç koşmadığı için `inkFxApplyChain`'deki aşama temizliği atlanıyor, silinen efektin aşama tuvali (2800 px'te ~17 MB) öğe kapanana kadar kalıyordu → `inkFxPruneStages` her yapısal değişiklikte (`inkFxChanged`), yığın boşken senkronda (`inkFxSyncItem`) ve FX DOM senkronunda (`inkSyncItem`, undo yolu) çalışır; kalan efektlerin önbelleği korunur (test 53)
  · doğrulananlar: undo sonrası geri gelen öğede FX zinciri yeniden kurulur (aşama/girdi yeniden üretilir, raster gelir), blend/preset/undo tek adım, Reset All tek kayıt · test: fx-pipeline **53/53**
