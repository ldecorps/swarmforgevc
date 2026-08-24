# BL-1109 — hardener pass, 2026-08-24

## Inbound

Merged architect `d58d7f4c71` (on cleaner `5db8232914` / coder
`ec9bb10e83`) into `swarmforge-hardender`.

## Scope

Babysitter check 10: non-abandoned in_process is motion when owner idle;
CRIT mailbox clause truthful; starved gather shares stuck-in-process glob
(batch_/nested). Touches `babysitterd_sweep_lib.bb` + `babysitter_check.bb`.

## Host / BL-149

Both production `.bb` files: **skip-cooldown** (age ~0.6d < 3d). Host quiet
(~3 load / 20 cores). No Stryker (babashka). Surgical + Gherkin this pass.

## Process fix this pass

Acceptance gather probed `glob-handoffs` + `stuck-in-process-glob` directly,
so a flat-only `in-process-claims` mutant survived while batch/nested
fixtures still appeared. Gather now calls real `in-process-claims`; claims
include `:name` for assertion; Then asserts `:abandoned? false` on every
claim.

## BL-113 Gherkin (soft)

```
total=7 completed=7 killed=7 survived=0 errors=0
outcome: pass
```

Soft re-run: `total=0 skipped=7` (BL-460 stamp skip) — manifest still clean.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| motion-in-process? requires owner-busy? | killed |
| motion-in-process? always false | killed |
| mailbox-clause always "zero … parcels" | killed |
| glob drop batch `*/*.handoff` alt | killed |
| in-process-claims flat glob only | killed |
| omit `:abandoned? false` on claims | killed |

Survivors: 0.

## Verification

- Acceptance 6/6; unit ok; property ok (PROPERTY_RUNS=200)
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE (after gather-path fix).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1109-babysitter-starved-ignores-idle-owner-in-process`.

By hardender.
