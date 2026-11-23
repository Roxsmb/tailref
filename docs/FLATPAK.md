# Flatpak and Flathub

TailRef Studio has a Flatpak manifest prepared for a Flathub submission. It is
**not published**: there is no `com.tailref.studio` entry on Flathub, no Flatpak
bundle attached to a GitHub release, and `flatpak install com.tailref.studio`
does not work yet. This document describes what exists and what is still
required.

## Files

| File | Purpose |
|---|---|
| [`flatpak/com.tailref.studio.yml`](../flatpak/com.tailref.studio.yml) | Flatpak manifest |
| [`flatpak/generated-sources.json`](../flatpak/generated-sources.json) | Pinned npm and Electron sources (offline build) |
| [`flatpak/com.tailref.studio.desktop`](../flatpak/com.tailref.studio.desktop) | Desktop entry installed into `/app/share/applications` |
| [`flatpak/com.tailref.studio.metainfo.xml`](../flatpak/com.tailref.studio.metainfo.xml) | AppStream metadata |
| [`flatpak/tailref.sh`](../flatpak/tailref.sh) | `zypak-wrapper` launcher installed as `/app/bin/tailref` |
| [`build/icon.png`](../build/icon.png) | 512×512 application icon |
| [`build/linux/tailref-mime.xml`](../build/linux/tailref-mime.xml) | `.tail` MIME type (`application/x-tailref-board`) |

## How the build works

The manifest uses `org.electronjs.Electron2.BaseApp`, the Flathub base
application that provides the Electron runtime helpers, including
`zypak-wrapper`. Zypak lets Chromium use the Flatpak sandbox instead of its own
setuid sandbox helper, so TailRef starts without `--no-sandbox`.

The `tailref` module is a `simple` build:

1. `npm ci --offline` installs from the npm cache declared in
   `generated-sources.json`. npm and Node come from the
   `org.freedesktop.Sdk.Extension.node22` SDK extension, because neither the
   Freedesktop SDK nor the Electron base app ships the npm toolchain.
2. `node scripts/build-app.js` builds the renderer bundle.
3. `node scripts/build-native.js` compiles the optional `inkcore` addon. It
   reads the Electron headers from `TAILREF_NODEDIR` instead of downloading
   them; the manifest extracts the pinned headers archive into that directory
   first.
4. `electron-builder --linux dir` produces `dist/linux-unpacked`. It reads the
   Electron zip from `ELECTRON_CACHE`, so no network access is needed.
5. The unpacked app is copied to `/app/tailref`, and the desktop entry, icon,
   MIME type, AppStream metadata and the license are installed into
   `/app/share`.

Nothing is downloaded during the build. That is a Flathub requirement and also
why `generated-sources.json` exists.

## Desktop identity

The Flatpak installs `com.tailref.studio.desktop` and `Icon=com.tailref.studio`.
Inside the sandbox `FLATPAK_ID=com.tailref.studio`, and `src/main/main.js` uses
that to call `app.setDesktopName('com.tailref.studio.desktop')`, so the window's
Wayland `app_id` / X11 `WM_CLASS` matches the desktop file; the entry declares
`StartupWMClass=com.tailref.studio` for the same reason. Without it the dock
would show a second, unmatched icon. Outside Flatpak the variable is absent and
the window keeps `tailref.desktop` from `package.json`.

## Sandbox permissions

| Permission | Why |
|---|---|
| `--share=ipc`, `--device=dri` | Chromium and WebGL/WebGPU for the Pose3D viewport |
| `--socket=wayland`, `--socket=fallback-x11` | Native Wayland with an X11 fallback |
| `--share=network` | Pinterest, ArtStation and YouTube Music panels |
| `--socket=pulseaudio` | Audio in the YouTube Music panel |
| `--talk-name=org.freedesktop.Notifications` | Desktop notifications |
| `--env=GTK_USE_PORTAL=1` | File open/save through `xdg-desktop-portal` instead of a static home-directory grant |

There is **no** `--filesystem=home`, `--filesystem=/media` or `--filesystem=host`.
Flathub requires portals wherever one exists, and a file chooser portal exists.
With `GTK_USE_PORTAL=1`, Electron's GTK file dialog asks the portal, so the user
can open and save `.tail` projects and reference images anywhere they have
access. Files passed on the command line (double-clicking a `.tail` in the file
manager) reach the app through Flatpak's document portal, because the exported
desktop entry forwards `%U`.

If a portal is missing on a minimal desktop, the fallback is to add
`--filesystem=home` again; that is a one-line change but it weakens the sandbox
and should be discussed with the reviewers first.

## Building locally

Requirements: `flatpak`, `flatpak-builder`, and the `org.freedesktop.Sdk`,
`org.freedesktop.Sdk.Extension.node22` and `org.electronjs.Electron2.BaseApp`
runtimes for 26.08:

