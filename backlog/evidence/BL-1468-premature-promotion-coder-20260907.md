# BL-1468 — promoted before its own cooldown clears

Dispatched to coder 2026-09-07 (coordinator note
`10_20260907T140504Z_006784`). The ticket's own `notes:` and
`approval_context:` are explicit: "Earliest run 2026-09-10 (cooldown from
the 2026-09-07 land). The coordinator should not promote this before then:
a parcel waiting on the host at cap 1 froze the swarm on 2026-09-05
(BL-1439)."

Verified via `qa_e2e_procedure` step 1, the actual gate:

```
$ bb swarmforge/scripts/mutation_cooldown_gate.bb . extension/src/tools/backlogTicketId.ts
DECISION: skip-cooldown
file_age_days: 0.04 (cooldown: 3 days)
```

Same result for `bounceArgsCore.ts` and `qa-sibling-check.ts`. All three
files landed today (2026-09-07); the 3-day cooldown does not clear until
2026-09-10, matching the ticket's own stated date exactly.

No code change is possible or appropriate right now — the ticket's own
constraints forbid narrowing the mutate scope or raising the ceiling to
force a result, and there is nothing else in this ticket's scope to do
before the cooldown clears. Sent a priority-00 note to the specifier and
coordinator rather than holding this parcel in an active slot for three
days or fabricating a run the gate itself refuses. Not completing the
ticket; not touching the ledger or register rows myself (constraints
explicitly reserve the discharge for the actual completed run).
