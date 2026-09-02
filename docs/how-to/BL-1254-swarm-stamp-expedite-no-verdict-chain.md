# Stamp-off: expedite no-verdict recovery chain (BL-1254)

BL-848 stamp-off for three Cursor/Operator hotfixes landed on `main` on
2026-08-28, all `Hotfix-Certification: pending`, reviewed as ONE resulting
state — the state at the third commit — because the third supersedes part of
the second. Green tests never write `certified` / `waived` into the hotfix
ledger — only a recorded human decision does
([BL-848](BL-848-certify-an-operator-hotfix.md)).

## Chain under review

| Commit | Landed behaviour |
| --- | --- |
| `3f4f69ec1b` | Recover once when an expedite stage exits without `verdict.json`, instead of hard-failing the ticket. |
| `70c5e0e5b0` | After no-verdict recovery, bounce the same stage instead of failing the ticket. **Superseded** by the next commit — not asserted by this stamp's scenarios. |
| `5de352ed1d` | Refuse synthesized no-verdict bounces; recover twice (`max-missing-verdict-recoveries` = 2) with escalated prompts on the second attempt. |

Resulting behaviour: a stage that exits without a parseable verdict is
re-invoked while recoveries remain, with prompts that forbid waiting on
background or Monitor work and require writing `pass`, `bounce`, or `fail` as
the last action; a further miss fails closed.
`bounce-payload-valid?` (`swarmforge/scripts/expedite_lib.bb`) refuses a
bounce whose `reason` and `class` are both blank, and refuses the driver's own
synthetic `no-verdict-abandoned` tag — synthesizing "bounce because
no-verdict" would re-enter the same stage with no new information and burn
the bounce bound in a loop.

Trigger: an offline `claude -p` cleaner stage on BL-1248 parked on a Monitor
wait, exited 0 with no `verdict.json`, and the driver stamped
`{"verdict":"fail","reason":"no-verdict"}` and hard-failed the ticket.

## Timeout beats missing-verdict

`finalize-stage-result` (`swarmforge/scripts/expedite_cli.bb`) checks for a
timeout before it checks for a missing verdict. A stage killed for exceeding
its time budget is recorded as `stage-timeout`, never as `no-verdict`, and is
NOT re-invoked — only a genuine no-verdict miss (the stage exited on its own
with no parseable `verdict.json`) triggers the recovery path above. Without
this ordering, a killed-for-overrun stage would read as an absence and get
re-invoked by the recovery path, which must not happen for a stage that was
deliberately killed.

## Non-live finding recorded, not fixed here

`bounce-payload-valid?` lower-cases `reason` before comparing it to the
synthetic tag, but compares `class` exactly (after trim) — a verdict carrying
`class: "NO-VERDICT-ABANDONED"` would be accepted as a real bounce, while
`reason: "NO-VERDICT"` is refused. Not live: the running driver only ever
synthesizes the lowercase tag. Pinned in
`extension/test/bl1254MissingVerdictNeverBounces.property.test.js` so a
follow-up fixing the asymmetry has an anchor that goes red the moment it
lands; out of scope for this stamp per the ticket's constraints.

## Stamp-off posture

- Confirm or refute the landed chain only — do not reimplement, rewrite, or
  revert any of the three hotfixes.
- All three ledger rows (`3f4f69ec1b`, `70c5e0e5b0`, `5de352ed1d`) stay
  `state: stamp-open` / `human_decision: null` until Approvals / human ledger
  decision ([BL-848](BL-848-certify-an-operator-hotfix.md)).
- No scenario in the acceptance feature asserts `70c5e0e5b0`'s superseded
  same-stage no-verdict bounce.

Acceptance:
`specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature`
