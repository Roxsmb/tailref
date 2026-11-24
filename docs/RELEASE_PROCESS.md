# Release process

TailRef Studio ships from GitHub Actions. A version tag starts the pipeline;
nothing is published until every job has passed. This document is the
maintainer-facing procedure. For the older Windows-only notes see
[`RELEASE.md`](RELEASE.md).

## Pipeline at a glance

`.github/workflows/release.yml` runs six jobs:

| Job | Runner | What it does |
|---|---|---|
| `prepare` | `ubuntu-22.04` | Validates the tag, `package.json` version and `CHANGELOG.md` section; detects prereleases |
| `test` | `ubuntu-22.04` | Installs from the lockfile, rebuilds the renderer, verifies it is committed, runs the pure gates, audits production dependencies, compiles the Linux native module |
| `windows` | `windows-latest` | Runs the full test suite, compiles the native module, builds NSIS + portable, verifies `app.asar`, `latest.yml` and `app-update.yml` |
| `linux` | `ubuntu-22.04` | Builds AppImage + deb + rpm, verifies `app.asar`, rejects Windows binaries in the payload, inspects package contents, installs and removes the deb, smoke-launches the AppImage under Xvfb |
| `macos` | `macos-15` (arm64) | Compiles the native module for arm64 and x64, builds one DMG per architecture, verifies `app.asar`, Mach-O architecture, `.tail` document type and the ad-hoc signature, mounts both images and launches the packaged app |
| `release` | `ubuntu-22.04` | Downloads all artifacts, confirms `latest-linux.yml` and `latest-mac.yml` are absent, writes `SHA256SUMS.txt`, generates release notes, creates the GitHub Release (a hidden draft on manual runs by default), re-checks the uploaded assets |

`release` needs all five previous jobs. A failed build or a failed verification
means no release is created.

## Version and changelog

The tag must be `v` + the exact `package.json` version: `v1.4.4` for
`"version": "1.4.4"`. `prepare` rejects anything else. It also requires a
`## [1.4.4]` section in `CHANGELOG.md` and an English `## [1.4.4]` section in
`CHANGELOG.en.md`.

To prepare a release:

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` into a new
   `## [X.Y.Z] — YYYY-MM-DD` section, and add the same version section to
   `CHANGELOG.en.md` **in English**. GitHub release notes are always English.
2. Update `"version"` in `package.json` **and** the root entry in
   `package-lock.json` (`npm version X.Y.Z --no-git-tag-version` does both).
3. Update the version assertion in `tests/update-static-test.js`
   (`ok('version is X.Y.Z', pkg.version === 'X.Y.Z')`). The gate is intentionally
   explicit so an accidental version change cannot slip through.
4. Update `flatpak/com.tailref.studio.yml` (`tag:`) and add a `<release>` entry
   to `flatpak/com.tailref.studio.metainfo.xml`. Update the version badge and
   the "current release" sentence in `README.md` and `docs/ROADMAP.md`.
5. Run the local checks:

   ```bash
   node scripts/build-app.js
   node scripts/run-gates.js
   node scripts/release-notes.js --version X.Y.Z
   ```

