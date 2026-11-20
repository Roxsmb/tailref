# Contributing to TailRef

Thanks for your interest in TailRef. This document explains how to report
problems, propose changes and get a patch merged without breaking the project.

By participating you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Read the license.** TailRef is free and **source-available** under the
  [PolyForm Noncommercial License 1.0.0](LICENSE), not unrestricted open
  source. See the [License FAQ](LICENSE-FAQ.md).
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
copyright to the project owner.

To be mergeable, a contribution must be licensable in a way that is compatible
with the project:

- By submitting a contribution you confirm that you wrote it (or have the right
  to submit it) and that you license it to the project and its users under the
  [PolyForm Noncommercial License 1.0.0](LICENSE).
- Because the project may also be offered under separate commercial terms, the
  maintainer needs the right to relicense contributions for that purpose.
  Contributions that require this broader grant are only merged after a
  [Contributor License Agreement](docs/CLA.md) has been reviewed and accepted.
- If you do not want to sign a CLA, say so in the pull request. Your patch can
  still be reviewed, but it may not be merged if the project cannot accept it
  under its licensing model.

Do not paste code from projects whose licenses are incompatible with TailRef.
If you are unsure, ask before opening the PR.

## Security issues

Do **not** open a public issue for a security problem. Follow
[`SECURITY.md`](SECURITY.md).

## Questions

Open an issue or start a discussion in the official repository. Please keep it
respectful and specific.
