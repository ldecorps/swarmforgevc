# BL-803 promote-route-sed-bsd-portability — 20260805 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `b100f23457` (ancestor chain: coder `555712b0` → cleaner)
into the architect worktree and reviewed the combined parcel. No files
under `extension/` are touched (a shell-script fix plus Gherkin step
wiring only), so `dependency-gate.js` does not apply to this parcel —
noted rather than silently skipped. No `.dependency-cruiser.cjs`-relevant
boundary (webview/host-IO/secrets/storage) is in scope either, for the
same reason.

## Logical coupling: co-change-report.js

Ran against the three functionally-changed files:
`swarmforge/scripts/promote_and_route_next.sh`,
`specs/pipeline/steps/bl803PromoteRouteSedBsdPortabilitySteps.js`,
`specs/pipeline/steps/index.js`. All reported coupling is expected: the
script co-changes (1-2x, below the frequency-3 SUSPECTED threshold) with
its own priority test (`test_promote_and_route_next_priority.sh`), the
sibling `bl663PromotionGatesSteps.js` step file it now shares
promotion-gate plumbing with, and the gates scripts it shells out to. The
new step file co-changes only with its own registration
(`specs/pipeline/steps/index.js`) and the script it drives — the exact
sibling shape BL-351 established as clean. `index.js`'s own long list of
SUSPECTED COUPLING entries is registration-hub noise (nearly every feature
in the repo touches it) matching the same precedent, not new coupling
introduced by this parcel.

## Correctness / boundary checks

- Ticket declares no `invariants:` field — Invariants Review is a no-op
  for this parcel.
- Read the actual fix (coder commit `555712b0`,
  `swarmforge/scripts/promote_and_route_next.sh` line ~218): replaces
  `sed -i "s/.../.../ " "$DEST"` (GNU-only — BSD/macOS sed requires a
  suffix operand) with `sed "..." "$DEST" > "$SED_TMP"; cat "$SED_TMP" >
  "$DEST"; rm -f "$SED_TMP"`. Neither flavor's `sed` invokes `-i` at all,
  so the same code path now runs identically on both — correctly targets
  the defect (script died mid-promote, after `git mv` but before the
  promotion commit, on this BSD/macOS host). `cat > "$DEST"` writes into
  the existing file rather than `mv`-ing a fresh temp file over it,
  preserving `$DEST`'s original mode bits, exactly as the fix's own
  comment claims — verified by reading the code, not trusting the
  comment.
- `mktemp` with no path argument (default `$TMPDIR`/`/tmp`) matches this
  script directory's own established convention
  (`handoff-lib.sh`, `gherkin_lint_gate.sh`, `inject_traffic.sh`,
  `reexpedite_from_wip.sh` all use bare `mktemp` for scratch files) — not
  a deviation the workflow's `./tmp/`-for-agent-scratch rule was aimed at.
- Ran the acceptance feature directly:
  `node specs/pipeline/cli.js specs/features/BL-803-promote-route-sed-bsd-portability.feature`
  — both Scenario Outline examples (`bsd`, `gnu`) pass (2/2). The step
  file's `KNOWN_SED_FLAVORS` map validates the Outline's `<sed_flavor>`
  column against explicit fake-sed bodies (BSD stub reproduces the exact
  `"invalid command code"` failure this ticket cites; GNU stub replicates
  real GNU `-i` semantics) rather than a bare passthrough, per the
  Scenario Outline rule. Both stubs delegate non-`-i` invocations to the
  real system `/usr/bin/sed`, so the fixture measures the fix's own
  portable code path, not a mocked substitution.
- Re-ran the pre-existing regression test
  `swarmforge/scripts/test/test_promote_and_route_next_priority.sh` —
  still passes; the sed-flavor fix does not disturb the priority/skip
  logic it covers.
- No pure/testable JS module was touched in a way that leaves a
  round-trip/idempotence/ordering property undercovered — the new step
  file is fixture/integration-test code exercising a real shell script and
  a real filesystem, not a pure module fast-check would target. No
  property-test action needed this pass.

No violations found. Forwarded to hardener with the same task name.