```bash
flatpak install flathub org.freedesktop.Sdk//26.08 \
  org.freedesktop.Sdk.Extension.node22//26.08 \
  org.electronjs.Electron2.BaseApp//26.08
```

Build and run:

```bash
flatpak-builder --user --install --force-clean build-dir \
  flatpak/com.tailref.studio.yml
flatpak run com.tailref.studio
```

Build without installing:

```bash
flatpak-builder --repo=repo --force-clean build-dir \
  flatpak/com.tailref.studio.yml
flatpak build-bundle repo tailref.flatpak com.tailref.studio
```

Validate the metadata and the manifest:

```bash
appstreamcli validate --no-net flatpak/com.tailref.studio.metainfo.xml
flatpak-builder-lint manifest flatpak/com.tailref.studio.yml
flatpak-builder-lint repo repo
```

`flatpak-builder-lint` is available from
[flathub/flatpak-builder-lint](https://github.com/flathub/flatpak-builder-lint).

## Regenerating the pinned sources

`flatpak/generated-sources.json` is produced from `package-lock.json`. Run this
whenever dependencies or the Electron version change:

```bash
flatpak-node-generator npm package-lock.json \
  -o flatpak/generated-sources.json --electron-node-headers
node scripts/fix-flatpak-sources.js
```

`flatpak-node-generator` comes from
[flatpak/flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools/tree/master/node).
`fix-flatpak-sources.js` converts the `dest` paths to POSIX separators, which
matters when the generator runs on Windows; flatpak-builder would otherwise
create directories with literal backslashes in their names.

The generated file currently pins Electron `45.4.1` and the exact npm tarballs
from `package-lock.json`. It includes the Electron x64 zip, the matching
headers archive and the npm cache entries.

## Tag to build

`flatpak/com.tailref.studio.yml` targets `tag: v1.4.3`, which was pushed on
2026-11-23. The tag contains `build/icon.png`, `build/linux/`, `flatpak/` and
`LICENSE`, so the manifest can build from it. Update `tag:` when a newer release
is published; `x-checker-data` also opens an automatic PR when a new tag
appears.

The Flathub copy of the manifest must match the repository copy. The manifest
itself is not read from the tag; only the application sources are.

## Flathub submission checklist

Before opening a pull request against
[flathub/flathub](https://github.com/flathub/flathub):

- [ ] The release tag exists, is **public** (a draft release is not enough) and
      contains `flatpak/`, `build/icon.png` and `build/linux/tailref-mime.xml`.
- [ ] `tag:` in the manifest matches that tag.
- [ ] `generated-sources.json` was regenerated from the same commit.
- [ ] `appstreamcli validate --no-net` passes with no errors.
- [ ] `flatpak-builder-lint manifest` and `flatpak-builder-lint repo` pass.
- [ ] `flatpak/flathub.json` limits the build to `x86_64`; Flathub would
      otherwise try aarch64 and fail on the native module.
- [ ] The manifest installs the license to
      `$FLATPAK_DEST/share/licenses/$FLATPAK_ID`.
- [ ] The app launches in the sandbox, and `.tail` files open from the file
      manager through the document portal.
- [ ] Screenshots are public HTTPS URLs (they point at `docs/screenshots/` on
      `main`).
- [ ] The AppStream `<releases>` entry matches the tag.
- [ ] The repository has a `LICENSE` (GPL-3.0-or-later) and the metainfo
      declares the same license.
- [ ] No network access is needed during the build.

The pull request goes to a branch of your own fork named after the app ID
(`com.tailref.studio`), with the manifest at the top level, next to
`generated-sources.json` and `flathub.json`.

Flathub's requirements state that AI tools must not open or automate
submissions, and that manifests, commit messages and PR text must not be
AI-generated. Write and open the pull request yourself.

Do not describe TailRef as available on Flathub until the submission is merged
and the app appears on <https://flathub.org>.

## Known limitations

- **Data location.** Flatpak redirects `~/.config` to
  `~/.var/app/com.tailref.studio/config`, so settings and backups live there.
  Projects (`.tail` files) are unaffected.
- **No in-app updates.** The updater is disabled on Linux. Update with
  `flatpak update com.tailref.studio` once published.
- **File dialogs.** They go through `xdg-desktop-portal` (`GTK_USE_PORTAL=1`).
  On a desktop without a file chooser portal, opening and saving outside the
  sandbox will not work.
- **ARM64.** Only `x86_64` is built; `flatpak/flathub.json` restricts the
  Flathub build to that architecture. `generated-sources.json` also pins the
  aarch64 Electron zip, but the native `inkcore` module would have to be
  compiled for aarch64 before an ARM build is possible.
- **Native module.** `inkcore` is optional; if the Flatpak build cannot compile
  it, the app uses the JavaScript fallback.

## Related documents

- [`LINUX_BUILD.md`](LINUX_BUILD.md) — AppImage, deb and rpm builds
- [`LINUX_INSTALLATION.md`](LINUX_INSTALLATION.md) — installing on Linux
- [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) — tagging and publishing
