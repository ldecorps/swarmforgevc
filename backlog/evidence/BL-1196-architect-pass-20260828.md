# BL-1196 — architect pass, 2026-08-28

Commit reviewed: 71f23eff27 (cleaner, verifying coder fix 4faabe579).

## Backlog placement note
Confirmed this ticket was previously misfiled in `backlog/done/` with
`status: todo` (never actually implemented) — matches this session's own
prior finding that a coordinator "identical content" retire claim was
false. The coder/specifier correctly moved it back to `backlog/active/`
rather than silently re-shipping under a stale done/ marker. Not a defect
in this parcel; noting for the record since it's directly relevant to a
tracked incident.

## Architecture
Pure structural fix: `gitEnvGuard.js` exports a testable
`stripAmbientGitDirRedirect()`; `gitEnvGuardSetup.js` calls it at module
top level, same split as the existing `envRestoreGuard.js`/
`envRestoreGuardSetup.js` pair. No `extension/src/**` touched — dependency
gate re-run repo-wide (full scan, appropriate for a structural
setupFiles-wide change): PASSED, no forbidden edges.

## required_wiring
Both entries confirmed present:
- `extension/vitest.config.mjs`: `./test/helpers/gitEnvGuardSetup.js` added to `setupFiles`.
- `extension/vitest.properties.config.mjs`: same, added to the property lane's `setupFiles`.

## Invariant (declared)
"No test file's git() spawn is directed by an inherited ambient GIT_DIR or
GIT_WORK_TREE ..." — Encoded and **independently confirmed non-vacuous**:
`gitEnvGuard.test.js`'s integration-shaped test asserts the PRECONDITION
that an unstripped ambient redirect genuinely redirects an unguarded spawn
onto a decoy repo (`beforeStripToplevel` resolves to the decoy, not the
target) before asserting the post-strip fix — this is not a tautological
test, it demonstrates the vulnerability is real and then demonstrates it's
gone.

## Constraints
- The ~60 existing per-file `git()` helpers are untouched (by design, per
  ticket) — confirmed no per-file edits in the diff beyond the two new
  helper files, two config registrations, and the new test file.
- `sampleResourcesCli.test.js` (the one file that manages GIT_DIR/
  GIT_WORK_TREE itself mid-test) verified unmodified and still green
  (9/9 pass) — the setup-time strip does not interfere with a test's own
  later explicit management of those vars.

## Verification run
- `npm run compile`: clean.
- `gitEnvGuard.test.js` + `sampleResourcesCli.test.js`: 13/13 pass.
- BL-1196 acceptance feature: 2/2 pass.
- `dependency-gate.js` (full repo scan): PASSED.

NONE outstanding. Forwarding to hardener.

By architect.
