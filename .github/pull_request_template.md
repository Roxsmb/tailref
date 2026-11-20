## What this changes

<!-- One or two sentences. Link the issue if there is one: Refs #123 -->

## Why

<!-- The problem this solves. Concrete workflows are more useful than feature names. -->

## How it was tested

<!-- List the commands you actually ran and their result. Do not claim tests you did not run. -->

- [ ] `node scripts/build-app.js` (if `src/renderer/core/` changed)
- [ ] `npm run gates`
- [ ] `npm run gates:full` (if the change touches the app at runtime)
- [ ] Manual check of the affected workflow

## Checklist

- [ ] I did not edit generated files (`src/renderer/app.js`) by hand.
- [ ] I added or updated a regression test for a bug fix.
- [ ] I updated `CHANGELOG.md` for a user-visible change.
- [ ] I updated documentation for a behaviour or setup change.
- [ ] I did not add a runtime npm dependency.
- [ ] I did not commit secrets, personal paths or third-party artwork without a
      license.
- [ ] My contribution is licensable under the project license; I have read
      [`CONTRIBUTING.md`](../CONTRIBUTING.md).
