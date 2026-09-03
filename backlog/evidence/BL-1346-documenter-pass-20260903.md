# BL-1346 — documenter pass, 2026-09-03

Merged hardener commit `8e94472668` — clean merge, no conflict.

## Nature of this ticket

BL-848 review-only stamp-off of already-landed hotfix `195de28861`
(`swarm ensure`'s RC repair no longer respawns a stale-marker role into
another role's pane on a standing pack). Confirmed
`backlog/hotfix-ledger.yaml` is untouched — the row is still
`state: stamp-open`, `human_decision`/`decided_at` null. Same shape as
today's BL-1333 and BL-1342 stamp-offs; this is the companion cause-side
fix to BL-1345, which closed the two remaining consumer/recheck halves of
the same 2026-09-02 incident.

## Doc review

- Followed the established stamp-off pattern: added a BL-1346 entry to
  `docs/how-to/BL-848-certify-an-operator-hotfix.md`'s "Related" list
  (commit `4eaede738a`), naming the reviewed commit, what it fixes,
  cross-referencing BL-1345 (the same incident's remaining halves) and the
  BL-1020 how-to (where `resolve-resident-role`'s callers are enumerated),
  and noting the review found no defect in the hotfix itself.
- `docs/how-to/BL-1020-stale-mono-router-marker-is-not-topology.md` already
  names hotfix `195de28861`/`rc-launch-role` as a `resolve-resident-role`
  caller — added during this session's earlier BL-1345 pass — so no
  further edit was needed there for this ticket.
- Diagram check: no registered diagram's change-trigger fired.
- `docs/reference/Specification.MD`: not touched, matching the majority
  precedent for review-only stamp-offs.
- No RETIRED/deprecated behaviour involved — Article 3.6 not implicated.

## Verdict

No documenter-domain defect found. Forwarding to QA.
