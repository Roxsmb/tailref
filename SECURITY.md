# Security Policy

## Supported versions

TailRef is developed and distributed as a portable Windows build. Security fixes
are applied to the **latest released version** only.

| Version | Supported |
|---|---|
| latest release | ✅ |
| older releases | ❌ (please update) |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately to the maintainer, **Emre Melik Nameli**, at
**tailrefstudio@gmail.com**, or through the private security advisory channel of
the official repository. Include:

- TailRef version and build (portable `.exe` or development build);
- Windows version;
- a description of the issue and its impact;
- reproduction steps or a proof of concept;
- any suggested fix.

You can expect an acknowledgement as soon as reasonably possible. Please give
the maintainer time to investigate and ship a fix before public disclosure.

There is no bug bounty program. Credit will be given in the release notes unless
you ask to stay anonymous.

## Security model

TailRef is an offline-first Electron application. It is built with these
properties:

- **Renderer isolation.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`.
- **Narrow preload bridge.** The renderer talks to the main process through an
  explicit API exposed with `contextBridge`; Node APIs are not exposed to page
  scripts.
- **Content Security Policy.** The main document restricts scripts to `'self'`,
  blocks `object-src`, `base-uri` and `form-action`, and limits frames to the
  known panel providers (YouTube, Pinterest, ArtStation).
- **Guest panels are sandboxed.** Pinterest and ArtStation open in separate
  sessions (`partition`) with their own preload, no Node access, navigation
  restricted to the provider's own domains, and popups limited to login flows.
- **No telemetry.** TailRef does not collect analytics, usage data or crash
  reports. It does not phone home.
- **No auto-update.** Updates are manual downloads from the release page.
- **Local data only.** Projects, brushes, themes, settings and reference images
  are stored on the local machine (IndexedDB and the Electron user-data folder).

## Known limitations

- **Binaries are not code-signed.** Windows SmartScreen may warn about an
  unknown publisher. Verify the SHA-256 checksum published with each release
  before running a downloaded build.
- **Third-party panels are websites.** When you open the Pinterest or ArtStation
  panel, you are loading remote content from that provider under its own terms
  and privacy policy. TailRef cannot control what those sites do inside their
  own pages.
- **Imported files are untrusted input.** `.tail` project files, `.abr` brush
  sets, images and UI packages are parsed locally. Malformed files are expected
  to fail with an error rather than crash, but treat files from unknown sources
  with normal caution.
- **No encryption at rest.** Local project data is not encrypted. Use full-disk
  encryption if your machine is shared.

## What is out of scope

- Issues that require an already-compromised machine or administrator access.
- Vulnerabilities in third-party sites loaded in panels (report those to the
  provider).
- Vulnerabilities in Electron/Chromium that are already fixed upstream; update
  TailRef instead.
- Social-engineering attacks that trick a user into running a modified build
  from an unofficial source.

## Dependencies

The runtime has **no npm dependencies**; third-party runtime code is vendored
(three.js, fflate) and documented in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Build-time dependencies are
listed in `package.json`. Dependency advisories are reviewed with
`npm audit --omit=dev` in CI (informational).

## Secrets

The project does not use API keys, tokens or passwords. `.env` files are
git-ignored; `.env.example` documents optional development variables only. If
you find a committed secret, report it privately so it can be removed and
rotated.
