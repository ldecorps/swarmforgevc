# BL-1151 hardener pass — give-up one email per episode — 20260826

**Architect tip:** `0aca2bdff2`
**Task:** `BL-1151-front-desk-giveup-one-email-per-episode`

## Gates

| Gate | Result |
|------|--------|
| integration `test_front_desk_giveup_one_email_per_episode.sh` | ALL PASS (10 checks) |
| property `bl1151_giveup_escalation_alarm_property_runner.bb` | ALL PASS |
| unit `operator_lib_test_runner.bb` (BL-1151 section) | ALL PASS |
| APS BL-1151 | 3/3 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical `bl1151_giveup_escalation_alarm_mutation_sweep.sh` | killed=5 survived=0 skipped=0 |
| BL-149 cooldown | `run` on operator_lib.bb |

## Hardening delta

- Hand-authored surgical sweep over `give-up-escalation-alarm-when-not-gave-up`
  locking healthy-reset polarity, armed∧grace guard, keep-armed branch, else
  disarm, and select-keys :armed? retention.

Tip purity: no mutation caches staged.

By hardender.
