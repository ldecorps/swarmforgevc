# BL-1868 coder stamp-off review of hotfix a2173a96ea (2026-10-02)

Reviewed, not re-applied. No defect found; no code change in this parcel.

## Invariant 1 (identical tip never escalates, builds nothing)
- `land-plan` cond: `tip-is-origin-main?` returns `{:action :nothing-to-replay :paths [] :origin-main sha}`
  before any walk/replay/register work. Unit case (full + short sha) asserts no `:commit`, no new branch.
- Non-sha ref (`origin/main`, `HEAD`): `rev-parse -q --verify <ref>^{commit}` resolves it to a sha
  and compares with origin/main, so it answers the same - correct.

## Invariant 2 (other tips unchanged)
- `:origin-main nil` (unresolvable): `tip-is-origin-main?` is false (`when origin-main`), falls to the old body.
- Self-call: fires only when `:origin-main` key is absent and always assoc's it, so it recurses at most once
  (even with a nil value, `contains?` is then true). origin/main still resolved once (BL-1431).
- Old body is textually unchanged apart from reading `(:origin-main opts)` directly.

## Consumers of land-plan
- Production: `swarmforge/scripts/land_step_cli.bb` only (grep of `land-plan` in swarmforge/scripts *.bb).
  Its `:nothing-to-replay` clause prints LAND_ESCALATE + BL-1713's reason byte for byte, exit 1.
  `land_main_publish.sh` / BL-1872's lander read CLI output, which is unchanged. No misreporting caller; no note owed.

## Runs on this tree (coder 1e64d111cf + merge of main a4adaca7ff)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- BL-1343 feature: 6/6 ok. BL-1678: 4/4 ok. BL-1713: 4/4 ok.
