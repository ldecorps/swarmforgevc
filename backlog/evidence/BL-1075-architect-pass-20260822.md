# BL-1075 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `af069f8d2f` (cleaner, pure merge of coder `37e12a71e` — no
additional cleaner diff on BL-1075 files) into the architect worktree.
Merged cleanly, no conflicts. Recompiled `extension/out/` before running any
tool against it (`npm run compile`, clean, no drift), per
[[architect-stale-build-gotcha]].

## Scope

Four call paths stop applying a `window-size largest` mitigation that a
component of the same product (the extension's tiling panel, via
`resize-window`) unconditionally overrides at a narrower (window) scope:
`swarmforge/scripts/swarmforge.sh` `harden_tmux_server` (shell launch + shell
ensure) and `swarmforge/scripts/control_plane_lib.bb` `harden-server!` (plane
restore + plane already up). `focus-events off` is untouched on all four.
`docs/how-to/BL-tmux-wsl-segfault-upgrade.md` stops naming a window-size
option as a soft mitigation and keeps saying the version upgrade is what
protects the host. New feature + step handler
(`bl1075WindowSizeOwnershipSteps.js`, registered in
`specs/pipeline/steps/index.js`) and property runner
(`bl1075_window_size_ownership_property_runner.bb`), both exercising the
mitigation against a REAL tmux server rather than the call sites. No
`extension/src/**` production file touched at all — `paneTailer.ts`, the
load-bearing half the ticket explicitly warns not to declare victory by
touching alone, is unmodified (confirmed: empty diff against `main`).

## Architecture

- Integrate-not-fork: legitimate maintenance of the project's own maintained
  SwarmForge fork under `swarmforge/scripts/` (Local Engineering
  Architecture Rule 2), not a violation of "don't modify SwarmForge" (that
  constraint governs the extension's runtime relationship to a user's
  separately-installed SwarmForge).
- No webview/extension-host boundary touched, no secrets touched, no
  browser storage touched — nothing in `extension/` changed.
- The fix removes a setter, it does not add one: `harden_tmux_server` and
  `harden-server!` keep their `focus-events off` line untouched and only the
  `window-size largest` line is deleted, on all four paths — verified by
  reading the diff, not the description.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

Full-repo scan (no TS production file in this parcel's scope; passing the
parcel's own changed files errors immediately since none live under
`extension/`, which is expected — depcruise's config root is `extension/`):

    Dependency-rule gate FAILED:
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorExec.ts violates "acyclic"
      src/tools/telegram-front-desk-bot.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"
      src/tools/telegramCursorOperatorExec.ts -> src/tools/telegramCursorOperatorLiveness.ts violates "acyclic"

Identical to the three edges recorded in `BL-1029-architect-pass-20260822.md`
and `BL-1069-architect-pass-20260822.md` (same day, sibling/prior parcels) —
already tracked as `BL-759` (paused), per
[[architect-grep-exact-filenames-before-worth-a-ticket-note]]. None of this
parcel's files touch either side of the cycle. Not this parcel's scope.

## Co-change (`node extension/out/tools/co-change-report.js`)

Run against all five changed files. `swarmforge.sh`, `control_plane_lib.bb`,
and the how-to co-change with each other at SUSPECTED-COUPLING frequency —
expected: they are the three call-path files plus the doc this ticket's own
invariants require to change together, and this parcel's own commit is one
of the co-changes the tool is counting. The step handler and property runner
co-change only with this parcel's own files (evidence file, doc, the two
production files, `index.js`). Nothing outside the ticket's declared scope
shows up. No new structural coupling.

## Invariants review (BL-654/BL-633) — all three declared, all real, all verified

