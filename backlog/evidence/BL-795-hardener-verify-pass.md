# BL-795 — hardener verify pass

No production `.bb` files changed in this pass; this ticket carries no
`extension/` (TypeScript) files, so the Stryker mutation gate, `crapReport.js`
(scoped to `src/*.ts`), and jscpd (scoped to `extension/**/*.ts`) are all N/A
(engineering.prompt Startup Tools: Babashka/Clojure mutation/CRAP/DRY tooling
is not wired — the project's own `.bb` unit-test suite is the real gate here).

## Independently re-ran every gate rather than trusting prior evidence

```
$ bb swarmforge/scripts/test/mono_router_lib_test_runner.bb
mono_router_lib_test_runner: ok

$ bash swarmforge/scripts/test/test_chase_sweep.sh
... 19/19 scenarios PASS, including 06 (escalation keeps waking)

$ bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh
PASS: A / PASS: B / PASS: C — ALL PASS

$ bb swarmforge/scripts/test/mono_router_actionable_rule_proposal_property_runner.bb
500 runs — ALL PROPERTIES HOLD

$ bb swarmforge/scripts/test/chase_sweep_alert_resume_property_runner.bb
500 runs — ALL PROPERTIES HOLD

$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-795-mono-router-starvation-hand-fix.feature
5/5 scenarios pass

$ node --test specs/pipeline/test/stepRegistry.test.js specs/pipeline/test/runtime.test.js specs/pipeline/test/generate.test.js
30/30 pass — no regression in shared pipeline infra from the additive
index.js require entry
```

Pre-existing environment-only failures reconfirmed (not a regression, not
in this ticket's scope): `test_handoffd_starve_rotate_wiring.sh` fails on
this host with `mapfile: command not found` (macOS system `/bin/bash` 3.2
has no `mapfile` builtin) — same failure independent of this diff.

## Coverage-gap review (no mutation tool wired for `.bb`)

Read the full `mono_router_lib.bb` / `handoffd.bb` / `chase_sweep_lib.bb`
diff directly. One known gap, already surfaced and reasoned about by both
the coder (BL-795-coder-adopt-pass.md item 2) and the architect (bounce
evidence: "reasoning reviewed and accepted... no invariant violation found
on hand review"): `chase-rotate-to!`'s redirect branch (and the extracted
`attempt-resident-rotate!` helper) is exercised only at the precondition
level (`--print-preferred-rotate-target`, scenario C), not through an actual
live-tmux `--poll-once` drive — reaching it requires a real tmux socket plus
chase-sweep stuck-timing setup, which the project's own established pattern
(`bl651AgedWorkRotationSteps.js`) and this ticket's own scope ("adopt the
files above as-is for the three invariants", not restructure them for
testability) both decline for this daemon-control-flow layer. Not
re-litigating an already-reviewed, twice-accepted tradeoff: building a new
ephemeral-tmux fixture now would exceed this ticket's adopt-as-is scope for
a two-line branch whose precondition is already proven. Confirmed by direct
code reading that `attempt-resident-rotate!` is a pure extraction of the
pre-existing (already-covered) rotate-else-branch body, called from two
sites (redirect target, own-role target) instead of one — no new untested
control flow beyond the redirect `cond` clause itself.

No other coverage gaps found. Forwarding to documenter.
