# BL-1387 — architect re-review (D2 fix), 2026-09-04

Reviewed coder commit `6a6a052d05` (tip-pure rebuild for D2, merged in via
cleaner `a5a97bf1df`).

## D2 verified fixed

Scenario `an-owned-merge-is-the-daemons-not-a-humans-06`'s two previously
missing step handlers are now present in
`bl1387OrphanedMergeSurfacedSteps.js`:
- `the open merge is classified as the daemon's own`
- `the surfaced reason is neither human-merge-in-progress nor orphaned-merge`

`run_acceptance.sh` on the BL-1387 feature — 8/8, independently re-run.

## D1 and its own follow-on fix still intact

Re-checked directly rather than assumed carried-forward:
- `absorb-dispatch-plan`'s `contains? #{:skip-human-merge-in-progress
  :skip-orphaned-merge :abort-owned-merge}` propagation fix — present.
- `open-merge-outcome` wired into both `post_hotfix_merge_origin_lib.bb`
  call sites — present.
- `master_main_reconcile_lib_test_runner.bb`,
  `post_hotfix_merge_origin_lib_test_runner.bb`,
  `master_main_reconcile_lib_property_runner.bb` (500 runs) — all green.

## Dependency gate

`bl1387OrphanedMergeSurfacedSteps.js` — PASSED, no forbidden edges.

## Rebuild technique note

The coder independently hit the same `task_scope_gate` (BL-1192) entangled-
tip refusal I hit reviewing this same ticket, root-caused it correctly (a
receive/sync merge subject must never name a ticket id — the rule was
already written down and not applied), and resolved it with the sanctioned
`abandoned_commits` + tip-pure-rebuild-on-origin/main pattern rather than
my own scratch-worktree patch approach. Cleaner rather than what I did;
worth remembering for next time this class of gate fires.

## Verdict

COMPLIANT. Both bounces (D1, D2) confirmed fixed and independently
re-verified. Forwarding to hardener.
