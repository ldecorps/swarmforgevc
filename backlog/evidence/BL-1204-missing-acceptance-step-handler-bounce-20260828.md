# BL-1204-missing-acceptance-step-handler cleaner bounce — 2026-08-28

## D1: acceptance step handler races the async redeploy dispatch (correctness)

`specs/pipeline/steps/bl1204RedeployTargetsReachableAndListedSteps.js`
(coder commit `402bfc208c`) calls `executeOperatorVerb(st.root, '/redeploy',
target)` and immediately, synchronously, asserts the target's marker file
exists (`fs.readFileSync(st.marker, ...)`). Every one of
`startFrontDeskRedeployRun`/`startAllRedeployRun`/`startMiniAppRedeployRun`
spawns its script `detached: true` with `child.unref()` — a deliberate,
correct fire-and-forget so the redeploy (which bounces the very process
running the bridge) doesn't block the caller. The marker write therefore
races the assertion and loses almost every time.

Confirmed NOT a production misroute: isolated repro (`executeOperatorVerb`
called directly against a real fixture + stub script) shows the marker is
absent immediately after the call returns and present ~300ms later. The
dispatch reaches the right module every time; only the acceptance step's
synchronous check is wrong.

Reproduced via `specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature`:
3 of 4 scenarios fail (`ENOENT ... frontdesk.marker` /
`all.marker` / `miniapp.marker`), only scenario 02 (help-text/parser
parity, no spawn involved) passes. Commit message claims "4/4 pass on
first run" — not reproducible on this content; every run here is
consistently 1/4.

**Remediation pointer**: the Then step needs to wait for the marker (poll
with a bounded timeout, or have the stub script write synchronously with
`spawnSync` swapped in via `startFrontDeskRedeployRun`'s `spawnFn`
parameter — all three modules already accept an injectable `spawnFn` for
exactly this kind of test seam) before asserting on it.

## Complete inventory
No other defects found. `tsc --noEmit` / `npm run compile`: clean.
Mutation-site count for the new file: 101 (marginally over the 100
advisory threshold; single-feature cohesive shape, not itself a finding).

## Not merged
This parcel's merge was aborted before commit (`git merge --abort`) rather
than merged-then-reverted — the merge had not yet been committed in this
worktree, so no revert was needed and BL-490/BL-495 does not apply.

By cleaner.
