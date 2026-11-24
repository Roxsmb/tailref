# TailRef Documentation

Start with the documents in the first table. Everything below it is deeper
material; some of it is historical and written in Turkish.

## Start here

| Document | What it covers |
|---|---|
| [`INSTALLATION.md`](INSTALLATION.md) | Installing the Windows portable build or installer, data locations, checksums, troubleshooting |
| [`LINUX_INSTALLATION.md`](LINUX_INSTALLATION.md) | Installing the AppImage, deb or rpm on Linux, menu and `.tail` integration, data locations |
| [`MACOS.md`](MACOS.md) | macOS disk images, the Gatekeeper first launch, building and signing on macOS, release validation |
| [`FEATURES.md`](FEATURES.md) | What the app actually does today, including known limitations |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Prerequisites, commands, testing, debugging, code style |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the main process, renderer, persistence and drawing engine fit together |
| [`ROADMAP.md`](ROADMAP.md) | What is next, what is under consideration, what is not planned |

## Project and release

| Document | What it covers |
|---|---|
| [`RELEASE.md`](RELEASE.md) | Versioning, automatic updates, release pipeline, rollback |
| [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) | The cross-platform tagged release pipeline: jobs, artifacts, checksums, manual test builds |
| [`LINUX_BUILD.md`](LINUX_BUILD.md) | Building the AppImage, deb and rpm locally, native module, verification |
| [`FLATPAK.md`](FLATPAK.md) | The Flathub-ready Flatpak manifest, sandbox permissions and submission checklist |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Short pre-flight list before a build |
| [`CODE_SIGNING.md`](CODE_SIGNING.md) | Code signing policy: scope, roles, privacy, verification; current unsigned status |
| [`SIGNPATH_APPLICATION.md`](SIGNPATH_APPLICATION.md) | Eligibility evidence and remaining steps for the free SignPath Foundation signing application |
| [`PROJECT_AUDIT.md`](PROJECT_AUDIT.md) | The pre-publication audit: findings and resolutions |
| [`LICENSE_MIGRATION.md`](LICENSE_MIGRATION.md) | The 2026 relicensing to GPL-3.0-or-later: audit, compatibility notes, open questions |

## Technical reference

| Document | Notes |
|---|---|
| [`TAIL_FORMAT.md`](TAIL_FORMAT.md) | `.tail` project file format |
| [`INK_EDITOR_ARCHITECTURE.md`](INK_EDITOR_ARCHITECTURE.md) | Ink editor internals |
| [`INK_PERFORMANCE.md`](INK_PERFORMANCE.md) | Drawing performance measurements and budgets |
| [`INK_STATUS.md`](INK_STATUS.md) | Ink engine work log and open items |
| [`PERF-PLAN.md`](PERF-PLAN.md) | Performance investigation notes |
| [`PROJECT_STATE_ARCHITECTURE.md`](PROJECT_STATE_ARCHITECTURE.md) | Project/session state and recovery |
| [`3D_VIEWPORT_SPEC.md`](3D_VIEWPORT_SPEC.md) | Pose3D viewport specification |
| [`fx-motoru-spec.md`](fx-motoru-spec.md) | FX engine specification |
| [`fx-bolum12-inceleme.md`](fx-bolum12-inceleme.md) | FX chapter 12 review |
| [`BUGS.md`](BUGS.md) | Found-and-fixed bug log |
| [`evre-5-kararlar.md`](evre-5-kararlar.md) | Phase 5 decisions log |

These are working documents. They are accurate about the areas they describe,
but they may use older file names, gate counts or UI labels. When a document and
the code disagree, the code is the source of truth.

## Other folders

| Folder | Contents |
|---|---|
| [`todo/`](todo/) | Deferred work and redesign notes |
| [`archive/`](archive/) | Historical documents kept for context, not current |
| [`screenshots/`](screenshots/) | Screenshot guidelines and the public README images |
| [`licenses/`](licenses/) | Third-party license texts (fonts, three.js, fflate) |
| [`fx-qa/`](fx-qa/) | FX visual QA notes |

## Root documents

The repository root has the documents a visitor sees first:
[`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md),
[`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), [`SECURITY.md`](../SECURITY.md),
[`LICENSE`](../LICENSE), [`NOTICE`](../NOTICE), [`LICENSE-FAQ.md`](../LICENSE-FAQ.md),
[`TRADEMARK.md`](../TRADEMARK.md), [`CHANGELOG.md`](../CHANGELOG.md) and
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
