# Release Checklist

A quick pre-flight list. The full process, versioning, update lifecycle and
rollback steps are in [`RELEASE.md`](RELEASE.md).

## Before you tag

- [ ] All intended changes are merged to `main`.
- [ ] `package.json` version is bumped; `CHANGELOG.md` has a matching section.
- [ ] `node scripts/build-app.js` has been run; `src/renderer/app.js` is current.
- [ ] No secrets, tokens or personal paths in the diff.
- [ ] Documentation reflects user-visible changes.
- [ ] `docs/RELEASE.md` update instructions are still accurate.

## Gates

- [ ] `npm run gates` — pure chain green (includes update policy, state-machine
      and static security tests).
- [ ] `npm test` — all application suites green.
- [ ] `npm audit --omit=dev` — no production vulnerabilities.
- [ ] `npm run gates:full` — optional, full Electron/CDP chain.
- [ ] `npm run build:dir` succeeds and the packaged app launches.
- [ ] `npm run test:package` prints `PAKET GÜNCEL`.

## Update metadata

- [ ] `dist/latest.yml` exists and its `version` matches `package.json`.
- [ ] `dist/latest.yml` references `TailRef_Studio_Setup.exe`.
- [ ] `dist/TailRef_Studio_Setup.exe.blockmap` exists.
- [ ] `dist/win-unpacked/resources/app-update.yml` names provider `github`,
      owner `Roxsmb`, repo `tailref`.
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
- [ ] Confirm the **Release** workflow succeeded end to end.
- [ ] Stable tag → release marked **latest**. Prerelease tag → marked
      **prerelease**, never latest.
- [ ] Release contains `TailRef_Studio_Setup.exe`,
      `TailRef_Studio_Setup.exe.blockmap`, `TailRef_Studio.exe`, `latest.yml`
      and `SHA256SUMS.txt`.
- [ ] Re-download the published files and confirm their checksums.
- [ ] Release notes include the license, SmartScreen note and the source offer
      (the pushed tag).

## After publishing

- [ ] `releases/latest` points at the intended stable release.
- [ ] Old releases remain available.
- [ ] `Known limitations` in the README is still accurate.
- [ ] Links in `README.md`, `LICENSE-FAQ.md`, `SECURITY.md` and
      `CONTRIBUTING.md` resolve.

> `release.yml` publishes only from a version tag. It validates the tag, runs
> every gate, verifies the artifacts and then creates the GitHub Release. A
> failed check never publishes.
