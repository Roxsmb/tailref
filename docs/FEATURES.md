# Features

This page lists what TailRef actually does today. If a feature is experimental
or incomplete, it is marked as such. Nothing here is a promise about future
releases.

## Reference board

- Infinite pannable/zoomable canvas for reference images.
- Drag-and-drop import, clipboard paste, multi-file import.
- Move, scale, rotate, crop and arrange images.
- Automatic grid and stack layouts; align and distribute.
- Groups, locking, z-order, duplicate, delete.
- Text notes and link items.
- Trash with restore, plus a separate trash panel.
- Background, grid and zoom controls.
- Image inspector and palette extraction from an image.

## Drawing (ink engine)

The built-in editor lives in a separate workspace mode, so the reference board
and the canvas can be used in the same session.

Tools:

- Brush, pencil, eraser
- Paint bucket (tolerance-based fill)
- Gradient with multi-stop editor
- Smudge
- Liquify
- Shapes: arrow, rectangle, ellipse, highlighter
- Rectangular and lasso selection
- Move / transform with numeric HUD
- Text note
- Eyedropper

Drawing behaviour:

- Pressure and tilt support where the tablet/driver provides it.
- Stabilizer/smoothing, spacing ("tightening") and hardness controls.
- Brush size, opacity and flow controls in the options bar.
- Symmetry drawing.
- Shape snapping (straight lines, angles, circles) while drawing.
- Radial tool menu.
- Undo/redo with region-aware history.
- Tile-based canvas with worker-assisted region processing.
- Optional GL dab path; falls back to Canvas2D when unavailable.

Layers:

- Add, delete, duplicate, reorder, rename.
- Visibility, lock, opacity, blend modes.
- Layer masks and mask editing.
- Layer groups/folders and flip/fold operations.
- Per-layer transform and selection operations.

Post-processing (FX):

- A stack of canvas effects with a dedicated FX panel, presets and
  before/after preview. Effects are applied to the composed result, not baked
  into source layers.

## Brush library

- Built-in brushes plus custom brushes.
- Procedural brushes and brushes with PNG tips.
- Custom categories, favorites, search and rename.
- Per-brush size, hardness, opacity, spacing and smoothing.
- Import Photoshop `.abr` brush sets (RLE, 16-bit, legacy v1/v2 layouts).
- Export the library back to `.abr`.
- Library persists independently of projects and survives restarts.

Known `.abr` limits: the importer supports the brush/tip data TailRef can use
(tip shape, size, spacing, dynamics that map to TailRef parameters). Photoshop
features with no TailRef equivalent are ignored rather than approximated.

## Color

- Color wheel and palette.
- HSV/RGB/hex entry.
- Wide-gamut handling with perceptual round-trip checks.
- Alpha picker for gradient stops.
- Palette import/export through UI packages where supported.

## Pose3D

- Load FBX, GLTF/GLB and OBJ models, plus HDR environments.
- Built-in code-generated dummy rig for scale reference.
- Orbit/pan/dolly camera with Maya and Blender navigation schemes.
- Bone/IK posing with gizmos, pose library and pose history.
- Lighting rig and environment controls.
- Guides and HUD.
- Capture presets (1x/2x/4x, 4K, 8K) with beauty/alpha/depth/normal/wireframe
  passes, subject to `maxTextureSize`.
- Send a capture straight to the reference board.

The 3D module loads lazily; it does not slow down startup if you never open it.

## Panels

- **Pinterest** panel: browse and pin references inside the app, with a
  restricted session and login flow.
- **ArtStation** panel: same pattern for ArtStation.
- **YouTube Music** panel for background listening while you work.
- Panels can be docked or detached into their own always-on-top window.
- Guest pages are sandboxed and limited to their own domains.

## Projects and persistence

- Two save modes: automatic (IndexedDB + rotating JSON backups) and manual
  (`.tail` file via `Ctrl+S`).
- Atomic `.tail` writes (`TAIL` magic + version + deflate + JSON).
- Automatic backups in `%APPDATA%\TailRef\Backups\` (last 20 + a known-good
  copy).
- Project browser with thumbnails.
- Crash recovery prompt for an unhealthy previous session.
- Trash for board items.
- Import/export of the board as an image.

## Interface, themes and settings

- Light and dark themes, plus a theme studio for custom palettes.
- Interface skins (classic and an IRIX-inspired shell) independent of the
  theme.
- UI packages: validated bundles of tokens/styles that can be imported,
  applied, reloaded and removed.
- Floating/dockable panels, collapsible toolbar, compact modes.
- Settings hub with search, categories, reset-all and a save action.
- Accessibility options (reduced motion, focus visibility, contrast).
- Pomodoro timer and YouTube panel toggles.
- Central keymap with a searchable shortcut help overlay.

## Localization

The interface and native dialogs ship with 10 languages: English, Turkish,
German, French, Spanish, Japanese, Korean, Portuguese (Brazil), Russian and
Chinese (Simplified). Translation coverage is not identical everywhere; missing
strings fall back to English.

## Platform and packaging

- Windows x64 portable executable and NSIS installer.
- No installation required for the portable build.
- No telemetry, no auto-update, no network calls unless you open a panel.
- Data stays on the local machine.

macOS and Linux are **not** currently supported or planned as release targets.

## Known limitations

- **Magic wand** selection is not implemented.
- Some ink-engine polish items are still open; see
  [`INK_STATUS.md`](INK_STATUS.md).
- The native C++ ink kernel is optional and not enabled by default; the JS path
  is the reference implementation.
- Builds are **not code-signed**, so Windows SmartScreen may warn.
- Photoshop `.abr` import maps only the parameters TailRef supports.
- Translation coverage varies by language.
- No cloud sync, no collaboration, no plugin API.
