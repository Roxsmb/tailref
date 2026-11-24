# Code signing policy

TailRef Studio is free and open-source software under GPL-3.0-or-later. This
page is the project's code signing policy and is linked from the README and
from release pages, as required by the SignPath Foundation.

## Current status

Releases up to and including **1.4.4** are built locally and are **not
code-signed**. Windows SmartScreen may therefore show an "unknown publisher"
warning. Every release publishes `SHA256SUMS.txt`; verify a download before
running it:

```powershell
Get-FileHash .\Windows-TailRef-<version>-Setup.exe -Algorithm SHA256
```

TailRef has prepared an application for the **SignPath Foundation** free
open-source signing programme. Until that application is accepted and the
release workflow is switched over, the unsigned-build rules above apply. The
application checklist and the exact remaining steps are in
[`SIGNPATH_APPLICATION.md`](SIGNPATH_APPLICATION.md).

## Policy for signed releases

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

Once signing is active:

- Only artifacts built by the public GitHub Actions workflow
  (`.github/workflows/release.yml`) from a tagged commit in
  <https://github.com/Roxsmb/tailref> are submitted for signing.
- Every signing request is reviewed and manually approved by the approver
  listed below.
- Local developer builds are never signed and are never published as releases.
- The project name in artifact metadata is **TailRef Studio**; the product
  version always matches `package.json` for the tagged release.

## Team roles

TailRef is currently maintained by one person. The roles required by the
SignPath Foundation are filled as follows:

- **Committers and reviewers:** Emre Melik Nameli
  ([@Roxsmb](https://github.com/Roxsmb)) - repository owner and sole
  maintainer.
- **Approvers:** Emre Melik Nameli
  ([@Roxsmb](https://github.com/Roxsmb)) - approves every signing request.

Changes from outside contributors arrive as pull requests and are reviewed
before merge. Multi-factor authentication is required for both the GitHub
account and the SignPath account.

## What gets signed

| Artifact | Built by | Signed |
|---|---|---|
| `Windows-TailRef-<version>-Setup.exe` (NSIS installer) | GitHub Actions, Windows runner | Yes, once SignPath is active |
| `Windows-TailRef-<version>-Portable.exe` (portable) | GitHub Actions, Windows runner | Yes, once SignPath is active |
| Linux AppImage / deb / rpm / tar.gz | GitHub Actions, Ubuntu runner | Not applicable (no Windows Authenticode) |
| `native/inkcore` (`inkcore.node`) | Built from `native/inkcore` in this repository | Covered by the signed package on Windows |

Electron, Chromium and other upstream open-source components are included as
unmodified system libraries and are not signed with TailRef's certificate.
Their licenses are listed in `THIRD_PARTY_NOTICES.md` and
`docs/licenses/`.

## Privacy

TailRef does not collect telemetry, analytics or personal data, and it has no
accounts, cloud sync or advertising. Project files stay on the user's disk.

Network access is limited to actions the user can see or control:

1. **Update check (installed Windows build).** The NSIS build asks GitHub
   Releases for the latest version. The request contains no account or
   identifier beyond a normal HTTPS request. Automatic checks can be turned
   off in Settings; downloads only start when the user asks. Linux builds do
   not self-update.
2. **Web panels.** Pinterest, ArtStation and YouTube Music load only after the
   user opens the corresponding panel, in their own persistent sessions. Those
   sites apply their own privacy policies.
3. **User-initiated links.** The support page and other external links open in
   the default browser only when clicked.

Removing the application removes the program files. User data in
`%APPDATA%\TailRef` (Windows) or `~/.config/TailRef` (Linux) is intentionally
kept unless the user deletes it, so uninstalling does not destroy boards. The
NSIS uninstaller is available from Windows Settings > Apps.

## Verifying a signed release

After signing is active, check the signature:

```powershell
Get-AuthenticodeSignature .\Windows-TailRef-<version>-Setup.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

`Status` should be `Valid` and the signer should be **SignPath Foundation**.
Always compare the file hash with `SHA256SUMS.txt` from the same release as
well; a valid signature and a matching checksum together prove that the file
is the published build.
