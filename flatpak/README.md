# Flatpak manifest (prepared, not published)

This directory contains the Flatpak packaging for TailRef Studio, prepared for a
[Flathub](https://flathub.org) submission. **TailRef is not on Flathub yet.** No
Flatpak bundle is attached to a GitHub release, and
`flatpak install com.tailref.studio` does not work.

Full documentation, including the sandbox rationale and the submission
checklist, is in [`../docs/FLATPAK.md`](../docs/FLATPAK.md).

## Contents

| File | Purpose |
|---|---|
| `com.tailref.studio.yml` | Manifest (`org.electronjs.Electron2.BaseApp` 26.08, offline build) |
| `generated-sources.json` | Pinned npm tarballs, Electron zips and Electron headers |
| `flathub.json` | Limits the Flathub build to `x86_64` |
| `com.tailref.studio.desktop` | Desktop entry installed as `/app/share/applications/com.tailref.studio.desktop` |
| `com.tailref.studio.metainfo.xml` | AppStream metadata |
| `tailref.sh` | `zypak-wrapper` launcher installed as `/app/bin/tailref` |

The icon (`build/icon.png`) lives outside this directory because the deb, rpm and
AppImage builds use it too. The MIME definition
(`build/linux/tailref-mime.xml`) is Flatpak-only: electron-builder generates the
deb, rpm and AppImage MIME XML from `build.fileAssociations`.

## Build and run

```bash
flatpak install flathub org.freedesktop.Sdk//24.08 \
  org.freedesktop.Sdk.Extension.node20//24.08 \
  org.electronjs.Electron2.BaseApp//24.08
flatpak-builder --user --install --force-clean build-dir com.tailref.studio.yml
flatpak run com.tailref.studio
```

## Regenerate the pinned sources

Run this whenever `package-lock.json` or the Electron version changes:

```bash
flatpak-node-generator npm ../package-lock.json \
  -o generated-sources.json --electron-node-headers
node ../scripts/fix-flatpak-sources.js
```

`fix-flatpak-sources.js` converts Windows path separators in `dest` to `/`.
Without it, a manifest generated on Windows creates directories whose names
contain literal backslashes.

## Tag

`com.tailref.studio.yml` points at `tag: v1.4.4`, the first tag that contains
`build/icon.png`, `build/linux/` and this directory (v1.4.2 predates them).
Update `tag:` and the AppStream `<release>` entry when a newer release is
tagged, and regenerate `generated-sources.json` from the same commit.

## License

TailRef Studio is GPL-3.0-or-later; see [`../LICENSE`](../LICENSE). The AppStream
metadata is CC0-1.0, as Flathub requires.
