# BL-1782 — coder bounce fix, 2026-09-30

Hardender review (evidence `BL-1782-hardender-bounce-20260930.md`) found
`verification_debt_ledger_update.bb`'s revert-on-commit-failure path
leaves a phantom header-only ledger file on disk when the commit failure
happens on the VERY FIRST record against a fresh repository (no ledger
file existed before the attempt) - `before` (the row vector read prior to
the write) is `[]` for both "no file" and "file exists, zero rows", so
the revert always re-renders and writes a header-only file, even where no
file existed a moment before.

## Fix

Capture the file's actual pre-write state as a fact - `(fs/exists?
ledger-path)` and, if it existed, its raw text - before ever writing. On
a commit failure: restore the exact raw text when the file existed
before, or delete the file entirely when it did not. `before`'s row
vector is unaffected (still used to compute `recorded?`); only the revert
path now distinguishes "existed with zero rows" from "did not exist".

## Verification

- Reproduced the defect directly per hardender's own repro (a mkdtemp
  root with `backlog/paused`/`backlog/active` and no `.git` at all,
  forcing `commit-with-integrity!`'s `:no-git-dir` refusal
  deterministically), then confirmed it is gone: no
  `backlog/verification-debt-ledger.yaml` is left behind.
- Confirmed the OTHER case (a real git repo, one real row already
  committed, `.git` removed before a second record) still restores the
  file byte-for-byte identical (sha256 compared before/after).
- New `swarmforge/scripts/test/test_verification_debt_ledger_cli.sh`
  (registered in `suite-manifest.tsv`), both cases above as permanent
  regression checks: ALL PASS.
- `bb swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb`:
  ALL PASS (unaffected - the pure lib is untouched by this fix).
- `node specs/pipeline/cli.js specs/features/BL-1782-hand-verifications-are-recorded-in-a-verification-debt-ledger.feature`:
  13 of 13 ok (unaffected - no existing scenario's fixture ever forces a
  commit failure).
- `npm test` (extension/): 640 files, 10904 tests, all pass.
- `npm run test:properties` (extension/): 479 files, 1376 tests, all pass
  (3 unhandled-error lines are the allowlisted BL-871 noise).

By coder.
