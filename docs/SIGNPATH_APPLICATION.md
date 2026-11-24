# SignPath Foundation application package

This file is the working checklist for TailRef's free code-signing application
to the [SignPath Foundation](https://signpath.org/). It records what is already
proven in the repository, what the foundation requires, and the exact steps
that remain. It is intentionally honest about the current status: **the
application form has not been submitted yet**, because submission needs the
maintainer's SignPath account and e-mail address.

## 1. Eligibility check

Source: <https://signpath.org/terms> (checked 2026-11-23).

| Foundation condition | TailRef evidence | Status |
|---|---|---|
| No malware / unwanted programs | No telemetry, no adware, no bundleware; `reports/SECURITY_REPORT.md`; production dependency audit is clean | Met |
| OSI-approved OSS license, no commercial dual licensing | GPL-3.0-or-later (`LICENSE`, `package.json`); no paid tier or proprietary add-on | Met |
| No proprietary code | All application code is in the public repository; dependencies are OSS; Electron/Chromium are unmodified system libraries listed in `THIRD_PARTY_NOTICES.md` | Met |
| Maintained | Active history through 2026-11-24; version 1.4.4 | Met |
| **Released in the form to be signed** | `v1.4.4` is tagged and the public workflow (`.github/workflows/release.yml`) builds the Windows, Linux and macOS artifacts from that tag | **Met** (confirm the public release page before submitting) |
| Documented functionality | `README.md`, `docs/INSTALLATION.md`, `docs/LINUX_INSTALLATION.md`, feature and screenshot sections | Met |
| Sign own binaries only | The Windows artifacts are built from this repository by GitHub Actions; no third-party binaries are signed with TailRef's certificate | Met |
| No hacking / exploitation tools | Not applicable; TailRef is a drawing and reference tool | Met |
| Privacy and no hidden data transfer | No telemetry or accounts; network use is update checks and user-opened web panels, described in `docs/CODE_SIGNING.md` | Met |
| Uninstallation | NSIS uninstaller registered in Windows Settings > Apps; user data is kept by design and documented | Met |
| Code signing policy on the home page | `docs/CODE_SIGNING.md`, linked from the README | Met |
| Product metadata | `productName: TailRef Studio`; version comes from `package.json` | Met |
| GitHub-hosted CI only | `release.yml` uses `windows-latest`, `ubuntu-22.04` and `macos-15` | Met |
| MFA on GitHub and SignPath | Required by policy; maintainer must confirm it is enabled before signing | **Maintainer confirmation needed** |
| Manual approval per release | One approver role, assigned below | Met |

## 2. Project details for the form

| Field | Value |
|---|---|
| Project name | TailRef Studio |
| Repository | <https://github.com/Roxsmb/tailref> |
| License | GPL-3.0-or-later |
| Short description | A free, offline reference board, drawing workspace and 3D pose reference for artists. Windows, Linux and macOS desktop app built with Electron. |
| Home page / README | <https://github.com/Roxsmb/tailref#readme> |
| Download / release page | <https://github.com/Roxsmb/tailref/releases> |
| Code signing policy | <https://github.com/Roxsmb/tailref/blob/main/docs/CODE_SIGNING.md> |
| Privacy section | <https://github.com/Roxsmb/tailref/blob/main/docs/CODE_SIGNING.md#privacy> |
| CI system | GitHub Actions |
| Workflow | `.github/workflows/release.yml` |
| Build runners | `windows-latest` (signing target), `ubuntu-22.04` (Linux artifacts), `macos-15` (macOS artifacts) |
| Artifacts to sign | `Windows-TailRef-<version>-Setup.exe` (NSIS installer), `Windows-TailRef-<version>-Portable.exe` (portable) |
| Artifact configuration | To be created in SignPath after approval (Windows Authenticode, PE files) |
| Signing policy | Manual approval; approver below |
| Committers and reviewers | Emre Melik Nameli ([@Roxsmb](https://github.com/Roxsmb)) |
| Approvers | Emre Melik Nameli ([@Roxsmb](https://github.com/Roxsmb)) |
| Contact | maintainer e-mail (to be filled before submission) |

Suggested project description (short version for the form):

> TailRef Studio is a GPL-3.0-or-later desktop app for artists: an infinite
> reference board, an ink drawing workspace and a 3D pose reference tool. It is
> built with Electron, ships for Windows (NSIS + portable) and Linux
> (AppImage/deb/rpm), and is developed in public on GitHub. It has no accounts,
> no cloud and no telemetry. Releases are produced by the public GitHub Actions
> workflow from tagged commits.

## 3. What has to happen before submission

1. **Publish a public 1.4.4 release.** The foundation requires an existing
   release in the form to be signed. The release is produced by the public
   workflow from the `v1.4.4` tag:

   ```powershell
   git tag -a v1.4.4 -m "TailRef 1.4.4"
   git push origin main
   git push origin v1.4.4
   ```

   Pushing the tag runs `release.yml`, which builds and verifies the Windows,
   Linux and macOS artifacts and creates the GitHub Release. The release must
   include the Windows installer, the portable build, the Linux packages, the
   two macOS disk images and `SHA256SUMS.txt`.
2. **Enable MFA on GitHub** (and keep it enabled). SignPath also requires MFA
   on the SignPath account.
3. **Create a SignPath account** at <https://signpath.io/> with the maintainer
   e-mail and accept the foundation terms.
4. **Submit the application form** at <https://signpath.org/apply> using the
   values above. The form is a HubSpot form and asks for project/repository,
   license, release, CI and contact details.
5. **Reply to SignPath** with any follow-up questions. Approval is manual and
   not guaranteed.

> `gh` CLI is not installed on the audit machine, so the release and the form
> are done in the browser. Nothing in this repository submits either of them
> automatically.

## 4. After approval: wiring the release

The foundation issues credentials for an organization, a project and a signing
policy. The release workflow then needs:

| Setting | Kind | Example |
|---|---|---|
| `SIGNPATH_ENABLED` | repository variable | `true` |
| `SIGNPATH_ORGANIZATION_ID` | repository variable | organization UUID from SignPath |
| `SIGNPATH_PROJECT_SLUG` | repository variable | `tailref` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | repository variable | `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIG_SLUG` | repository variable | `windows-installer` |
| `SIGNPATH_API_TOKEN` | repository secret | token for a submitter account |

The workflow change is deliberately **not active yet**: signing steps must only
run after the project exists in SignPath and the artifact configuration has
been tested. The integration uses:

- `actions/upload-artifact` to upload the unsigned installer (required because
  SignPath verifies the artifact was produced by the GitHub workflow),
- `signpath/github-action-submit-signing-request@v3` to submit and download the
  signed artifact,
- the existing checksum and release jobs, unchanged, on the signed files.

Two-stage signing note: signing the NSIS installer signs the downloaded
installer, not the `TailRef Studio.exe` that ends up in `Program Files`.
Complete coverage therefore needs a second signing request for the unpacked
application executable before the installer is built. The first integration
should sign the two user-facing downloads; the second stage can be added after
the first signed release is verified end to end.

## 5. Verification after the first signed release

- `Get-AuthenticodeSignature` reports `Valid` and `SignPath Foundation`.
- The signed installer still installs, launches and uninstalls on a clean
  Windows profile.
- `SHA256SUMS.txt` matches the files attached to the release.
- The update feed (`latest.yml`) points to the signed installer.
- The GitHub Release page links to the code signing policy.

## 6. Remaining inputs from the maintainer

- [ ] E-mail address for the SignPath account and application form
- [ ] Confirmation that GitHub MFA is enabled
- [x] Publish the 1.4.4 GitHub Release (tag `v1.4.4` pushed 2026-11-24)
- [ ] SignPath account creation and acceptance of the foundation terms
- [ ] After approval: organization ID, project slug, policy slug and API token
