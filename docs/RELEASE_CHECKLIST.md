# Release Checklist

A quick pre-flight list. The full process, including versioning and rollback, is
in [`RELEASE.md`](RELEASE.md).

## Before you build

- [ ] `package.json` version is bumped and `CHANGELOG.md` has a matching section.
- [ ] `node scripts/build-app.js` has been run; `src/renderer/app.js` is current.
- [ ] No secrets, tokens or personal paths in the diff.
- [ ] Documentation reflects user-visible changes.

## Gates

- [ ] `npm run gates` — pure chain green.
- [ ] `npm run gates:full` — full chain green.
- [ ] `npm run build:portable` succeeds.
- [ ] `npm run test:package` prints `PAKET GÜNCEL`.
- [ ] Manual smoke test on the built `.exe`: draw, save, reopen, import an
      `.abr`, open Pose3D.

## Artifacts

- [ ] `dist/TailRef_Studio.exe` (portable).
- [ ] `dist/TailRef_Studio_Setup.exe` (installer, if shipping it).
- [ ] `SHA256SUMS.txt` generated with `Get-FileHash` or `sha256sum`.
- [ ] `THIRD_PARTY_NOTICES.md` is attached or linked in the release notes.
- [ ] The release tag is pushed and the source archive is downloadable
      (GPLv3 Corresponding Source).

## Publish (manual)

- [ ] Commit and tag (`vX.Y.Z`) after maintainer approval.
- [ ] Push the branch and the tag. Never force-push a published tag.
- [ ] Create the GitHub Release manually and attach the verified artifacts.
- [ ] Include the license, SmartScreen note and checksum in the release notes.
- [ ] Re-download the published files and confirm their checksums.

## After publishing

- [ ] Old releases remain available.
- [ ] `Known limitations` in the README is still accurate.
- [ ] Links in `README.md`, `LICENSE-FAQ.md`, `SECURITY.md` and
      `CONTRIBUTING.md` resolve.

> `release.yml` only builds and uploads workflow artifacts. It never publishes a
> release.
