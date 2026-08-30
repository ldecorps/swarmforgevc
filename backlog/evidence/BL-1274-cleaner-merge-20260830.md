# BL-1274 — cleaner: merged coder's bounce-fix, recovered a criss-cross-merge drop

Cleaner, 2026-08-30. Merged coder's resubmission `b7ea963a9d` (fixes the
`git show HEAD:<file>` D1 defect from my 2026-08-29 bounce, evidence:
`backlog/evidence/BL-1274-bounce-20260829.md`) on top of my branch tip
`30ed47336`.

## What the merge got wrong, and the fix

`b7ea963a9d`'s true functional ancestor is `a2e4db6164` (coder's original
commit, which I had reverted whole via `8125fb9b1` per the bounce-revert
rule, since the bounce covered the whole commit even though only the
step-file comparison was defective). Because an unrelated, more-recent
common ancestor (`d8f64f572`, BL-1246) also sits in both branches' history,
`git merge` picked it as the effective 3-way base for two files it never
touched — `extension/test/bl787NamedTunnelInvariants.property.test.js` and
`swarmforge/scripts/launch_resident_spy_tunnel.sh`. Relative to that base,
my revert "changed" those files (back to the pre-fix state) while `b7ea963a9d`
"didn't" (it never re-touched them, relying on `a2e4db6164` already being
there) — so the auto-merge silently kept my reverted (pre-fix) content and
dropped the coder's already-verified-non-regression functional fix, with NO
conflict raised.

Caught by re-running this ticket's own acceptance feature after the merge:
scenario 03 failed with a NEW error ("could not read the post-change
budget: {\"attempts\":0,\"interval\":0}") instead of the old one — the step
file's regex was hunting for `LAUNCH_SEAM_ATTEMPTS`/`LAUNCH_SEAM_INTERVAL`,
constants that only exist in `a2e4db6164`'s rewrite of the property test
file, which the merge had dropped.

Fixed by `git checkout b7ea963a9d -- <both files>` (commit `3a0920e7f`),
restoring them to the coder's intended tip state exactly.

## Verification after the fix

- `node specs/pipeline/cli.js specs/features/BL-1274-...feature` → 4/4 pass
  (was 3/4 before the recovery commit).
- `bl787NamedTunnelInvariants.property.test.js`, invariant 1, run 3x in
  isolation: 3/3 green, ~0.35-0.44s each (was ~62s under load pre-fix).
- `swarmforge/scripts/test/test_launch_resident_spy_named_tunnel.sh`: all
  named-01/02/03 assertions pass — confirms the launcher's new `main()`
  entry-point guard didn't change its behavior when EXECUTED (its only real
  call sites: `start_ancillary_services.sh`, `setup_bubble_named_tunnel.sh`
  both `bash` it, never source it).
- No third widening: `SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS` /
  `_WAIT_INTERVAL` / `SUBPROCESS_HEAVY_TIMEOUT_MS` no longer appear in the
  property file at all (invariant 1 no longer spawns a real subprocess).

## Out of scope, not touched

A full `vitest run` on `extension/` shows 219 pre-existing failures across
27 files (bridgeServer, epicReorderBridge, pausedPagerBridge, topicMakeTop,
pilotAcceptanceGate, etc.) — none reference tunnel/launch/readiness/BL-1274
at all, and none of the files this ticket touches. Standing breakage,
unrelated to this ticket; not in scope to fix here.

## Mutation-site count / CRAP / DRY

Not applicable: every file this ticket changed is a shell script
(`launch_resident_spy_tunnel.sh`), a test file
(`bl787NamedTunnelInvariants.property.test.js`), or acceptance-pipeline
step/registry code (`specs/pipeline/steps/*`) — none is `extension/src`
compiled to `out/`, so the mutation-site-count tool, Stryker, and CRAP/DRY
gates do not apply (Design And Testability: shell scripts are gated by
their own unit-test suite only; cleaner does not maintain acceptance
tests/Gherkin).

Forwarding to architect.
