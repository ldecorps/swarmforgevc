# BL-876 documenter bounce — 20260811

Commit held: `91dc11c489` (documenter, doc pass complete, blocked forwarding to QA).

## Review inventory (Article 4.4 — complete pass, one item found)

Checks run this pass:

1. Re-read the ticket (`backlog/active/BL-876-bounce-history-keeps-every-distinct-same-day-bounce.yaml`)
   and the coder/hardener commits to see what user-visible/documented behavior
   changed — done.
2. Added a `docs/reference/Specification.MD` entry (Last Updated line + a new
   "A ticket's own `bounce_history` dedup key widened to match the store's
   (BL-876)" subsection) describing the `entryNaturalKey` widening and the
   BL-819 record repair. Committed as `91dc11c489`.
3. Attempted `swarm_handoff.sh` to QA (priority 00, task
   `BL-876-bounce-history-keeps-every-distinct-same-day-bounce`, commit
   `91dc11c489`) — refused by the pre-QA `acceptance-contract` gate. This is
   D1 below.

No check was BLOCKED before D1 — the send refusal is itself the finding.

## D1 — ticket's `acceptance:` field still names the pre-promotion `.draft` path

- **Class**: `acceptance`
- **Blamed role**: `coder` — commit `3f07b16b45` ("BL-876: widen a ticket's
  own bounce_history dedup key...") promoted
  `specs/features/BL-876-bounce-history-keeps-every-distinct-same-day-bounce.feature.draft`
  to the real `.feature` file (`git show 3f07b16b45 --stat` confirms the
  rename/promotion + step-handler wiring) but left the ticket YAML's
  `acceptance:` field pointing at the old `.feature.draft` name instead of
  updating it in the same commit, contrary to the ticket's own note ("the
  coder promotes it to `.feature` and wires step handlers in the same
  commit").
- **Failing command**: `swarmforge/scripts/swarm_handoff.sh ./tmp/handoff.txt`
  (git_handoff to QA, commit `91dc11c489`)
- **Commit**: `3f07b16b45` (defect introduced); inherited unchanged through
  `f6404d7527` (hardener) and `91dc11c489` (documenter)
- **Error**:
  ```
  PRE_QA_GATE_FAIL acceptance-contract BL-876 acceptance: declaration is
  unreadable at the cited commit (absent, inline Gherkin, or naming a
  feature file that does not exist there)
  ```
- **Expected vs observed**: Expected `backlog/active/BL-876-...yaml`'s
  `acceptance:` field to name
  `specs/features/BL-876-bounce-history-keeps-every-distinct-same-day-bounce.feature`
  (the file that actually exists at the cited commit); observed it still
  names the `.feature.draft` path removed by the same commit that promoted
  the file.
- **Remediation pointer**: `backlog/active/BL-876-bounce-history-keeps-every-distinct-same-day-bounce.yaml`
  line 11, `acceptance:` field — drop the `.draft` suffix.

## Disposition

One item, D1, routed to **coder** (sole blamed role, introduced and only
touched by their own promotion commit) — outside documenter's domain (ticket
`acceptance:` pointer is spec/requirements data, not a human-facing doc).
Everything else in this pass — the doc content itself — is correct and
unchanged; this parcel's `91dc11c489` commit is not reverted, since the
documentation it adds remains accurate regardless of the pointer defect.
