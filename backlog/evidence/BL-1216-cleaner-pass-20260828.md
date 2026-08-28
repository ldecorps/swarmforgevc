# BL-1216 cleaner pass (2026-08-28)

## What I did

Merged coder handoff `54c08de4ad` (BL-1216: a DUPLICATE-ID finding names
the live copy and flags content divergence) into the cleaner worktree —
clean auto-merge, no conflicts.

## Scope check

Babashka/Clojure module (`swarmforge/scripts/backlog_hygiene_lib.bb`) plus
its bb unit tests and new acceptance step handlers. Per this project's
Startup Tools rule, Babashka/Clojure has no mutation/CRAP/DRY tooling
wired (BL-472 deferred) — gated only by its own unit-test suite, which I
ran below. No `extension/src/**` `.ts` file touched, so
`mutation-site-count.js` and `jscpd` are not applicable to this parcel.

## Cleanup Order applied

- Unit tests: `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb`
  — all 37 assertions pass, including the new `path-pool`,
  `pool-classification`, `content-verdict` (identical/differs/unreadable-
  fails-closed/requires-every-other-to-match), `sole-live-keep`, and
  `ticket-id-from-filename` cases.
- Property suite: `bb swarmforge/scripts/test/backlog_hygiene_lib_property_runner.bb`
  — 300 runs each, ALL PROPERTIES HOLD.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh` on
  `BL-1216-duplicate-id-finding-names-the-live-copy-and-flags-divergence.feature`
  — 8/8 pass. Sibling `BL-1105-a-duplicate-ticket-id-is-refused-at-mint.feature`
  (shares `duplicate-id-violations`) — 8/8 pass, unaffected.
- Backward-compat check: grepped every `format-violation` call site
  (`backlog_epic_milestone_audit.bb`, `specifier_backlog_hygiene_gate.bb`)
  — both use the pre-existing single-arg call, which now defaults to
  `slurp` via the new 2-arity — no caller needed updating, confirmed by
  running `backlog_epic_milestone_audit.bb` (runs clean, no crash) and the
  CLI gate directly (`specifier_backlog_hygiene_gate.bb` against BL-1216's
  own ticket file — new pool tags and `CONTENT IDENTICAL` verdict render
  correctly; the DUPLICATE-ID hit itself is the pre-existing, explicitly
  out-of-scope BL-1194 self-collision false positive in `other-holders`,
  not a regression from this parcel).
- Structure: new pure functions (`path-pool`, `pool-classification`,
  `content-verdict`, `sole-live-keep`, `describe-path`, `safe-read`,
  `ticket-id-from-filename`) are each single-purpose and docstringed; the
  only I/O (`content-verdict`'s file read) goes through an injectable
  `read-fn` seam per this project's inject-side-effects rule, defaulting
  to `slurp` for the CLI. No duplication found.

## Verdict

No cleanup changes needed. Forwarding to architect unchanged.
