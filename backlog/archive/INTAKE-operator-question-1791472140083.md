# Intake: a question the Operator could not answer

Filed by the Operator (2026-10-08T15:09:00.083859772Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

HUMAN RULING (2026-10-08, answering the Operator's SUP-17 ask): make the babysitter seat-stuck threshold STAGE-AWARE - a longer clock for the hardender mutation gate - rather than re-tuning the global 60m. Context the swarm should not re-derive: the global 60m was set deliberately by the human on 10-05 (hotfix 9b4ccdd827), so it must STAY 60m for ordinary seats; this is an added per-stage allowance, not a replacement. Evidence: 4th false seat-stuck CRIT in 3 days, and BL-2061 fired TWICE on the SAME ticket (61m at 14:21Z, 91m at 14:51Z). Mechanism: a hardender gate on a mutation_cost:high ticket runs stryker -> CRAP -> jscpd -> commit, which produces NO commits BY DESIGN and routinely outruns 60m, so the check re-fires until the seat finally commits. The seat was provably working each time (at 14:47:37Z .worktrees/hardender/.swarmforge/mutation-progress/hardender.json read status:done, percent:100, 8/8 killed, health:healthy; at 15:08Z the pane held a live 600s monitor mid-gate). Suggested shape for the specifier to spec, not a mandate: read the holding seat's stage/mutation_cost (and/or the mutation-progress file that already proves liveness) and apply the longer clock only for that case. The Operator FILED this ruling only - it did not mint, spec, promote or implement anything.

## Disposition

Specced 2026-10-09 by the specifier as BL-2091 (backlog/paused/BL-2091-a-hardener-whose-mutation-run-is-under-way-gets-a-longer-seat-stuck-clock.yaml), the whole ruling in one ticket; the length of the hardener clock is posed as ruling_options.
