# Release Checklist

A quick pre-flight list. The full process, versioning, update lifecycle and
rollback steps are in [`RELEASE.md`](RELEASE.md); the cross-platform pipeline,
job layout and manual test builds are in
[`RELEASE_PROCESS.md`](RELEASE_PROCESS.md).

## Before you tag

- [ ] All intended changes are merged to `main`.
- [ ] `package.json` version is bumped; `CHANGELOG.md` has a matching
      `## [X.Y.Z]` section.
- [ ] The version assertion in `tests/update-static-test.js` matches.
- [ ] `node scripts/build-app.js` has been run; `src/renderer/app.js` is current.
- [ ] `flatpak/com.tailref.studio.yml` `tag:` and the metainfo `<release>`
      entry point at the new version.
- [ ] No secrets, tokens or personal paths in the diff.
- [ ] Documentation reflects user-visible changes.
- [ ] `docs/RELEASE.md` and `docs/RELEASE_PROCESS.md` are still accurate.

## Gates

- [ ] `npm run gates` — pure chain green (includes update policy, state-machine,
      static security and Linux packaging tests).
- [ ] `npm test` — all application suites green.
- [ ] `npm audit --omit=dev` — no production vulnerabilities.
- [ ] `npm run gates:full` — optional, full Electron/CDP chain.
- [ ] `npm run build:dir` succeeds and the packaged app launches.
- [ ] `npm run test:package` prints `PAKET GÜNCEL`.
- [ ] On Linux: `npm run build:linux` produces the AppImage, deb and rpm, and
      `node scripts/verify-package.js dist/linux-unpacked` passes. The release
      workflow does this on `ubuntu-22.04`.

## Update metadata

- [ ] `dist/latest.yml` exists and its `version` matches `package.json`.
- [ ] `dist/latest.yml` references `TailRef_Studio_Setup.exe`.
- [ ] `dist/TailRef_Studio_Setup.exe.blockmap` exists.
- [ ] `dist/win-unpacked/resources/app-update.yml` names provider `github`,
      owner `Roxsmb`, repo `tailref`.
- [ ] `dist/latest-linux.yml` is **not** uploaded (Linux has no in-app updater).
- [ ] Development and portable runs show the correct disabled/portable message.

## Real update test

- [ ] Install the previous stable NSIS build on a clean profile.
- [ ] Publish the new build (or a test release) and let the old build find it.
- [ ] Download and install through the in-app UI.
- [ ] Confirm the save handshake appears for unsaved manual work.
- [ ] Confirm boards, images, preferences, layouts and `.tail` files survive.
- [ ] Confirm the portable build offers **Open download page** only.

## Publish

- [ ] Commit the version bump after maintainer approval.
- [ ] Create an annotated tag `vX.Y.Z` that exactly matches `package.json`.
- [ ] Push the branch and the tag. Never force-push a published tag.
- [ ] For a test build: run the **Release** workflow manually with `publish`
      and `draft` checked, download the AppImage/deb/rpm from the draft, and
      test them on a real Linux machine. Press **Publish release** only after
      that passes.
- [ ] Confirm the **Release** workflow succeeded end to end (`prepare`, `test`,
      `windows`, `linux`, `release`).
- [ ] Stable tag → release marked **latest**. Prerelease tag → marked
      **prerelease**, never latest.
- [ ] Release contains `TailRef_Studio_Setup.exe`,
      `TailRef_Studio_Setup.exe.blockmap`, `TailRef_Studio.exe`, `latest.yml`,
      `TailRef-X.Y.Z.AppImage`, `tailref_X.Y.Z_amd64.deb`,
      `tailref-X.Y.Z.x86_64.rpm` and `SHA256SUMS.txt`.
- [ ] `latest-linux.yml` is absent from the release assets.
- [ ] Re-download the published files and confirm their checksums.
- [ ] Release notes separate Windows and Linux downloads and state that Linux
      has no in-app updater and no Flathub release yet.

## After publishing

- [ ] `releases/latest` points at the intended stable release.
- [ ] Old releases remain available.
- [ ] The AppImage starts on Ubuntu and Fedora; deb and rpm install and
      double-click a `.tail` file successfully.
- [ ] `Known limitations` in the README is still accurate.
- [ ] Links in `README.md`, `LICENSE-FAQ.md`, `SECURITY.md` and
      `CONTRIBUTING.md` resolve.

> `release.yml` publishes only from a version tag. It validates the tag, runs
> every gate, builds Windows and Linux separately, verifies every artifact and
> then creates the GitHub Release. A failed check never publishes.
