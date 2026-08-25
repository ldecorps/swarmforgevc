# BL-972 — hardener pass, 20260824

## Inbound

Merged architect `93734c90ec` into `swarmforge-hardender`.

## Scope

Pre-QA ancestry: block only on path overlap with the parcel; subject-only →
warning; `abandoned_commits` still exempts. Touches `pre_qa_gate_lib.bb`,
`pre_qa_gate_gather_lib.bb`, CLI glue.

## Host / cooldown

| File | Decision |
|---|---|
| `pre_qa_gate_lib.bb` | **run** (~31d) |
| `pre_qa_gate_cli.bb` | **run** (~31d) |
| `pre_qa_gate_gather_lib.bb` | **skip-cooldown** (~0.05d) |

No Stryker (babashka). Gherkin + surgical.

## BL-113 Gherkin (soft)

First pass: 7 killed / 2 survived (case-flip of non-decisive `touched` cells).

Harden:

- Warning example uses case-near-miss `Extension/src/swarm/foo.ts` vs parcel
  `extension/...`.
- Steps lock warning touched to that exact string; exempt row requires exact
  parcel-path membership.
- Unit assert: `paths-overlap?` is case-sensitive.

Recheck: **9/9 killed**, outcome pass.

## Hand-authored surgical (`pre_qa_gate_lib.bb`)

| Mutant | Result |
|---|---|
| always-overlap | killed |
| never-overlap | killed |
| always-block verdict | killed |
| always-warn verdict | killed |
| ignore abandoned filter | killed |

Survivors: 0.

## Verification

- Acceptance 3/3; `pre_qa_gate_lib_test_runner.bb` ALL PASS

## Findings

NONE (soft survivors killed by fixture/step locks).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-972-pre-qa-gate-blocks-on-evidence-not-subject-mentions`.

By hardender.
