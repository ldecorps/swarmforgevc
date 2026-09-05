# BL-1421 — architect pass, 2026-09-05

Ticket: BL-1421-one-standing-surfacing-per-role
Role: architect
Commit reviewed: 48931c7d10 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1421OneStandingSurfacingSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is entirely in Babashka daemon/lib code
  (`handoffd.bb`, `post_qa_branch_sweep_lib.bb`) and a Node step handler
  using only `node:path`/`node:child_process`/`node:fs` — no webview
  import, no VS Code API, no secrets, no browser storage.
- **Co-change report**: only the expected `post_qa_branch_sweep*` sibling
  family (BL-668's own lib/CLI/steps/docs) and `handoffd.bb` (the daemon
  file every fact-supplier lives in) — pre-existing structural coupling,
  nothing new or suspicious introduced by this diff.

## Invariants Review (BL-633/654)

Ticket declares three invariants; the property runner
(`bl1421_one_standing_surfacing_property_runner.bb`) encodes them, shown
non-vacuous by the coder's own break-then-fix record
(`backlog/evidence/BL-1421-coder-20260905.md`). Independently re-ran:

```
generator coverage: {:p1-len-over-5 339, :p1-has-a-recatch-tell 454, :p2-dirty-true 263, :p3-some-throwing 455}
bl1421 one-standing-surfacing properties: 500 runs each
ALL PROPERTIES HOLD
```

Also independently re-ran the unit/replay suite:

```
bb post_qa_branch_sweep_lib_test_runner.bb → ALL PASS
```

which carries both the new BL-1421 replay/precedence cases AND BL-1361's
original scenarios unedited (per the ticket's own "BL-1361's feature is not
edited" constraint) — confirms no regression to the existing tell/wake
contract.

Traced the state-machine correctness by hand:
- `normalize-state-for-landed` now resets only `:settled`, preserving
  `:surfaced` across a landed-sha change — the fix for invariant 1's "a
  newer landed sha alone never re-tells."
- `decide-role`'s `in-process?` clause was moved ahead of `dirty?` —
  correctly reads a mid-parcel role's necessarily-dirty tree as
  `in-process-work` (told, deferred) rather than `dirty-worktree` (woken),
  matching the human's BL-1361 ruling and invariant 2.
- The coder's own audit finding (documented, not silently fixed) — the
  `:settle`-fails path used to call `record-surface!`/log
  unconditionally, bypassing the `surface-already-recorded?` check that
  `:surface` already had — is now unified through one `surface-or-suppress`
  helper shared by both call sites. I confirmed by reading both call sites
  in `sweep-one-role` that they now share the identical suppression logic;
  this was IN scope (it's the same mechanism this ticket is fixing,
  `:divergent-branch` is one of the three reasons this ticket's own
  invariant 1 covers), not a scope-creep fix.
- `record-surface!` upserts (removes any existing entry for the same
  role+reason before appending) rather than accumulating duplicate
  records — checked this prevents an old stale record from shadowing a
  fresh one in `told-sha-for`'s `some` lookup (which would otherwise return
  whichever matched first, an ordering-dependent bug the upsert avoids).

## Acceptance wiring

Feature declares 4 scenarios / 6 scenario runs. Independently drove
`bl1421OneStandingSurfacingSteps.js::registerSteps` against all 6 runs with
my own harness — all passed, including the 103-commit replay (scenario
04: told exactly once, woken exactly once). `registerSteps` export present
per the ticket's `required_wiring` anchor (BL-1371);
`grep -n caught-up-to-told? swarmforge/scripts/handoffd.bb` matches the
other `required_wiring` anchor, and I traced the wiring: `caught-up-to-told?`
is passed as the `:caught-up-to-told?` adapter into
`post-qa-branch-sweep-lib/sweep!`, which the lib's
`caught-up-to-told-fact` consults — not a decorative grep-match only.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
