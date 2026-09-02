# ANSWER — Worktree-drift storm 2026-08-30: operator/Cursor wrote them, no ticket

Asked by: specifier, via `role_ask.bb` 2026-08-30 16:18:24Z (marker
`.swarmforge/operator/role-awaiting/specifier.json`, `asked_at_ms`
1788106704878).
Answered by: the human, 2026-09-03, **relayed through the coordinator** — the
specifier's own ask slot had been wedged four days and the escalation that
should have surfaced the question has been dead since 2026-08-30 (see
BL-1352). The coordinator's own slot was free, so it carried the question and
returned the answer as a priority-`00` note. The Telegram answer store never
recorded it (`deliver-role-answer.js --role specifier` reports
`already-consumed`, still holding the 2026-08-28 reconcile answer), so the
marker was cleared with `role_ask.bb --resolve` per BL-1245.

## Question as posed

> Worktree-drift storm 08-30 15:55-16:12Z: nine drift stashes across
> cleaner/architect/hardender/documenter. The drifted content is exactly your
> commit 44d2d42591 (reverse-hop port, 16:03Z) and the first stash PREDATES it
> by 8 min. I verified it is NOT the BL-373/BL-1233 launcher sync: that sync
> cannot reach 02_handoffs.md or the role prompts, its guard is wired, and
> there is no ambient GIT_DIR leak right now (ls-files returns 1184, not 0).
> Did you or your Cursor agent write those files into the role worktrees while
> porting the feature?

Options offered:

```
  1. Mine - operator/Cursor wrote them, no defect ticket needed
  2. Not mine - mint the defect ticket against the unknown propagation
  3. Mine, but still mint a drift-attribution ticket
```

## Answer

**Option 1 — "Mine - operator/Cursor wrote them, no ticket."**

The 2026-08-30 worktree-drift storm is attributed to the operator/Cursor agent
writing those files into the role worktrees while porting the reverse-hop
feature. It is **not** an unknown propagation path.

## Disposition

- **No defect ticket is minted** for the 08-30 drift storm. Do not re-open it
  as an unattributed-propagation investigation.
- The drift files remained safe to remove, as the recurrence notes already
  recorded — this answer confirms why: they were an external writer, not lost
  agent work.
- This answer does **not** cover the 08-31 recurrences that hit the coder with
  Telegram front-desk files; those were separately observed to self-clear and
  were suspected to come from `cursor_bridge_supervisor.bb`. Nothing here
  contradicts that, and nothing here attributes them.
- Unblocks the specifier's ask slot, which had been holding backlog-root intake
  `INTAKE-operator-question-1788082425603` for four days.
