# TailRef Studio on macOS

TailRef Studio ships as two disk images built from the same source tree:

| File | Architecture | Runs on |
|---|---|---|
| `TailRef-<version>-arm64.dmg` | `arm64` | Apple silicon (M1 and later) |
| `TailRef-<version>-x64.dmg` | `x86_64` | Intel Macs |

macOS 12 (Monterey) or newer. The app is not sandboxed and is not distributed
through the Mac App Store.

## Installing

1. Open the disk image for your Mac (`arm64` unless you know it is Intel).
2. Drag **TailRef Studio** into `Applications`.
3. Launch it from `Applications`.

### First launch: Gatekeeper

The published builds are **ad-hoc signed but not notarized**. The project does
not own an Apple Developer ID, so macOS cannot verify the publisher:

- macOS shows *"TailRef Studio is damaged"* or *"unidentified developer"*.
- **Right-click the app → Open → Open** once. macOS remembers the choice.
- If the dialog has no Open button, clear the quarantine flag:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/TailRef Studio.app"
  ```

The checksum in `SHA256SUMS.txt` is the only integrity proof for these builds;
verify it before clearing the flag if you downloaded from a mirror.

Projects, settings and backups live in
`~/Library/Application Support/TailRef Studio`. Uninstalling (moving the app to
the Trash) does not delete them.

## `.tail` files

The bundle declares the `.tail` document type, so Finder can open boards with
TailRef Studio (`Get Info → Open with → TailRef Studio → Change All…`).
Double-clicking a board while the app is running forwards it to the existing
window; a cold start hands the path to the renderer through the `open-file`
event. Both paths are implemented in `src/main/main.js`.

## Building

Local build (macOS only — electron-builder cannot create a `.app` on Windows or
Linux):

```bash
npm ci
node scripts/build-app.js
node scripts/build-native.js --arch=arm64     # or --arch=x64
npx electron-builder --mac dmg --arm64 --publish never
node scripts/verify-package.js dist/mac-arm64
```

`npm run build:mac` builds for the architecture of the machine that runs it.

The native ink module (`native/inkcore`) is optional. If it cannot be compiled
the app falls back to the JavaScript engine; `verify-package.js` reports the
missing module as `OK native/inkcore · yok`.

### Building both architectures from one machine

`scripts/build-native.js --arch=<arch>` forwards the architecture to
`node-gyp`, so an Apple silicon machine can cross-compile the Intel module.
Build one architecture at a time: the packaged app embeds whichever
`inkcore.node` existed when electron-builder ran.

```bash
node scripts/build-native.js --arch=arm64
npx electron-builder --mac dmg --arm64 --publish never

node scripts/build-native.js --arch=x64
npx electron-builder --mac dmg --x64 --publish never
```

## Continuous integration

The `macos` job in `.github/workflows/release.yml` runs on `macos-14` for every
tagged release and:

1. builds the native module for `arm64`, packages and verifies the payload,
2. builds the native module for `x64`, packages and verifies the payload,
3. checks the Mach-O architecture with `lipo`, the bundle identifier, the
   graphics-design category and the `.tail` document type with `PlistBuddy`,
4. requires an ad-hoc signature (`codesign --verify --deep --strict`),
5. mounts both disk images with `hdiutil` and checks that the app and the
   `/Applications` symlink are inside,
6. copies the Apple silicon bundle out of the image and **launches it** with
   `scripts/launch-smoke.js`: an isolated user-data folder, a temporary port and
   a headless check that the renderer reaches `appReady` and renders the board
   scene. A package that cannot start fails the release,
7. refuses to publish `latest-mac.yml` (there is no in-app updater on macOS).

Only `dmg` is produced. A `zip` target would generate an update feed that the
app cannot use: `src/main/update-manager.js` disables the updater off Windows.

## Code signing and notarization

`package.json` sets `build.mac.identity` to `"-"`, which selects ad-hoc signing.
That is enough to launch on Apple silicon, but users still see the Gatekeeper
warning.

To ship a signed and notarized build:

1. Join the Apple Developer Program and create a **Developer ID Application**
   certificate; import it into the login keychain on the build machine (or add
   `CSC_LINK` / `CSC_KEY_PASSWORD` repository secrets).
2. Remove `"identity": "-"` from `build.mac` so electron-builder picks the
   Developer ID identity automatically.
3. Add the notarization secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
   `APPLE_TEAM_ID`; electron-builder notarizes after signing.
4. Keep `build/entitlements.mac.plist` — the hardened runtime needs the JIT and
   library-validation entitlements for Electron and the ink module.
5. Update the release workflow to assert `Signature=Developer ID Application`
   instead of `Signature=adhoc`, and drop the Gatekeeper paragraph from
   `scripts/release-notes.js`.

Without step 1 the release notes must keep saying the build is not notarized;
claiming otherwise would be false.

## Verifying a downloaded image

```bash
shasum -a 256 TailRef-<version>-arm64.dmg     # compare with SHA256SUMS.txt
MNT="$(hdiutil attach -nobrowse -readonly TailRef-<version>-arm64.dmg \
  | awk -F'\t' '/\/Volumes\//{print $NF}')"
codesign -dv "$MNT/TailRef Studio.app"
codesign --verify --deep --strict "$MNT/TailRef Studio.app"
hdiutil detach "$MNT"
```

## Known limitations

- Not notarized, ad-hoc signed: first launch needs a right-click → Open.
- No automatic updates; download the new disk image.
- No Mac App Store build (the app is unsandboxed).
- Only `arm64` and `x64` are published.
- The release workflow validates the bundle statically and launches the
  packaged app once (`scripts/launch-smoke.js`); no interactive GUI test runs on
  macOS yet, so drawing, panels and `.tail` double-click still need a human.
