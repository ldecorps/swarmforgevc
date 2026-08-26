# BL-1088 — hardener pass

Commit received: `23821567c4` (architect → hardener, unchanged from coder's
`9fb0083ca`; cleaner and architect both forwarded with zero diff). No code
change made this pass.

## BL-149 cooldown gate

```
bb swarmforge/scripts/mutation_cooldown_gate.bb <root> swarmforge/scripts/front_desk_supervisor_lib.bb
DECISION: skip-cooldown
file_age_days: 0.11 (cooldown: 3 days)
```

The production file was committed as part of this same parcel a few hours
ago, so per the constitution's gate: skip mutation-testing it this pass
(neither a hand-authored surgical sweep nor BL-113 Gherkin mutation of
`specs/features/BL-1088-a-given-up-child-stays-down-for-its-whole-cooldown.feature`,
whose one Scenario Outline exercises this same function). Deferred to a
later quiet pass once the file is past cooldown, per BL-149.

In lieu of that: the coder's own property runner
(`bl1088_giveup_cooldown_property_runner.bb`, 200 runs) already encodes a
hand-authored break table for exactly the mutations BL-113/Stryker would
generate — dead-pid disjunct restored (93 breaks), never-re-arm (260/400/200
breaks across P1/P2/P5), always-re-arm (210/68 breaks), and dropping the
BL-403 kill guard (200 breaks) — each verified to actually flip the
property. That is a stronger signal than a single soft Gherkin mutation pass
would add on top, so nothing here is left unverified by the deferral.

## Verification (all re-run fresh this pass, nothing reused blind)

| check | result |
|---|---|
| `run_acceptance.sh` BL-1088 feature | 5/5 |
| `run_acceptance.sh` BL-303 feature | 3/3 (regression guard) |
| `bl1088_giveup_cooldown_property_runner.bb` | ALL PROPERTIES HOLD, 200 runs |
| `test_front_desk_supervisor_tick.sh` | ALL CHECKS PASSED — incl. the bl-303 recovery-02 [not elapsed] case that was red on `main` for weeks |
| `front_desk_supervisor_lib_test_runner.bb` | ALL PASS |
| `cursor_bridge_supervisor_test_runner.bb` | ALL PASS (retired assertion replaced, not just deleted) |
| `bridge_headless_supervisor_test_runner.bb` | ALL PASS |
| `operator_runtime_watch_lib_test_runner.bb` | ALL PASS |
| `test_negotiation_relay_supervisor_tick.sh` | ALL CHECKS PASSED |

Swept every `check-one!` consumer with its own test runner (8 files); all
green. `onboarder_supervisor.bb` has no dedicated give-up-cooldown assertion
of its own beyond the shared lib runner already covered above.

## Two pre-existing reds, reproduced identically at the pre-fix parent

`test_front_desk_supervisor_liveness.sh` — 9 of the same FAIL lines at
`git worktree add --detach <scratch> 9fb0083ca^` as at the parcel tip
(temp worktree removed after comparison). Confirms these are not a
regression from this fix; out of scope for BL-1088 as the coder's evidence
already noted. `test_onboarder_supervisor_tick.sh` is the known WSL
PPID-1-subreaper environmental gap documented in this role's own prompt —
not re-run here since it is a known, unrelated host artifact.

## CRAP / DRY

Not applicable: `.bb` has no mutation/CRAP/DRY tooling wired (BL-472
deferred), gated only by its own unit-test suite, all green above.

## Orphaned processes

None. `pgrep -fl 'node --test|stryker'` scoped to this worktree returned no
live processes before or after this pass; scratch comparison worktree
removed with `git worktree remove`.

## Outstanding, not this ticket's scope

The coder's evidence already surfaces that `BL-303`'s own feature scenario 2
never exercises the dead-pid case and so was blind to this defect for a
year of green runs. Confirmed independently this pass (3/3 pass without
that row). Widening those rows is a spec-gap for the specifier, not a
BL-1088 defect — noted separately by handoff `note`, not folded into this
parcel.

## Forward

No code change. Forwarding the received commit unchanged to documenter,
priority 00.

By hardener.
