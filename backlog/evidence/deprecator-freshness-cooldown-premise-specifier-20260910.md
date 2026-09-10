# Deprecator freshness pass — the 3-day mutation cooldown premise (Article 3.6)

**Specifier, 2026-09-10, on `main` at 28f6302d32. Outcome: AMEND (BL-1441, BL-1488).**
Proactive pass, not a coordinator hold — the "Proactive, not only reactive"
bullet of `swarmforge/roles/specifier.prompt` §"Deprecator duty".

## Stale premise

Three paused tickets carried a `not_before:` date that is arithmetic over
`config mutation_cooldown_days 3`. The operator lowered that key to **1** in
`swarmforge/swarmforge.conf` on 2026-09-10 (`df25be597b`, "Lower
mutation_cooldown_days 3->1 (operator directive 2026-09-10)"), which retires
the premise every one of those dates was computed from.

`mutation_cooldown_gate.bb`'s `read-conf` reads **only**
`swarmforge/swarmforge.conf` (line 37-39), not the pack conf — checked
because ten `swarmforge/packs/*.conf` still carry `config
mutation_cooldown_days 3` and would otherwise have made the directive inert.
They do not: the live value is 1.

## Measured, not inferred

Authoritative reader, `bb swarmforge/scripts/mutation_cooldown_gate.bb . <file>`,
2026-09-10 ~08:40Z, host quiet (load 1.38-1.42 / 20 cores):

| ticket | file | file_age_days | decision |
|---|---|---|---|
| BL-1441 | extension/src/tools/telegram-front-desk-bot.ts | 1.14 | run |
| BL-1441 | extension/src/tools/telegramFrontDeskBotCore.ts | 2.32 | run |
| BL-1441 | extension/src/tools/telegramTopicDecisions.ts | 19.52 | run |
| BL-1441 | extension/src/onboarding/negotiationTelegramRelay.ts | 21.70 | run |
| BL-1441 | extension/src/onboarding/negotiationTelegramRouting.ts | 21.70 | run |
| BL-1441 | extension/src/concierge/pipelineBoard.ts | 2.45 | run |
| BL-1488 | extension/src/metrics/transcriptWalker.ts | 2.28 | run |
| BL-1488 | extension/src/metrics/turnProfileProducer.ts | 2.25 | run |
| BL-1488 | extension/src/tools/run-turn-profile-producer.ts | 2.28 | run |
| BL-1468 | extension/src/tools/backlogTicketId.ts | 2.84 | run |
| BL-1468 | extension/src/tools/bounceArgsCore.ts | 2.84 | run |
| BL-1468 | extension/src/tools/qa-sibling-check.ts | 2.84 | run |

All twelve answer `DECISION: run` against `cooldown: 1 days`.

The block was real, not theoretical — `bb swarmforge/scripts/promotion_gates_cli.bb
gate-promotion . <id>` before the amendment:

```
BL-1441: REFUSE|not_before|not_before: 2026-09-11 is 1 day away
BL-1488: REFUSE|not_before|not_before: 2026-09-11 is 1 day away
BL-1468: REFUSE|active_backlog_max_depth|active count 1 >= cap 1 - no open slot
```

BL-1468 (`not_before: 2026-09-10`) was already released by the calendar and
needed no date change; its register-row note carried the stale explanation
and was corrected in place.

## What changed

- **BL-1441** — `not_before` 2026-09-11 -> 2026-09-10; the field comment
  records the re-measurement and keeps the two-move history that explains it;
  a `notes:` entry records the adjudication.
- **BL-1488** — same, plus the title's forward clause ("once the cooldown
  clears on 2026-09-11") re-tensed to what is now true.
- **backlog/standing-reds.tsv** — the BL-1488 and BL-1468 rows' note column
  said "cooldown clears <date>" on the retired 3-day arithmetic. Corrected;
  the five tab-separated columns are unchanged (verified with awk `NF!=5`).

Not changed: `human_approval: approved` on both. No new choice is posed, so
re-pending would have collected nothing and would read as an erased approval
(specifier.prompt, BL-1455/BL-1300).

## Gate verification after the amendment

```
promotion_gates_cli.bb gate-promotion . BL-1441 -> REFUSE|active_backlog_max_depth|active count 1 >= cap 1
promotion_gates_cli.bb gate-promotion . BL-1488 -> REFUSE|active_backlog_max_depth|active count 1 >= cap 1
deprecate-check.js . BL-1441 -> "decision": "allow"
deprecate-check.js . BL-1488 -> "decision": "allow"
specifier_backlog_hygiene_gate.sh (both) -> ok
pre-qa-gate-lib/read-required-wiring (both) -> :present? true, :items 2 entries
```

Both now refuse only on the cap, which is the coordinator's own gate and the
correct one. Adjudications recorded with `record-adjudication.js . <id> amend
specifier` (BL-1267) so the next promotion pass does not re-derive this.

## Why it mattered

BL-1441, BL-1468 and BL-1488 own **8 of the register's rows** — the entire
`hardening` lane. That lane is what holds `active_backlog_max_depth` at 1
(BL-1429). Two of the three were held one further day by a cooldown that had
already been lowered, so the throttle they exist to clear was being extended
by their own stale scheduling data.

## Caveat

Only the cooldown half of the gate was re-checked. `host-busy` is a live
reading the hardener takes at its own stage, and any land that re-touches one
of the twelve files resets that file's clock — which is exactly what moved
BL-1441's date on 2026-09-08. Re-run `mutation_cooldown_gate.bb` at the
hardener's stage rather than trusting the table above.
