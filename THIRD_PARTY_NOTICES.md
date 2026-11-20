# Third-Party Notices

TailRef itself — its original code, documentation and artwork — is
Copyright © 2026 Emre Melik Nameli and is distributed under the
[PolyForm Noncommercial License 1.0.0](LICENSE).

The components below are **not** owned by the TailRef author. Each one keeps its
own license. When you redistribute TailRef, keep these notices and the license
texts in [`docs/licenses/`](docs/licenses/).

## Runtime components

| Component | Version | License | Location / notes |
|---|---|---|---|
| Electron | 45.0.0 | MIT | `node_modules/electron`; `LICENSE.electron.txt` is shipped by electron-builder |
| Chromium | bundled with Electron 45 | BSD-3-Clause + third-party licenses | `LICENSES.chromium.html` is shipped by electron-builder |
| three.js | r170 | MIT | `src/renderer/vendor/three.module.js` and `vendor/**` (examples, postprocessing, shaders) |
| fflate | 0.8.2 | MIT | `src/renderer/vendor/libs/fflate.module.js` |
| SimplexNoise | three.js r170 example (`examples/jsm/math/SimplexNoise.js`) | MIT | `src/renderer/vendor/math/SimplexNoise.js` |

License texts: [`three.js-MIT.txt`](docs/licenses/three.js-MIT.txt),
[`fflate-MIT.txt`](docs/licenses/fflate-MIT.txt).

## Build-only tools

These are used to build and package the app; they are not shipped inside it.

| Component | Version | License |
|---|---|---|
| electron-builder | 26.18.0 | MIT |
| @electron/asar | via electron-builder | MIT |
| Pillow / NumPy | development only | HPND / BSD-3-Clause (used by `scripts/*.py` brand asset generation) |

## Fonts

| Font | Files | License | Copyright |
|---|---|---|---|
| Inter (variable, roman + italic) | `assets/fonts/InterVariable*.woff2`, mirrored in `src/renderer/assets/fonts/` | SIL Open Font License 1.1 | Copyright (c) 2016 The Inter Project Authors |
| Nunito Sans ExtraBold (800) | `assets/fonts/nunito-sans-extrabold-latin*.woff2`, mirrored in `src/renderer/assets/fonts/` | SIL Open Font License 1.1 | Copyright 2014-present The Nunito Sans Project Authors |

Full texts: [`Inter-OFL-1.1.txt`](docs/licenses/Inter-OFL-1.1.txt),
[`NunitoSans-OFL-1.1.txt`](docs/licenses/NunitoSans-OFL-1.1.txt).

The font names are used only to describe the fonts. They are not used as product
names, and no modified font is distributed under a reserved name.

## Brand assets

`assets/tailref_logo_*`, `assets/favicon-*`, `assets/tailref-mark.svg`,
`assets/logo-source/*`, `build/icon*` and `build/installer*` belong to
**Emre Melik Nameli** and are published under the **TailRef Studio** brand.
The software license does not grant trademark rights; see
[`TRADEMARK.md`](TRADEMARK.md).

`assets/logo-source/logo-paint-master.png` is the hand-drawn paint master for
the brand. It is not loaded by the application.

**Provenance.** The brand mark (the brush-tailed squirrel with red/green/blue
paint drops) is original artwork drawn by the copyright holder. The
AI-generated splash frames and the old splash logo were removed from the
repository on 2026-11-06; no AI-generated asset is distributed. The current
splash uses the hand-drawn brand mark: `src/renderer/splash.html` embeds the
same PNG that ships as `assets/tailref_splash_logo.png`.

`assets/tailref-mark.svg` is a small SVG wrapper around that PNG rather than a
true vector tracing. That is a cosmetic detail, not a licensing one: a
hand-traced vector would scale more cleanly and is listed as optional polish in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Removed third-party material

The following items were removed from the repository and the package and must
not be reintroduced without a verified license:

- **`ScaleReferenceDummy.fbx`** — third-party scale-reference model, removed
  2026-11-06. The default 3D pose reference is now generated in code by
  `src/renderer/pose3d/dummy/DummyRig.js`, which is original TailRef work.
- **AI-generated splash frames** (`splash-frames/*`, `splash.gif`) — removed
  2026-11-06. The splash is now a hand-written inline SVG animation in
  `src/renderer/splash.html`.
- **`build/ui-preview.png`** — a screenshot containing third-party artwork of
  unknown license. Do not commit screenshots that contain art you do not own or
  license; use your own artwork for README and store images.

## Third-party code inside the source tree

- `vendor/three.module.js` keeps its MIT header
  (`Copyright 2010-2024 Three.js Authors`, `SPDX-License-Identifier: MIT`).
- `vendor/libs/fflate.module.js` keeps its MIT header and version.
- `vendor/FBXLoader.js`, `GLTFLoader.js`, `OBJLoader.js`, `RGBELoader.js`,
  `OrbitControls.js`, `TransformControls.js`, `OutlineEffect.js`,
  `BufferGeometryUtils.js`, `NURBSCurve.js`, `NURBSUtils.js` are three.js
  examples (MIT).
- `vendor/postprocessing/*` (`EffectComposer`, `Pass`, `MaskPass`, `RenderPass`,
  `ShaderPass`, `SSAOPass`, `BokehPass`, `OutputPass`, `GTAOPass`) and
  `vendor/shaders/*` (`CopyShader`, `OutputShader`, `SSAOShader`, `BokehShader`,
  `GTAOShader`, `PoissonDenoiseShader`) are three.js examples (MIT).

## Verified

- **SimplexNoise.js** is the three.js r170 example module
  `examples/jsm/math/SimplexNoise.js` (byte-identical apart from a local SPDX
  header and the module export line), so it is covered by the three.js MIT
  license above. Verified against the upstream file on 2026-11-20.
- `package-lock.json` contains only npm registry URLs; no local paths or
  credentials.
- Dependency advisories are reviewed with `npm audit --omit=dev` in CI
  (informational, not blocking).
