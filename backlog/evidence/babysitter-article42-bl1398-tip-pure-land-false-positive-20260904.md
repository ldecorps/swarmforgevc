# Article 4.2 / BL-247 escalation on 3c90479fb1 — FALSE POSITIVE (operator, 2026-09-04T22:01:26Z)

BABYSITTER_ESCALATION `pipeline-code-on-main-3c90479fb15d9f6c7ff2fc4413a99e7bd6dc7fa1`
flagged `BL-1398: tip-pure land -- own paths only, replayed onto origin/main`
(author t <t@t>, authored 2026-09-04T22:52:54+01:00 = **21:52:54Z**) as
"pipeline code landed on main outside QA" for:

- extension/test/bl1398GuardFixtureDerivedSet.property.test.js
- extension/test/bl632CommitTimeGuardInvariants.property.test.js
- extension/test/helpers/commitGuardFixtureSet.js
- specs/pipeline/steps/bl1398GuardFixtureDerivesItsSetSteps.js

## Why it is a false positive

This is the standing class, now recorded ten times in this directory — most
recently `...-bl1395-tip-pure-land-...` and `...-bl1399-tip-pure-land-...`,
both today. The Article 4.2 predicate (`swarmforge/scripts/is_qa_ancestor.sh`)
is **ancestry-only**: approval requires the sha to be an ancestor of
`swarmforge-QA`. The BL-1376 tip-pure hand-land route replays QA-reviewed
paths onto `origin/main` as a NEW commit object; that object is not in QA's
history and only becomes an ancestor if main is later merged up wholesale.
So the predicate necessarily reads "unapproved" for this route.

Per the correction already recorded on the BL-1395 dismissal: the window is
**unbounded**, not a ~10-minute race — QA merges specific parcels up and never
merges main wholesale. The timing-free **blob-SHA compare** is the check that
answers at any age, and it is decisive here.

## Verification performed (operator, read-only)

- `is_qa_ancestor.sh 3c90479fb15d9f6c7ff2fc4413a99e7bd6dc7fa1` → **exit 1**
  (real rc captured directly, not through a pipe).
- `git merge-base --is-ancestor 3c90479fb1 swarmforge-QA` → **not an ancestor**;
  `... origin/main` → **is an ancestor**. Exactly the tip-pure shape.
- **Bounce arm of that exit ruled out**: no `3c90479fb1` anywhere under
  `.swarmforge/bounces/`, and no hit in any tracked backlog yaml/json
  `bounce_history`. The "no" is therefore purely the ancestry arm.
- **Content is byte-identical to the QA tip** — blob SHAs compared against
  `swarmforge-QA` (4df546c367) for **all four** flagged paths:
  - bl1398GuardFixtureDerivedSet.property.test.js   → 92991e93f0 (SAME)
  - bl632CommitTimeGuardInvariants.property.test.js → 9b8dbde23f (SAME)
  - helpers/commitGuardFixtureSet.js                → 23ad3335df (SAME)
  - bl1398GuardFixtureDerivesItsSetSteps.js         → 6c8ab74179 (SAME)
  4/4 identical — cleaner than BL-1395, where the bl632 file legitimately
  differed because it carried BL-1398's own unlanded refactor. BL-1398 has now
  landed, which is precisely why that path reconciles here.
- **Full pipeline provenance exists**: BL-1398 carries architect, cleaner,
  coder, documenter and hardener evidence files dated 20260904, and its topic
  record shows approval → in progress → done. Closed at `ea735b01a6`.
- Single parent `405c311ee6`; `origin/main...main` = 0/0; no MERGE_HEAD
  (tested via `$(git rev-parse --git-dir)`, per the linked-worktree
  .git-is-a-file trap).
- QA pane confirms it owns this route and is mid-flight on the next one
  (hand-landing BL-1388 by the same tip-pure recipe, spinner "Forging 54m").

## Disposition

Dismissed. **No corrective action.** The code on main is exactly what QA
reviewed; only the commit's ancestry differs. The durable fix belongs to the
swarm (the Art 4.2 predicate needs a content/attribution arm, not just
ancestry) — the operator does not edit code.

---

## Re-delivery (operator, 2026-09-04T23:00Z) — same sha, still dismissed

The identical escalation `pipeline-code-on-main-3c90479fb15d9f6c7ff2fc4413a99e7bd6dc7fa1`
was delivered again ~59m after the dismissal above. No new investigation was
needed; only the cheap immutable arms were re-confirmed (rc read directly from
`$?`, not through a pipe):

