# Article 4.2 escalation on 4409993daf (BL-1370) — FALSE POSITIVE, close-out recorded

- **Escalation subject:** `pipeline-code-on-main-4409993daf6c52d630a67f394faa2ca2246e8183`
- **Adjudicated:** 2026-09-05T02:12Z by the Operator
- **Verdict:** false positive. Land-approval IS on record; no action needed.

## Evidence

```
$ ./swarmforge/scripts/is_qa_ancestor.sh 4409993daf6c52d630a67f394faa2ca2246e8183
approved: 4409993daf is a land-step replay of approved source c981dc13e9
  (.swarmforge/land-approvals/2026-09.jsonl, recorded as 4409993daf) - BL-1334
exit=0
```

Commit `4409993daf` "BL-1370: tip-pure land -- own paths only, replayed onto
origin/main" (t <t@t>, 2026-09-05T02:06:10Z) touches
`extension/test/bl1370WorktreeStrayCheck.property.test.js` and
`specs/pipeline/steps/bl1370WorktreeStrayCheckSteps.js`. Both are BL-1370's own
paths, replayed onto origin/main from QA-approved source `c981dc13e9`.

## Why it fired anyway

Standing known class: the Article 4.2 predicate is **ancestry-only**, so a
tip-pure / replayed land always flags even when the land-approval line exists
(see `babysitter-article42-qa-handland-on-main-false-positive-20260904.md`,
`article42-predicate-is-ancestry-only`). Tracked as **BL-1404** (escalation
channel ignores recorded close-outs) and **BL-1405** (hand-lands not writing
the approval line — not the case here; this one DID write it).

## Close-out

This file is the recorded close-out. A re-delivery of the same
`pipeline-code-on-main-4409993daf...` subject should be dismissed against this
file without re-deriving; do not chase QA or the coordinator.
