# Release Process

This document describes how a TailRef release is prepared and published. It is
deliberately manual: **nothing is published automatically.**

## Versioning

TailRef follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Change | Version bump | Example |
|---|---|---|
| Bug fixes, docs, small internal cleanup | PATCH | `1.4.0 → 1.4.1` |
| New features, backwards compatible | MINOR | `1.4.1 → 1.5.0` |
| Breaking changes to files, settings or APIs | MAJOR | `1.5.0 → 2.0.0` |

Rules:

- `package.json` is the **single source of truth** for the version.
- `CHANGELOG.md` must have a matching section.
- Never reuse or overwrite a published version or tag.
- Never rewrite published Git history.
- Old release downloads stay available.

## Checklist

### 1. Prepare the code

- [ ] All intended changes are merged.
- [ ] `node scripts/build-app.js` has been run and `src/renderer/app.js` is
      current.
- [ ] No secrets, local paths or personal data in the diff.
- [ ] `CHANGELOG.md` has an entry for the new version, with the date.
- [ ] `package.json` version is bumped.
- [ ] Documentation is updated for user-visible changes.

### 2. Verify

- [ ] `npm run gates` - 14 pure gates green.
- [ ] `npm run gates:full` - 69 gates green (Electron + CDP).
- [ ] `npm run build:portable` succeeds.
- [ ] `npm run build:setup` succeeds (if shipping the installer).
- [ ] `npm run test:package` prints `PAKET GÜNCEL`.
- [ ] Launch the built `.exe` and do a short manual smoke test: draw a stroke,
      save, reopen, import an `.abr`, open Pose3D.
- [ ] Record the SHA-256 of each artifact:

  ```powershell
  Get-FileHash .\dist\TailRef_Studio.exe -Algorithm SHA256
  Get-FileHash .\dist\TailRef_Studio_Setup.exe -Algorithm SHA256
  ```

### 3. Commit and tag

```bash
git add -A
git commit -m "Release v1.4.1"
git tag -a v1.4.1 -m "TailRef 1.4.1"
git push origin main
git push origin v1.4.1
```

Do this only after the maintainer approves. Do not force-push a tag.

### 4. Publish on GitHub (manual)

1. Open **Releases → Draft a new release**.
2. Choose the existing tag.
3. Title: `TailRef 1.4.1`.
4. Paste the matching `CHANGELOG.md` section as release notes.
5. Attach the verified artifacts:
   - `TailRef_Studio.exe`
   - `TailRef_Studio_Setup.exe` (if built)
   - `SHA256SUMS.txt`
6. Mention the license and link `LICENSE`, `LICENSE-FAQ.md` and
   `THIRD_PARTY_NOTICES.md`.
7. Publish manually.

### 5. After publishing

- [ ] Download the published artifacts once and re-check their SHA-256.
- [ ] Confirm the release notes render correctly.
- [ ] Announce only if you want to.

## SHA256SUMS.txt format

```
<hash>  TailRef_Studio.exe
<hash>  TailRef_Studio_Setup.exe
```

## Rollback

If a release is broken:

1. Do **not** delete the release or the tag.
2. Mark the release as broken in its notes.
3. Publish a fixed PATCH release.
4. If the build is unsafe to run, edit the release notes to say so clearly and
   point users to the last good version.

## What the automation does and does not do

`.github/workflows/ci.yml` runs the pure gates on push and pull request.

`.github/workflows/release.yml` is **manual** (`workflow_dispatch`). It builds
the artifacts and uploads them as workflow artifacts for inspection. It does not
create a GitHub Release and does not publish anything.
