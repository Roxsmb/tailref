# Installing TailRef Studio on Linux

TailRef Studio is published for x86_64 (amd64) Linux as an AppImage, a Debian
package and an RPM package. All three contain the same application and the same
`.tail` project support, so a project can be moved between them — and between
Windows and Linux — without conversion.

> **Not on Flathub yet.** The Flatpak manifest is prepared but not submitted.
> Until a Flathub submission is accepted, use one of the formats below.
> See [`FLATPAK.md`](FLATPAK.md).

## Which file should I download?

| Your distribution | Recommended file |
|---|---|
| Ubuntu, Debian, Linux Mint, Pop!\_OS, elementary, Zorin | `tailref_<version>_amd64.deb` |
| Fedora, openSUSE, RHEL-compatible | `tailref-<version>.x86_64.rpm` |
| Arch, CachyOS, Manjaro, anything else | `TailRef-<version>.AppImage` |
| You cannot install packages / you want one file | `TailRef-<version>.AppImage` |

Download from the
[**Releases page**](https://github.com/Roxsmb/tailref/releases/latest). Every
release attaches `SHA256SUMS.txt`; verify the file before running it (see
[Checksums](#checksums)).

## Requirements

- **CPU:** x86_64 (amd64). ARM64 Linux is not published.
- **C library:** glibc 2.25 or newer for the bundled Electron runtime. The
  supported targets are Ubuntu 20.04+ (22.04 and 24.04 are the tested LTS
  releases), Debian 11+, Linux Mint 20+, Fedora 32+ and current
  Arch/CachyOS/openSUSE releases.
- **Libraries:** GTK 3, NSS, XScrnSaver, XTest, AT-SPI and libuuid. The deb and
  rpm declare them; AppImage users may need to install them with the
  distribution's package manager.
- **Graphics:** a working OpenGL driver (Mesa or the vendor driver) and an X11
  or Wayland session.
- **Network:** none required. The Pinterest, ArtStation and YouTube Music panels
  need internet only when you open them.

The optional `inkcore` addon is compiled on Ubuntu 22.04 and needs glibc 2.35.
On an older system it is skipped and the JavaScript implementation is used:
drawing works, but the native fast path is not available.

## AppImage

The AppImage is a single executable file. It needs no installation and no root
rights.

```bash
chmod +x TailRef-1.4.3.AppImage
./TailRef-1.4.3.AppImage
```

Put it anywhere you like, for example `~/Applications/`.

### FUSE

AppImages mount themselves with FUSE. If your system has no `libfuse2`:

- Ubuntu 22.04 / 24.04: `sudo apt install libfuse2t64` (24.04) or
  `sudo apt install libfuse2` (22.04).
- Fedora: `sudo dnf install fuse-libs`.
- Or skip FUSE entirely:

```bash
./TailRef-1.4.3.AppImage --appimage-extract-and-run
```

### Menu entry and `.tail` association

The AppImage contains a `.desktop` file, an icon and a MIME definition, but it
does not install them by itself. Two options:

**AppImageLauncher (recommended).** Install
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), then
double-click the AppImage once and choose *Integrate and run*. It copies the
desktop entry, the icon and the MIME type into your user directories and
associates `.tail` files. If AppImageLauncher is not packaged for your
distribution, [Gear Lever](https://github.com/mijorus/gearlever) does the same
job from Flathub.

**Manual integration.** Extract the payload and install the desktop files for the
current user. The AppImage keeps running from where you store it; only the menu
entry, icon and MIME definition are copied out of the extracted image.

```bash
./TailRef-1.4.3.AppImage --appimage-extract
mkdir -p ~/.local/share/applications \
         ~/.local/share/icons/hicolor/512x512/apps \
         ~/.local/share/mime/packages
cp squashfs-root/tailref.desktop ~/.local/share/applications/
cp squashfs-root/usr/share/icons/hicolor/512x512/apps/tailref.png \
   ~/.local/share/icons/hicolor/512x512/apps/
cp squashfs-root/usr/share/mime/packages/tailref.xml ~/.local/share/mime/packages/
# Point the menu entry at the AppImage you keep. Keep --no-sandbox: the
# AppImage's own entry uses it, and without it Chromium's sandbox helper
# fails on distributions that disable unprivileged user namespaces.
sed -i "s|^Exec=.*|Exec=$HOME/Applications/TailRef-1.4.3.AppImage --no-sandbox %U|" \
   ~/.local/share/applications/tailref.desktop
update-mime-database ~/.local/share/mime
update-desktop-database ~/.local/share/applications
rm -rf squashfs-root
```

The AppImage contains the whole application at its root (`squashfs-root/tailref`
plus `resources/`), so do not copy the executable by itself.

Then right-click a `.tail` file → *Open With* → *TailRef Studio* → *Set as
default*. The MIME type is `application/x-tailref-board`.

## Debian / Ubuntu package

```bash
sudo apt install ./tailref_1.4.3_amd64.deb
```

`apt` resolves the runtime dependencies (`libgtk-3-0`, `libnss3`, `libxss1`,
`libxtst6`, `libatspi2.0-0`, `libuuid1`, `libsecret-1-0`, `xdg-utils`,
`shared-mime-info`, `desktop-file-utils`). Installing with
`sudo dpkg -i` works too, but then run `sudo apt-get -f install` afterwards to
pull in missing dependencies.

The package installs:

- `/opt/TailRef Studio/` — the application
- `/usr/share/applications/tailref.desktop` — menu entry
- `/usr/share/icons/hicolor/*/apps/tailref.png` — icon
- `/usr/share/mime/packages/tailref.xml` — `.tail` MIME type

`shared-mime-info` and `desktop-file-utils` register the MIME type and the menu
entry automatically through their package triggers. `.tail` files can be opened
by double-clicking them.

Upgrade by installing the newer `.deb` over the old one:

```bash
sudo apt install ./tailref_1.4.3_amd64.deb
```

Remove:

```bash
sudo apt remove tailref          # keeps your settings and projects
sudo apt purge tailref           # also removes packaged files only
```

`apt remove` and `apt purge` never touch `~/.config/TailRef` or your `.tail`
files.

## Fedora / openSUSE package

Fedora:

```bash
sudo dnf install ./tailref-1.4.3.x86_64.rpm
```

openSUSE:

```bash
sudo zypper install ./tailref-1.4.3.x86_64.rpm
```

The rpm installs the same files as the deb. Dependencies are resolved by your
package manager (`gtk3`, `nss`, `libnotify`, `libXScrnSaver`, `libXtst`,
`at-spi2-core`, `libuuid`, `libsecret`, `shared-mime-info`,
`desktop-file-utils`, `xdg-utils`).

Upgrade and remove:

```bash
sudo dnf upgrade ./tailref-1.4.3.x86_64.rpm
sudo dnf remove tailref
```

## Arch, CachyOS and Manjaro

There is no official Arch package and no AUR entry maintained by the project.
Use the AppImage, or build from source with
[`LINUX_BUILD.md`](LINUX_BUILD.md). Converting the `.deb` with `debtap` is
possible but unsupported: the converted package may not register the MIME type
correctly.

## Where your data lives

| Data | Location (deb, rpm, AppImage) | Location (Flatpak) |
|---|---|---|
| Settings, brushes, session state | `~/.config/TailRef/` | `~/.var/app/com.tailref.studio/config/TailRef/` |
| Automatic backups | `~/.config/TailRef/Backups/` | `~/.var/app/com.tailref.studio/config/TailRef/Backups/` |
| Known-good backup | `~/.config/TailRef/Backups/good/` | `…/config/TailRef/Backups/good/` |
| Projects | wherever you save `.tail` files | wherever you save `.tail` files |

Windows uses `%APPDATA%\TailRef`. The internal layout is the same, so a project
folder can be copied between operating systems.

## Updates

**TailRef does not update itself on Linux.** The in-app updater is Windows-only:
it is disabled on Linux instead of downloading a Windows installer. This is
intentional and the Settings > About panel explains it.

Update by installing the newer package or replacing the AppImage:

- **deb/rpm:** install the new file over the old one. Your settings stay.
- **AppImage:** download the new AppImage, `chmod +x` it, replace the old file.
  If you integrated it with AppImageLauncher, integration is preserved when you
  keep the same file name.
- **Flatpak (when available):** `flatpak update com.tailref.studio`.

## Checksums

Every release attaches `SHA256SUMS.txt`:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Or for a single file:

```bash
sha256sum TailRef-1.4.3.AppImage
```

Compare the output with the release page. If the values differ, do not run the
file. Builds are not signed with a distribution key, so some package managers
may warn about an unknown signature; the checksum is the integrity check.

## Troubleshooting

**The window is blank or the app crashes on start (GPU).** Update Mesa or your
NVIDIA driver first. Then try software rendering:

```bash
LIBGL_ALWAYS_SOFTWARE=1 ./TailRef-1.4.3.AppImage
# or
./TailRef-1.4.3.AppImage --disable-gpu
```

**Wayland problems (fractional scaling, input, black window).** TailRef asks
Chromium for the native Wayland backend. To force X11/XWayland:

```bash
./TailRef-1.4.3.AppImage --ozone-platform=x11
```

For the deb/rpm build, add the flag to the command line the same way:

```bash
tailref --ozone-platform=x11
```

**`The SUID sandbox helper binary was found, but is not configured correctly`.**
On some distributions the `chrome-sandbox` helper needs to be setuid root:

```bash
sudo chown root:root "/opt/TailRef Studio/chrome-sandbox"
sudo chmod 4755 "/opt/TailRef Studio/chrome-sandbox"
```

The deb and rpm normally do this during installation. For the AppImage,
electron-builder starts it with `--no-sandbox`, so the message should not
appear; if you extracted the AppImage manually, keep that flag or fix the
permissions.

**`Port 5178 is already in use`.** Another TailRef instance (or an unrelated
program) owns the local port used for panel communication. Close the other
instance. Only one TailRef window per user is supported.

**`.tail` files open in a text editor.** The MIME type is not registered. For
deb/rpm, reinstall the package and run `sudo update-mime-database
/usr/share/mime`. For the AppImage, follow [Menu entry and `.tail`
association](#menu-entry-and-tail-association).

**Pinterest, ArtStation or YouTube Music shows a blank panel.** These panels
load web content and need internet access; check your firewall or proxy. The
rest of the app works offline.

## Related documents

- [`INSTALLATION.md`](INSTALLATION.md) — Windows installation
- [`LINUX_BUILD.md`](LINUX_BUILD.md) — building the packages yourself
- [`FLATPAK.md`](FLATPAK.md) — the prepared Flathub manifest
- [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) — how releases are produced
