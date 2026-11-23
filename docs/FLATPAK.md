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
   `org.freedesktop.Sdk.Extension.node20` SDK extension, because neither the
   Freedesktop SDK nor the Electron base app ships the npm toolchain.
2. `node scripts/build-app.js` builds the renderer bundle.
3. `node scripts/build-native.js` compiles the optional `inkcore` addon. It
   reads the Electron headers from `TAILREF_NODEDIR` instead of downloading
   them.
4. `electron-builder --linux dir` produces `dist/linux-unpacked`. It reads the
   Electron zip from `ELECTRON_CACHE`, so no network access is needed.
5. The unpacked app is copied to `/app/tailref`, and the desktop entry, icon,
   MIME type and AppStream metadata are installed into `/app/share`.

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
| `--filesystem=home` | Opening and saving `.tail` files and reference images anywhere in the home directory |
| `--filesystem=/media`, `--filesystem=/run/media` | External drives used for reference material |

Electron's file dialog is a GTK dialog running inside the sandbox, so the
document portal alone cannot browse the filesystem. That is why the home
directory is shared instead of relying only on portals. If Flathub review asks
for narrower permissions, the alternative is to implement the
`org.freedesktop.portal.FileChooser` API in the main process; that is a larger
change and is not done yet.

## Building locally

Requirements: `flatpak`, `flatpak-builder`, and the `org.freedesktop.Sdk`,
`org.freedesktop.Sdk.Extension.node20` and `org.electronjs.Electron2.BaseApp`
runtimes for 24.08:

```bash
flatpak install flathub org.freedesktop.Sdk//24.08 \
  org.freedesktop.Sdk.Extension.node20//24.08 \
  org.electronjs.Electron2.BaseApp//24.08
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

`flatpak/com.tailref.studio.yml` targets `tag: v1.4.3`. That tag does not exist
yet: it is created by the release process
([`RELEASE_PROCESS.md`](RELEASE_PROCESS.md)). The v1.4.2 tag predates
`build/icon.png`, `build/linux/` and `flatpak/`, so it cannot build this
manifest. Update `tag:` when the release tag is pushed.

## Flathub submission checklist

Before opening a pull request against
[flathub/flathub](https://github.com/flathub/flathub):

- [ ] The release tag exists and contains `flatpak/`, `build/icon.png` and
      `build/linux/tailref-mime.xml`.
- [ ] `tag:` in the manifest matches that tag.
- [ ] `generated-sources.json` was regenerated from the same commit.
- [ ] `appstreamcli validate --no-net` passes with no errors.
- [ ] `flatpak-builder-lint manifest` and `flatpak-builder-lint repo` pass.
- [ ] The app launches in the sandbox and `.tail` files open from the file
      manager.
- [ ] Screenshots are public HTTPS URLs (they point at `docs/screenshots/` on
      `main`).
- [ ] The AppStream `<releases>` entry matches the tag.
- [ ] The repository has a `LICENSE` (GPL-3.0-or-later) and the metainfo
      declares the same license.
- [ ] No network access is needed during the build.

Do not describe TailRef as available on Flathub until the submission is merged
and the app appears on <https://flathub.org>.

## Known limitations

- **Data location.** Flatpak redirects `~/.config` to
  `~/.var/app/com.tailref.studio/config`, so settings and backups live there.
  Projects (`.tail` files) are unaffected.
- **No in-app updates.** The updater is disabled on Linux. Update with
  `flatpak update com.tailref.studio` once published.
- **File dialogs.** They browse the sandbox, which is why `--filesystem=home`
  is requested.
- **ARM64.** The Electron zips for x86_64 and aarch64 are both pinned in
  `generated-sources.json`, but only x86_64 is built and tested. An aarch64
  build also needs the native `inkcore` module compiled for that architecture.
- **Native module.** `inkcore` is optional; if the Flatpak build cannot compile
  it, the app uses the JavaScript fallback.

## Related documents

- [`LINUX_BUILD.md`](LINUX_BUILD.md) — AppImage, deb and rpm builds
- [`LINUX_INSTALLATION.md`](LINUX_INSTALLATION.md) — installing on Linux
- [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) — tagging and publishing
