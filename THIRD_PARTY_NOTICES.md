# Third-Party Notices

TailRef itself — its original code, documentation and artwork — is
Copyright © 2026 Emre Melik Nameli and is distributed under the
[GNU General Public License, version 3 or later](LICENSE)
(SPDX: `GPL-3.0-or-later`).

The components below are **not** owned by the TailRef author and are **not
relicensed** under the GPL. Each one keeps its own license. When you
redistribute TailRef, keep these notices and the license texts in
[`docs/licenses/`](docs/licenses/).

## GPL compatibility

The third-party licenses in this project are compatible with distributing the
components alongside GPL-3.0-or-later software:

| License | Used by | GPL-3.0-or-later compatibility |
|---|---|---|
| MIT | Electron, three.js, fflate, SimplexNoise | Compatible (permissive) |
| BSD-3-Clause | Chromium | Compatible (permissive) |
| BSD-2-Clause, ISC | transitive build dependencies | Compatible (permissive) |
| Apache-2.0 | transitive build dependencies | Compatible with GPLv3 |
| SIL Open Font License 1.1 | Inter, Nunito Sans | Compatible; the font files stay under the OFL and are not relicensed as GPL |
| Mixamo / Adobe terms | Pose3D base models (`*.fbx`) | **Not verified** — see [Bundled 3D models](#bundled-3d-models--review-required); not relicensed under the GPL |
| ZBrush export | `female-base.obj` | **Provenance undocumented** — see the same section |
| Python-2.0, BlueOak-1.0.0 | build-only Python/npm tooling, not shipped | Compatible (permissive); not part of the distributed app |

No bundled software component is currently known to be incompatible with
GPL-3.0-or-later. The 3D model assets need a separate provenance and terms
review before a public release. The items that deserve a closer look before a
redistribution are listed under
[Review before redistribution](#review-before-redistribution).

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

## Bundled 3D models — review required

These files are shipped with the application but are **not** original TailRef
code and are **not** covered by the GPL. Their terms must be confirmed before a
public release:

| File | Marker found | Status |
|---|---|---|
| `src/renderer/assets/models/female-base.fbx` | `Mixamo, Inc.`, `mixamo.com`, `mixamorig:*` skeleton | Mixamo/Adobe asset. Not relicensed under the GPL. Confirm that the applicable Mixamo/Adobe terms allow redistribution in this form, or replace it with an original or clearly licensed model. |
| `src/renderer/assets/models/male-base.fbx` | `Mixamo, Inc.`, `mixamo.com`, `mixamorig:*` skeleton | Same as above. |
| `src/renderer/assets/models/female-base.obj` | `# www.zbrush.com` | ZBrush export marker. Provenance is undocumented; treat as unverified until the author confirms it is original or licensed. |

These models are optional Pose3D presets. The default mannequin used by the
app is generated in code by `src/renderer/pose3d/dummy/DummyRig.js`, which is
original TailRef work. Removing the three model files would change a documented
feature, so they are kept and flagged instead of being silently relicensed.

## Brand assets

`assets/tailref_logo_*`, `assets/favicon-*`, `assets/tailref-mark.svg`,
`assets/logo-source/*`, `assets/brand/*`, `assets/demos/*`, `assets/shots/*`,
`build/icon*` and `build/installer*` belong to **Emre Melik Nameli** and are
published under the **TailRef Studio** brand. They are distributed with the
application under GPL-3.0-or-later, but the GPL does not grant trademark rights
in the name or logo; see [`TRADEMARK.md`](TRADEMARK.md).

The files under `assets/demos/` and `assets/shots/` are captures of the
application and the author's own artwork. They are not third-party material.
When adding new captures, do not include reference images or artwork that you do
not own or license.

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

## Review before redistribution

These items are not blockers for the GPL migration, but they should be checked
for the exact build you distribute:

- **Electron / Chromium.** Ship the `LICENSE.electron.txt` and
  `LICENSES.chromium.html` files that electron-builder produces, and keep them
  next to the application. Chromium contains third-party components with their
  own notices; the generated Chromium license file is the authoritative list for
  the Electron version you ship.
- **Media codecs.** Review the codec and media components included in the
  Electron build you distribute. Their terms are separate from TailRef's GPL
  license.
- **Fonts.** Keep the OFL texts, and do not redistribute a modified font under a
  Reserved Font Name. The bundled fonts are unmodified.
- **Brand assets.** The TailRef logo and wordmark are original artwork owned by
  the copyright holder. They are not third-party material, and the GPL does not
  grant trademark rights; see [`TRADEMARK.md`](TRADEMARK.md).
- **Build-only tools.** electron-builder, Pillow and NumPy are used to build the
  app and are not shipped inside it. Their licenses do not affect the
  distributed application, but keep their notices if you redistribute a build
  environment.

## Verified

- **SimplexNoise.js** is the three.js r170 example module
  `examples/jsm/math/SimplexNoise.js` (byte-identical apart from a local SPDX
  header and the module export line), so it is covered by the three.js MIT
  license above. Verified against the upstream file on 2026-11-20.
- `package-lock.json` contains only npm registry URLs; no local paths or
  credentials.
- Dependency advisories are reviewed with `npm audit --omit=dev` in CI
  (informational, not blocking).
