# Engineering reports

These documents record the audits and verification rounds behind the current
release. They are kept for traceability, not as user documentation: the code,
the gates and `docs/ARCHITECTURE.md` are the source of truth when they disagree.

| Report | Scope |
|---|---|
| [`AUDIT_REPORT.md`](AUDIT_REPORT.md) | Full repository audit: findings, fixes, remaining risk |
| [`FIXES_APPLIED.md`](FIXES_APPLIED.md) | Every fix in the round, with the evidence that proves it |
| [`SECURITY_REPORT.md`](SECURITY_REPORT.md) | Electron security review: IPC guard, CSP, sandbox, dependencies |
| [`PERFORMANCE_REPORT.md`](PERFORMANCE_REPORT.md) | Measured and structural performance work |
| [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) | Known, intentionally open debt and its exit criteria |
| [`TEST_COVERAGE_REPORT.md`](TEST_COVERAGE_REPORT.md) | Gate inventory, counts and the honest retry policy |
| [`PROJECT_AUDIT.md`](PROJECT_AUDIT.md) | The pre-publication audit, kept as history |

Reports reference each other by file name inside this folder, so links keep
working when the folder is moved as a whole.

Verification numbers in these files were measured on Windows. macOS and Linux
packages are built and validated by the release workflow; hardware and
interactive GUI checks that were not run are marked as such in each report.
