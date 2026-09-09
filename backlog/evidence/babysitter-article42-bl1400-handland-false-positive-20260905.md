# Article 4.2 escalation on 3cb48de0b2 (BL-1400) — FALSE POSITIVE, closed out

**Operator run:** 2026-09-05T03:07Z (UTC)
**Escalation subject:** `pipeline-code-on-main-3cb48de0b22613edabb68732144fe9c8ba22cd08`
**Verdict:** false positive. No chase, no nudge, no ticket.

## Evidence

`swarmforge/scripts/is_qa_ancestor.sh 3cb48de0b22613edabb68732144fe9c8ba22cd08` → **exit 0**:

> approved: 3cb48de0b2 is a land-step replay of approved source d7722ab39e
> (`.swarmforge/land-approvals/2026-09.jsonl`, recorded as 3cb48de0b2) — BL-1334

The commit is QA's own hand-built tip-pure land (`By QA.`, authored
2026-09-05T03:02:15Z), its body citing this ticket's QA evidence
(`backlog/evidence/BL-1400-*-20260905.md`), the QA worktree merge commit
d7722ab39e, `abandoned_commits: [ee22cd6641]`, and a re-verification on the
tip-pure branch (compile clean, unit 16/16, property 2/2).

Files named by the escalation are BL-1400's own paths:
`extension/src/tools/check-feature-handler-registration.ts`,
`extension/test/bl1400NestedHandlerIsSeen.property.test.js`,
`extension/test/checkFeatureHandlerRegistrationCli.test.js`,
`specs/pipeline/steps/bl1400NestedHandlerIsSeenSteps.js`.

## Class

Same standing class as the BL-1370 close-out earlier this shift
(`babysitter-article42-bl1370-tip-pure-land-false-positive-20260905.md`):
the Article 4.2 predicate is ancestry-only, so a QA hand-built land always
flags even with the land approval on record. Tracked by **BL-1405** (hand-built
land records its approval) and **BL-1404** (a recorded waive must silence the
operator escalation channel, not only the coordinator nudge). Both are on the
awaiting-approval roster; nothing new to mint.

## Swarm health at this run

8/8 panes live (`pane_dead=0` on all); handoffd heartbeat 03:07:13Z (~15s
fresh); HEAD 3cb48de0b2 at 03:02:15Z (5m, advancing); backlog active=5
paused=100 done=698 (done +3 since 02:12Z); all role inboxes empty except the
known 2026-08-25 zero-byte `.dead` in coordinator/new; pipeline board
`lastChangeMs` 03:07:03Z, newer than the newest backlog mtime (02:53:57Z) — no
board freeze.
