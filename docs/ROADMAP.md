# Roadmap

This roadmap is a statement of intent, not a schedule. Items move when they are
ready and tested. Nothing here is promised for a specific date.

## Current state

TailRef 1.4.1 is a Windows x64 desktop app with:

- a reference board, a drawing engine, a brush library with `.abr` import/export,
  layers and effects;
- a lazy-loaded 3D posing module;
- sandboxed Pinterest/ArtStation/YouTube Music panels;
- automatic and manual persistence with backups;
- themes, interface skins, UI packages and 10 UI languages;
- a 69-gate quality chain.

## Next

- **Finish ink-engine polish** — the remaining K16–K22 parity items tracked in
  [`INK_STATUS.md`](INK_STATUS.md).
- **Magic wand selection** — currently unimplemented; listed as a known gap.
- **Brush compatibility** — better mapping of Photoshop `.abr` dynamics that
  TailRef can represent, plus clearer reporting for ignored parameters.
- **Documentation** — keep the public docs and screenshots current as features
  change.
- **True vector brand mark (optional polish)** — the hand-drawn mark currently
  ships as a raster and `assets/tailref-mark.svg` wraps that PNG. A hand-traced
  vector would scale more cleanly. This is cosmetic, not a licensing issue (see
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)).
- **Localization completeness** — close the remaining gaps in the non-English
  locales.

## Considering

These are ideas under evaluation, not commitments:

- Code signing for release binaries (removes SmartScreen warnings).
- Code signing for the installer and executables.
- Optional native ink kernel enabled by default, if it proves stable and faster
  on typical hardware.
- More capture passes and export presets in Pose3D.
- Additional UI packages and themes contributed by the community.

## Not planned

- macOS or Linux release builds. The project targets Windows x64.
- Cloud sync, accounts, telemetry or an online service.
- A plugin API or third-party extension marketplace.
- Mobile or web builds.
- Paid tiers, subscriptions or ads.

## How to influence the roadmap

Open a feature request with the problem you want solved. Concrete workflows and
reproduction cases are far more useful than feature names. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