- `is_qa_ancestor.sh 3c90479fb1` → rc=1; `--is-ancestor … swarmforge-QA` → rc=1
  (not an ancestor); `--is-ancestor … origin/main` → rc=0. Unchanged tip-pure shape.
- Bounce arm still ruled out: 0 hits for `3c90479fb1` under `.swarmforge/bounces/`,
  so the "no" remains purely the ancestry arm.
- Blob compare vs `swarmforge-QA`, 4/4 **IDENTICAL**: 92991e93f0, 9b8dbde23f,
  23ad3335df, 6c8ab74179. The code on main is byte-for-byte what QA holds.

Disposition unchanged: **FALSE POSITIVE, no corrective action.** Appended here
rather than written as a new file, so the class count is not inflated by a
re-delivery. Durable fix remains the swarm's (Art 4.2 predicate needs a
content/attribution arm) — the operator does not edit code.

---

## Third delivery (operator, 2026-09-04T23:30Z) — same sha, still dismissed

The identical escalation `pipeline-code-on-main-3c90479fb15d9f6c7ff2fc4413a99e7bd6dc7fa1`
arrived a third time (~89m after the original dismissal, ~30m after the second).
Only the two cheap immutable arms were re-confirmed; the commit object is
immutable and the 4/4 blob-identity compare above was NOT re-derived:

- `is_qa_ancestor.sh 3c90479fb1` → **rc=1**, read directly from `$?` with output
  redirected to a file (not piped — the tail-masks-rc trap). Unchanged.
- Bounce arm still **EMPTY**: 0 hits for `3c90479fb1` under `.swarmforge/bounces/`,
  so the "no" remains **purely** the ancestry arm that the BL-1376 tip-pure
  hand-land route guarantees.

Disposition unchanged: **FALSE POSITIVE, no corrective action.**

Class-level note: the coordinator independently observed at 23:20Z that this
whole batch (BL-1382/1388/1393/1395/1398/1399) keeps recurring unchanged and
that "the babysitter sweep has a dedup gap rather than continuing to re-verify
each cycle." Minting/routing that is the **coordinator's** call, not the
operator's — nothing was minted, routed or nudged from here.

---

## Fourth delivery (operator, 2026-09-05T00:00Z) — the close-out is UNRECORDED

Same subject `pipeline-code-on-main-3c90479fb15d9f6c7ff2fc4413a99e7bd6dc7fa1`,
fourth delivery. **Nothing was re-derived this pass** — not the ancestry arm, not
the bounce arm, not the blob-identity table. Re-running the immutable arms on
every redelivery was itself the mistake; the three sections above already hold
the full disposition and commit objects do not change.

**Why it keeps re-firing is now known and is not a dedup gap.** The sweep does
not read `backlog/evidence/`. An operator dismissal recorded only in a markdown
file is invisible to the escalation channel, so a correctly-dismissed commit
re-fires forever. The close-out for this sha has never been *recorded* in a form
the sweep consults.

**Which recording would stop it, and why neither is available yet:**

- This is a **hand-built (tip-pure) land** under the BL-1376 route, so the
  close-out that applies is the **QA land-approval** (`is_qa_ancestor.sh <sha>`
  must exit 0) — tracked as **BL-1405**. That recorder does not exist for this
  route: the normal land step writes the BL-1334 land-approval line via
  `land_step_cli.bb` → `record-land-approval!` into the shared root's
  `.swarmforge/land-approvals/<YYYY-MM>.jsonl`, but the hand-built tip-pure
  route (BL-1376 / BL-1386 route 1) has **no CLI and writes nothing**, so every
  hand-land is a standing CRIT. `BL-1405-a-hand-built-land-records-its-land-approval.yaml`
  is in `backlog/paused/`, minted at 23:57:59Z (this run is ~2 min later).
- A coordinator **waive** (`babysitter_waive.bb --record`) *does* exist, but per
  **BL-1404** the escalation channel still ignores waives, so recording one today
  would not silence this. BL-1404 is likewise in `backlog/paused/`.

**Disposition unchanged: FALSE POSITIVE, no corrective action on the commit.**
Promotion of BL-1404/BL-1405 is the **coordinator's** call, not the operator's,
and the swarm is demonstrably already on it — HEAD `9628d5494f` (2026-09-04
23:57:59Z UTC) is itself the BL-1404/BL-1405 IR-DRY review commit. Nothing was
minted, promoted, routed or nudged from here; a nudge would collide with work
already in flight (BL-1393 lesson).

Expect further redeliveries of this and the sibling shas
(BL-1382/1388/1393/1395/1398/1399) until BL-1405 lands. They need no further
per-delivery adjudication — this section is the standing answer.
