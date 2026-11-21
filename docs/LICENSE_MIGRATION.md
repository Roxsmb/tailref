# License Migration — PolyForm Noncommercial → GPL-3.0-or-later

Date: **2026-11-21**

This document records the repository-wide relicensing of TailRef. It is a
maintainer record, not legal advice. The authoritative license is the text in
[`LICENSE`](../LICENSE); the authoritative summary for users is
[`LICENSE-FAQ.md`](../LICENSE-FAQ.md).

## 1. Result

| Item | Value |
|---|---|
| License | GNU General Public License, version 3 or later |
| SPDX identifier | `GPL-3.0-or-later` |
| Copyright holder | Emre Melik Nameli |
| Publishing name | TailRef Studio (a brand, not a legal entity) |
| License text | Verbatim GPL-3.0 from <https://www.gnu.org/licenses/gpl-3.0.txt> |
| Commercial use | Permitted under the GPL |
| Redistribution and sale | Permitted under the GPL |
| Contribution policy | Inbound = outbound; no CLA, no copyright assignment |

The `LICENSE` file contains the unmodified official GPL-3.0 text. The
"or later" choice is declared in `NOTICE`, `README.md`, `package.json`
(`"license": "GPL-3.0-or-later"`), `LICENSE-FAQ.md` and `CONTRIBUTING.md`.
Keeping the license text verbatim is what lets GitHub and other tools detect
GPL-3.0 reliably.

## 2. What changed

### License and metadata

- `LICENSE` — replaced the PolyForm Noncommercial 1.0.0 text with the complete
  official GPL-3.0 text (35,149 bytes).
- `package.json` — `license` is now `GPL-3.0-or-later`; the description no
  longer says "source-available"; the packaged files now include
  `LICENSE-FAQ.md` and `TRADEMARK.md`.
- `package-lock.json` — root `license` field updated to `GPL-3.0-or-later`.

### User-facing licensing documents

- `NOTICE` — GPL notice, warranty disclaimer, ownership, source availability,
  contribution policy, contact.
- `LICENSE-FAQ.md` — rewritten for GPL: commercial use, selling, forks,
  hosting, plugins, third-party components, contributions, older releases,
  termination and warranty.
- `README.md` — license badge, one-line summary, installation note, support
  text, FAQ, contributing section, license section and credits.
- `CODE_OF_CONDUCT.md` — license reference updated.
- `TRADEMARK.md` — branding policy separated from the GPL; forks are explicitly
  allowed under the GPL; trademark rules no longer imply noncommercial limits.
- `THIRD_PARTY_NOTICES.md` — GPL statement, compatibility table and a
  "Review before redistribution" section.
- `CONTRIBUTING.md` — inbound = outbound policy, no CLA, no copyright
  assignment, SPDX guidance, and a note for pre-migration contributors.
- `docs/CLA.md` — retired and moved to
  [`archive/CLA-draft-retired.md`](archive/CLA-draft-retired.md). It was a draft
  and was never in effect.
- `docs/README.md` — CLA row replaced with this document.
- `docs/PROJECT_AUDIT.md` — historical licensing findings marked as superseded.
- `docs/RELEASE.md`, `docs/RELEASE_CHECKLIST.md` — GPL source-availability
  checks for releases.
- `docs/DEVELOPMENT.md` — SPDX header convention for new files.
- `src/renderer/index.html` — About text and the two copyright lines now say
  "free and open source", "GPL-3.0-or-later" and name Emre Melik Nameli as the
  copyright holder.
- `CHANGELOG.md` — new Unreleased entry; the older PolyForm entry is marked as
  historical.
- `.github/FUNDING.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`,
  `.github/pull_request_template.md` — noncommercial/source-available wording
  removed.

## 3. Restrictions removed

The following statements are no longer part of the project's licensing:

- "Commercial use requires written permission."
- "Commercial distribution and commercial licensing require prior written
  permission."
- "You may not sell it, sell modified versions, or charge for access."
- "Noncommercial modification" and "noncommercial redistribution" as the only
  permitted purposes.
- "TailRef is source-available, not unrestricted open-source software."
- The PolyForm "Required Notice" line and the "All Rights Reserved" copyright
  line in the licensing documents.
- The CLA/relicensing requirement for contributions.
- The 32-day PolyForm cure period (GPLv3 section 8 now applies).

