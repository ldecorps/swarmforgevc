# Front-desk give-up escalation: one email per outage episode (BL-1151)

## What you'll see

When the front-desk supervisor exhausts its restart budget, it emails:

```
SwarmForge: The front desk's bot process stopped and gave up restarting…
```

(or `bridge` instead of `bot`). That is the intended **once-per-incident** signal
that a human must intervene.

Before BL-1151, the same unbroken outage could re-mail every ~15 minutes while
the child cycled **give-up → cooldown re-arm → burn budget → give-up** again
(`FRONT_DESK_GIVEUP_COOLDOWN_MS`, default 900000). That trained the operator to
ignore a real front-desk outage.

## What changed

Escalation arming now **survives cooldown re-arm** until the child is
observably healthy for the grace window (`FRONT_DESK_HEALTHY_RESET_MS`, default
600000) — or until a human clears / parks / restarts the supervisor.

| Event | Escalation arming |
| --- | --- |
| First delivered give-up email | `:armed? true` |
| Leave `gave-up` for cooldown re-arm (no healthy grace) | stays armed — **no second email** on the next give-up of the same episode |
| Child healthy long enough (`healthy-reset`) | disarmed — a **later** give-up may email again (new episode) |

Pure helper: `operator_lib.bb` → `give-up-escalation-alarm-when-not-gave-up`.
Wired from `front_desk_supervisor.bb` and `negotiation_relay_supervisor.bb`
→ `escalate-gave-up!`.

Persisted state: `.swarmforge/operator/front-desk-escalation-alarm.json`
(keyed per supervised process, e.g. `:bot`, `:bridge`).

## Operator response

1. Check `front-desk-supervisor.log` under `.swarmforge/operator/`.
2. Fix the underlying bridge/bot failure (build stale, token conflict, crash loop —
   see sibling [BL-1154](BL-1154-build-stale-restarts-not-crash-giveup-budget.md)
   if build-stale is burning the attempt budget).
3. Restart the supervisor or the failed child by hand if needed.

You should receive **at most one escalation email per continuous episode**. If
mail repeats on the same outage after this fix lands, treat it as a regression.

## Related

- [BL-349 stuck-role escalation](BL-349-stuck-role-escalation-email.md) — role
  idle alarm (separate path).
- Spec BL-370 — give-up must reach a human loudly; delivery-based arming.
- Spec BL-621 — sustained poll/relay outage, once per episode (bot-side).
- Sibling [BL-1154](BL-1154-build-stale-restarts-not-crash-giveup-budget.md) —
  build-stale vs crash attempt accounting.

Acceptance:
`specs/features/BL-1151-front-desk-giveup-one-email-per-episode.feature`
