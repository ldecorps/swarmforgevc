# BL-1309 — documenter re-pass on hardener addendum (2026-09-03)

## Context

Second inbound for BL-1309 today, forked from the same base
(`977fe447de`) as the first but on a separate line: architect/hardener
independently found and reconciled a duplicate `mkTmpDir` import
(`b7687ffed6`, addendum to `backlog/evidence/BL-1309-hardener-20260903.md`)
— two sessions (coder mid-work on a later ticket via BL-1280's guard, and
the hardener's own pass) closed the identical `mkdtempSync` → `mkTmpDir`
fixture-helper gap, and merging both left one duplicate `require(...)`
line, caught and removed. Re-verified: property 2/2, unit runner 9/9,
mutation sweep 6 killed/2 equivalent/0 survived, BL-1144 regression 9/9,
acceptance 6/6, guard sweep clean of `tmpDirMigrationGuard`.

Merged `b7687ffed6` (`b0aefda666`). Confirmed my prior doc/spec/evidence
commit (`d51f287840`) is still an ancestor of this worktree's HEAD — the
merge did not drop it, it only forked from an earlier base.

## Review

This addendum touches only a test-fixture helper import
(`newFixture()`'s temp-directory creation) — no production behavior, no
marker text, no exit code, no ruling, no operator-facing call changed.
Everything the earlier documenter pass
(`backlog/evidence/BL-1309-documenter-20260903.md`) described in
`docs/how-to/BL-1144-frequent-qa-push-races-on-main-land.md` and
`docs/reference/Specification.MD` remains accurate as written — confirmed
by re-grepping `ENTANGLED_SIBLING_BLOCK`, `exit 3`, and the guard-line
placement in `land_main_publish.sh`, unchanged by this addendum.

## Findings

NONE.

## Verdict

No documentation change required. Forward to QA.