## 4. Third-party components

Third-party components were **not** relicensed. They keep their original
licenses and notices. See [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Summary of compatibility:

- MIT (Electron, three.js, fflate, SimplexNoise) — GPL-compatible.
- BSD-3-Clause (Chromium) — GPL-compatible.
- BSD-2-Clause, ISC, Apache-2.0 — GPL-compatible; mostly build-only.
- SIL OFL 1.1 (Inter, Nunito Sans) — the fonts stay under the OFL; they are
  aggregated with TailRef, not relicensed as GPL.
- Mixamo/Adobe FBX models (`female-base.fbx`, `male-base.fbx`) and the
  ZBrush-exported `female-base.obj` — provenance and terms require review; they
  are not covered by the GPL. See the dedicated section in
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md#bundled-3d-models--review-required).
- Python-2.0 and BlueOak-1.0.0 — build-only tooling, not shipped.

No bundled software component is known to be incompatible with
GPL-3.0-or-later. The 3D model assets are an open item, not a settled one.

## 5. Trademark and branding

The GPL does not grant trademark rights. The TailRef name, wordmark and logo
remain governed by [`TRADEMARK.md`](../TRADEMARK.md). The policy:

- allows forks and redistribution under the GPL;
- requires modified distributions to use a different name or be clearly marked
  unofficial;
- does not add restrictions to the GPL's grant of rights in the code.

GPLv3 section 7 expressly permits a licensor to decline trademark rights for
some names and marks, so this separation is compatible with the license.

## 6. Legal considerations and open questions

1. **Authority to relicense.** The copyright holder can relicense code he owns.
   Before publishing, confirm that every file in the repository was written by
   Emre Melik Nameli or is third-party material covered by its own license. If
   an outside contribution exists, its author must agree to GPL-3.0-or-later;
   do not assume permission.
2. **Previously distributed copies.** Copies released under PolyForm
   Noncommercial 1.0.0 remain governed by those terms for those copies. The GPL
   applies to the current source tree and to future releases. The FAQ states
   this explicitly.
3. **Prior contributions.** The CLA was a draft and was never in effect, so no
   contribution was accepted under a relicensing grant. The CONTRIBUTING.md
   policy asks pre-migration contributors to contact the maintainer if they do
   not agree to the new license.
4. **GitHub detection.** GitHub detects GPL-3.0 from the verbatim license text.
   The "or later" part is not visible in the license text itself, so it is
   declared in `package.json` and the project notices. This is the same
   approach used by many GPL-3.0-or-later projects.
5. **Source distribution.** GPLv3 section 6 requires Corresponding Source when
   binaries are conveyed. The official release process now checks that the
   matching Git tag is pushed and the source archive is downloadable.
6. **Electron/Chromium notices.** Ship `LICENSE.electron.txt` and
   `LICENSES.chromium.html` with the build, and review the media codec terms for
   the Electron version you distribute. These are third-party obligations, not
   TailRef licensing changes.
7. **No legal review.** This migration was performed by the project maintainer,
   not by a lawyer. A legal review is recommended before relying on it in a
   commercial dispute.
8. **Mixamo/ZBrush 3D models.** `female-base.fbx` and `male-base.fbx` contain
   Mixamo/Adobe metadata, and `female-base.obj` is a ZBrush export. Their
   redistribution terms are not documented in the repository. They are not
   relicensed under the GPL. Before a public release, confirm the applicable
   terms or replace them with original or clearly licensed models. This is the
   main unresolved third-party issue in the migration.

## 7. Verification checklist

- [x] `LICENSE` is the complete official GPL-3.0 text.
- [x] `package.json` and `package-lock.json` declare `GPL-3.0-or-later`.
- [x] README, LICENSE, LICENSE-FAQ, NOTICE, TRADEMARK and CONTRIBUTING agree.
- [x] No active document claims noncommercial-only use or "source-available".
- [x] Third-party notices preserved and compatibility documented.
- [x] No CLA is required.
- [x] Application code, UI behaviour, rendering and project formats were not
      changed.
- [x] Project tests and the documentation-link gate pass.
- [ ] Maintainer review of the final diff.
- [ ] Confirm authorship of every file before the public release.
- [ ] Resolve the Mixamo/ZBrush 3D model terms before the public release.
