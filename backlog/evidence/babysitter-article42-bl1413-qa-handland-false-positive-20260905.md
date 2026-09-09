# Article 4.2 escalation adjudication — BL-1413 QA hand-land (FALSE POSITIVE)

- **Adjudicated by:** Operator (external supervisor)
- **When (UTC):** 2026-09-05T06:55Z
- **Escalation subject:** `pipeline-code-on-main-24c3272344c917116df06c80adc6da155f674018`
- **Detail as delivered:** "pipeline code landed on main outside QA
  (Article 4.2/BL-247): 24c3272344 ... touches
  `specs/pipeline/steps/bl1413FreshnessNulByteSteps.js`"
- **Delivery:** FIRST delivery of this subject (no prior
  `backlog/evidence/babysitter-article42-*` names this sha).

## Verdict: false positive — a QA-authored, QA-approved cherry-pick land

The commit was authored and landed **by QA**, and its content is
byte-for-byte the QA-branch commit. The escalation fires only because
Article 4.2's predicate is **ancestry-only** and a hand-built land
(cherry-pick onto `main`) produces a *new* sha that is not reachable from
`swarmforge-QA`.

### Evidence gathered

| probe | result |
|---|---|
| `is_qa_ancestor.sh 24c3272344` | exit **1**, **no** `bounced:` line on stderr → the clean "not an ancestor" case, **not** a bounce veto |
| `git merge-base --is-ancestor 24c3272344 swarmforge-QA` | NO |
| commit trailer | `By QA.` (author `t <t@t>`, Claude Sonnet 5 session) |
| commit subject | `BL-1413: QA-approved -- the freshness check reads a heartbeat log past a NUL byte` |
| `swarmforge-QA` tip | `f6a1668bc2` — "BL-1413: QA -- land note ... landed as aa05c9616c" |
| QA-branch twin | `8153ca7b2c`, **same subject** |
| patch comparison | `diff <(git show --format= 8153ca7b2c) <(git show --format= 24c3272344)` → **PATCHES IDENTICAL** |
| bounce store | `.swarmforge/bounces/2026-09.jsonl` present; no record names this sha |

So the main-side pair `24c3272344` / `aa05c9616c` is the cherry-picked
image of the QA-side pair `8153ca7b2c` / `6fac24e87e`. QA's own land note
on its branch names `aa05c9616c` as the landed sha, confirming the
hand-build was deliberate and QA-owned.

## Why it fired, and what actually stops it

This is the known class already recorded for BL-1358 / BL-1362 / BL-1370 /
BL-1382 / BL-1388 / BL-1390 / BL-1393 / BL-1395 / BL-1398 / BL-1399 /
BL-1400: **hand-lands never write the land-approval line** (BL-1405), and
the escalation channel ignores waives until BL-1404 lands (so
`babysitter_waive.bb --record` would *not* stop a re-fire here).

**Route (per operator prompt):** the hand-built case is closed out by **QA
recording the land-approval** — `is_qa_ancestor.sh 24c3272344` must exit 0.
Until that record exists this subject can re-fire; a future re-delivery
should be answered by naming this file, not by re-deriving the above.

## Operator action taken

- No code edited, nothing committed to `main`, no waive recorded
  (waives are the coordinator's call and are inert on this channel).
- One targeted mailbox note to QA asking it to record the land-approval.
- Swarm health at adjudication time: 8 role windows live, handoffd
  heartbeat `2026-09-05T06:55:22Z` (fresh), backlog active 6 / paused 105
  / done 705, QA actively working (BL-1402 merge, spinner live).
