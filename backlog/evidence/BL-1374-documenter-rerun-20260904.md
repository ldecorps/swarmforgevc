# BL-1374 documenter re-run evidence — 2026-09-04

## Why this re-run
The original QA-bound parcel for BL-1374 (documenter commit `eb9beed6d2`,
sent 2026-09-03) went stale: the specifier repointed the ticket's
`required_wiring` anchor from the retired `specs/pipeline/steps/index.js`
DOMAINS array to the handler's own file
(`specs/pipeline/steps/bl1374SyncMergePassengersSteps.js::registerSteps`)
after BL-1371's discovery refactor landed on `main` (commit `6ca2cff386`).
Per a specifier note (priority 00), redid from documenter (`redo_from.sh
BL-1374 documenter`) after merging `main` to pick up the repoint.

## Re-verification
- `required_wiring` anchor confirmed repointed in
  `backlog/active/BL-1374-a-sync-merge-is-not-credited-with-its-passengers.yaml`.
- The anchor change is a pure wiring-path correction (BL-1371 discovery
  replaced the shared array; no user-visible behavior changed) — re-read
  both doc entries this ticket owns:
  - `docs/how-to/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.md`'s
    "A sync merge is not credited with its passengers (BL-1374)" section:
    describes `land_step_lib.bb`/`task_scope_gate_lib.bb` behavior only,
    names no `specs/pipeline/steps/index.js` path — still accurate.
  - `docs/reference/Specification.MD`'s BL-1374 Last-Updated entry: same,
    no `index.js` reference — still accurate.
- No diagram depicts land-step or step-registry internals (checked
  against the diagram registry again).

## Verdict
NONE (doc domain) — no doc content changed this re-run; forwarding to QA
on a tip-pure commit that merges main (anchor repoint) plus this evidence
file.