6. Commit, tag and push:

   ```bash
   git add -A
   git commit -m "Release X.Y.Z"
   git tag -a vX.Y.Z -m "TailRef Studio X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

## What the pipeline publishes

Windows assets keep their existing names, so the in-app updater keeps working:

- `Windows-TailRef-<version>-Setup.exe`
- `Windows-TailRef-<version>-Setup.exe.blockmap`
- `Windows-TailRef-<version>-Portable.exe`
- `latest.yml`

Linux assets:

- `Linux-TailRef-X.Y.Z-x86_64.AppImage`
- `Linux-TailRef-X.Y.Z-amd64.deb`
- `Linux-TailRef-X.Y.Z-x86_64.rpm`

macOS assets:

- `macOS-TailRef-X.Y.Z-arm64.dmg` (Apple silicon)
- `macOS-TailRef-X.Y.Z-x64.dmg` (Intel)

Plus `SHA256SUMS.txt` covering every file above.

`latest-linux.yml` and `latest-mac.yml` are produced by electron-builder but
**are not uploaded**. Neither platform has an in-app updater, and publishing
those files would imply one exists. The workflow fails if either file reaches
the release job.

The release notes come from `scripts/release-notes.js`, which writes
`dist/RELEASE_NOTES.md` with sections for downloads by operating system,
requirements, checksums, known limitations, upgrading and troubleshooting.

**Release notes are always English.** The `Changelog` section is copied
verbatim from the matching heading in `CHANGELOG.en.md`, never from the
Turkish `CHANGELOG.md`. The generator exits with an error if the English
section is missing or if the result contains a Turkish letter, so a release
cannot publish mixed-language notes.

## Prereleases

A tag with a suffix (`v1.5.0-beta.1`) is published as a GitHub prerelease.
Stable installations ignore prereleases: the updater sets
`allowPrerelease = prefs.channel === 'beta'`, and the stable channel does not
enable the beta preference. Prereleases still contain all platform assets and
checksums.

## Manual test build

`workflow_dispatch` builds and verifies without publishing by default:

1. Actions → **Release** → *Run workflow*.
2. Enter an existing tag (for example `v1.4.4`).
3. Leave `publish` unchecked.

The `windows` and `linux` jobs upload their artifacts to the workflow run.
Download them from the run summary.

### Hidden draft release (test before the public release)

A GitHub Release cannot be private inside a public repository, so the closest
thing to a private release is a **draft**. A draft is not listed on the
Releases page, does not appear in the API for anonymous users, and its assets
are not downloadable without write access to the repository. The tag name
itself is public, because the tag is part of the repository.

To upload a real release that only you can download:

1. Actions → **Release** → *Run workflow*.
2. `tag`: the existing tag, for example `v1.4.4`.
3. `publish`: **checked**.
4. `draft`: **checked** (default).

The workflow builds all three platforms, uploads all ten assets and leaves the
release as a draft. Download the AppImage, deb or rpm from the draft page,
test them on a Linux or macOS machine, and when you are satisfied press **Publish
release** on GitHub. Publishing keeps the same tag and the same files; nothing
is rebuilt. To delete a rejected draft, delete the release first, then the tag.

Manual runs never publish when any job fails. Unchecking `draft` publishes
immediately, exactly like a tag push.

Because a draft is not a published release, the Windows in-app updater does
not see it: `electron-updater` reads `latest.yml` from the newest *published*
release, so existing 1.4.2 installations stay on 1.4.2 until you publish the
draft.

## Verifying a published release

After the workflow is green, check:

1. The release page lists exactly these eight assets, including
   `SHA256SUMS.txt`.
2. `sha256sum -c SHA256SUMS.txt` passes on a Linux machine.
3. `Windows-TailRef-<version>-Setup.exe` updates an older installation (Windows).
4. The AppImage starts on Ubuntu and on Fedora.
5. `apt install ./Linux-TailRef-X.Y.Z-amd64.deb` and
   `dnf install ./Linux-TailRef-X.Y.Z-x86_64.rpm` work, and double-clicking a `.tail`
   file opens TailRef.
6. `latest-linux.yml` is **absent** from the release assets.

## If a build fails

- The release is not created; fix the problem and re-run the workflow for the
  same tag. Nothing is published until every job passes.
- If the tag itself is wrong (wrong version, missing changelog), delete it and
  push a corrected tag:

  ```bash
  git tag -d vX.Y.Z
  git push origin :refs/tags/vX.Y.Z
  ```

- If a release was published with a broken asset, edit the release on GitHub or
  delete it and re-run the workflow. `gh release create --verify-tag` fails if a
  release for the tag already exists; delete the old release first.

## Rollback

GitHub Releases is the only distribution channel for Windows updates. To roll
back:

1. Delete the broken release, or mark it as a prerelease so stable clients do
   not see it.
2. Publish the previous version as a new release with a higher version number
   (the updater does not downgrade; `allowDowngrade = false`).
3. Keep the old tag so source builds remain reproducible.

Linux users install a specific package file, so a rollback is simply installing
the previous `.deb`, `.rpm` or AppImage.

## Secrets and permissions

The workflow only uses `secrets.GITHUB_TOKEN`, with `contents: write` scoped to
the `release` job. No publishing token is stored in the repository. Code
signing is not configured yet; the artifacts are unsigned and the release notes
say so. The signing policy, current status and the free SignPath Foundation
application are documented in [`CODE_SIGNING.md`](CODE_SIGNING.md) and
[`SIGNPATH_APPLICATION.md`](SIGNPATH_APPLICATION.md).

## Related documents

- [`CODE_SIGNING.md`](CODE_SIGNING.md) — signing policy and verification
- [`SIGNPATH_APPLICATION.md`](SIGNPATH_APPLICATION.md) — free OSS signing application
- [`LINUX_BUILD.md`](LINUX_BUILD.md) — reproducing the Linux build locally
- [`FLATPAK.md`](FLATPAK.md) — Flathub preparation
- [`RELEASE.md`](RELEASE.md) — versioning and the updater
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — short pre-flight list