| # | Invariant | Test | Verified myself |
|---|---|---|---|
| 1 | never apply/document a window-size mitigation the panel overrides per window | property runner P1 (12 real servers, mechanism measured directly: `manual` in window options vs `largest` still at the global) + feature scenario 01 | Ran green myself. Read the coder's non-vacuity claim (break: restore either setter, P1 fails) — did not need to re-break it myself since the property runner's own "mechanism measured" block already proves the premise against a live server on every run, not just at authoring time. |
| 2 | dropping the inert knob never drops a live one, shell and bb alike | property runner P2 + feature scenario 02 (4 Examples rows) | Ran green myself. Confirmed the coder's own catch is real, not just claimed: `focus-events` is `off` by default on a fresh tmux server (checked by hand: `tmux -S <fresh-socket> show-options -gv focus-events` → `off` with nothing run), so the fixture turning it `on` first before hardening is what makes "off afterwards" mean anything. Read both hardening functions: neither drops the `focus-events` line. |
| 3 | tile sizing survives the change, per role | property runner P3 (mixed-heights + default-rows reach floors) + feature scenario 03 | Ran green myself. The generator's two deliberate reach floors (a window sized differently from its siblings; a window left at the 80x24 default) are real per-run measurements (`{:mixed-heights 11 :default-rows 8}` this run), not just floors on paper. |

No missing/vacuous property test found for any of the three. All three are
measured against a real tmux server, never the call sites — matching the
ticket's own explicit instruction, because the defect is a scope rule
invisible in source (both writers look correct in isolation).

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

No touched module is a new pure-logic surface beyond what the three declared
invariants already cover. `swarmforge.sh` and `control_plane_lib.bb`'s
changes are both pure deletions (one line each) inside functions the
existing invariants already exercise end to end; the how-to is prose. The
new step handler and property runner are test infrastructure, not
production logic. Nothing to add.

## Correctness read-through

Read all four call-path deletions and the doc edit end to end (diff, both
commits). Confirmed by hand against a fresh tmux server (not just trusting
the runner) that `focus-events` really is `off` by default pre-hardening —
the exact fact the coder's evidence says made their P2 check vacuous when
first written; the fixture in both the step handler and the property runner
correctly turns it `on` first. No leftover reference to `window-size` as a
mitigation anywhere in the how-to (`grep -n window-size` on the doc: only
the two lines explaining why it was dropped). No defect found.

## Verification re-run live (not trusted from the commit message)

- `npm run compile` (from `extension/`): clean, no diff, before running the gate.
- `node extension/out/tools/dependency-gate.js` (full-repo, post-compile):
  same 3 pre-existing BL-759 edges, confirmed above.
- `node extension/out/tools/co-change-report.js` on all 5 parcel files:
  reviewed above.
- `bb swarmforge/scripts/test/bl1075_window_size_ownership_property_runner.bb`
  → `ALL 12 SERVERS PASSED {:mechanism-measured 1, :mixed-heights 11,
  :default-rows 8, :path-shell 6, :path-bb 6, :doc-read 1}`.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1075's feature → **7/7**.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature → parses cleanly.
- `zsh -n swarmforge/scripts/swarmforge.sh` → syntax OK.
- `bb -e '(load-file "swarmforge/scripts/control_plane_lib.bb")'` → loads clean.
- `required_wiring` verified directly, not by grep-for-comment: `index.js`
  line 594 is a live `require('./bl1075WindowSizeOwnershipSteps')` inside the
  `DOMAINS` array actually iterated by `registerSteps`, per
  [[required-wiring-anchor-goes-vacuous-not-absent-on-a-file-split]].
- Fixture hygiene confirmed on the live host, not just read: after running
  the property runner and the acceptance suite, `tmux -S
  "$(cat .swarmforge/tmux-socket)" list-sessions` still shows all 8 live
  swarm sessions untouched, and no `/tmp/bl1075-*` directory or `bl1075`
  process survives either run.

## Verdict

**NONE.** No architecture violation, no invariant gap, no correctness defect
in the parcel. Forwarding to hardener.

Note, not a bounce: `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh`
sits untracked in this worktree, pre-existing and unrelated to BL-1075 —
already surfaced and ticketed as BL-724 per
[[stray-mono-router-auto-rotate-test-unticketed]]. Left untouched.

— By architect.
