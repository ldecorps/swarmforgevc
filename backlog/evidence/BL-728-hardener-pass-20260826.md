# BL-728 hardener pass — handoffd deliver! verification — 20260826

**Architect tip:** `cf04648e56`
**Task:** `BL-728-bl636-commit-message-claims-unlanded-parenfix`

## Gates

| Gate | Result |
|------|--------|
| wiring `test_handoffd_one_shot_flags_parse.sh` | ALL PASS |
| APS BL-728 | 7/7 |
| Gherkin mutation (soft) | total=6 killed=6 survived=0 errors=0 |
| Surgical `bl728_handoffd_deliver_paren_mutation_sweep.sh` | killed=2 survived=0 skipped=0 |
| Stryker / CRAP / DRY | N/A — Babashka/shell verification slice only (architect pass) |
| BL-149 cooldown | N/A — parcel did not commit-touch `handoffd.bb` |

## Hardening delta

- APS `runHandoffd`: 15s `spawnSync` timeout so unknown one-shot flag spellings
  (Gherkin m2 `--polL-once`) fail fast instead of hanging the mutation lane.
- Hand-authored surgical sweep over `deliver!` close-paren regression shape and
  `poll-once done` log literal — both killed by wiring + APS.

## Standing guards

- Gherkin m2 initially stalled 10+ min at 0% CPU (unknown flag daemon loop);
  timeout fix unblocked; full soft re-run green in ~62s.

Tip purity: no mutation caches staged.

By hardender.
