# Contributing to TailRef

Thanks for your interest in TailRef. This document explains how to report
problems, propose changes and get a patch merged without breaking the project.

By participating you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Read the license.** TailRef is **free and open-source software** under the
  [GNU General Public License, version 3 or later](LICENSE)
  (GPL-3.0-or-later). See the [License FAQ](LICENSE-FAQ.md).
- **Search first.** Check existing issues and pull requests before opening a new
  one.
- **Ask before large work.** For new features, refactors or new dependencies,
  open an issue first so we can agree on scope. This avoids wasted effort.

## Reporting bugs

Open an issue using the **Bug report** template and include:

- TailRef version (visible in the About panel) and the exact build you used
  (portable `.exe` or a local development build);
- Windows version;
- steps to reproduce, in order;
- what you expected and what actually happened;
- screenshots or a short screen recording when the problem is visual;
- the relevant console output if you can get it.

Please do not attach personal artwork or project files unless they are needed to
reproduce the bug. If a file is needed, strip anything private first.

## Proposing features

Open an issue using the **Feature request** template. Explain the problem you
want to solve, not only the UI you imagine. "I need to compare two references
side by side" is more useful than "add a split view button".

## Development setup

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for prerequisites, build
commands and the test workflow. The short version:

```bash
npm install
npm start          # bundles sources and launches Electron
npm run gates      # fast gate chain (pure Node)
npm run gates:full # full chain (Electron + CDP, slow)
```

## Project rules

These rules keep the codebase predictable:

1. **Never edit generated files.** `src/renderer/app.js` is produced by
   `node scripts/build-app.js` from `src/renderer/core/*.js`. Edit the source
   files, then rebuild.
2. **Respect load order.** Files in `src/renderer/core/` are concatenated in
   file-name order. Numeric prefixes are meaningful; do not rename files without
   checking every reference.
3. **No new runtime dependencies without discussion.** The app ships as a single
   portable executable and currently has no runtime npm dependencies; keep it
   that way unless there is a strong reason.
4. **Do not commit build output.** `dist/`, logs and scratch files are ignored.
   The generated `src/renderer/app.js` is committed on purpose so a fresh clone
   can be verified — rebuild it, never edit it by hand.
5. **Do not commit secrets or machine-specific paths.** No API keys, tokens,
   personal directories, or absolute `C:\Users\...` paths in source or docs.
6. **Keep user data safe.** Persistence code must not delete or overwrite user
   projects, brushes, themes or settings without an explicit user action.
7. **Add a regression test for every real bug fix.** The gate chain in
   `tests/` is the safety net.
8. **Match the surrounding style.** Plain JavaScript, small functions, comments
   that explain *why*. No framework rewrites.

## Commit messages

Use short, imperative subjects:

```
Fix brush category move not persisting
Add regression gate for palette scroll
```

Reference the issue number in the body when there is one (`Refs #123`).

Do not rewrite published history. Do not force-push shared branches.

## Pull requests

A pull request should:

- do one thing;
- include a clear description of the problem and the fix;
- list the commands you ran and their results (do not claim tests you did not
  run);
- update `CHANGELOG.md` under the current unreleased version heading when the
  change is user-visible;
- update documentation when behaviour or setup changes.

Maintainers may ask for changes, split a patch, or close a PR that conflicts
with the project's direction.

## Translation contributions

The UI ships with locale data under `locales/` and
`src/renderer/core/01c-locale-data.js`. Translation fixes are welcome. Keep keys
unchanged, keep placeholders such as `{n}` intact, and check that the app still
loads the language.

## Copyright and contribution licensing

**You keep copyright in your contribution.** We do not ask you to assign your
copyright, and we do not require a Contributor License Agreement (CLA).

TailRef uses an **"inbound = outbound"** policy: by submitting a contribution,
you agree that it is licensed to the project and its users under
[GPL-3.0-or-later](LICENSE), the same license as the project. This is the only
license you grant, and it gives the project no right to relicense your work
under proprietary terms.

By submitting a contribution you confirm that:

- you wrote it, or you have the right to submit it under GPL-3.0-or-later;
- if it includes third-party material, you have identified it and its license,
  and that license is compatible with GPL-3.0-or-later;
- you have the authority to grant this license (for example, your employer has
  approved the contribution if it owns your work).

New source files should start with an SPDX header:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Emre Melik Nameli
```

Do not paste code from projects whose licenses are incompatible with the GPL.
If you are unsure, ask before opening the PR.

If you contributed code before the GPL migration and you do not agree to license
your contribution under GPL-3.0-or-later, contact the maintainer so the
contribution can be reviewed or removed. Do not assume that an old contribution
has been silently relicensed.

## Security issues

Do **not** open a public issue for a security problem. Follow
[`SECURITY.md`](SECURITY.md).

## Questions

Open an issue or start a discussion in the official repository. Please keep it
respectful and specific.
