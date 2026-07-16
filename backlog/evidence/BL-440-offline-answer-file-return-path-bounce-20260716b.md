# BL-440 QA re-bounce — 2026-07-16 (2nd)

## Verdict: BOUNCE — prior bounce's defect is still present, and this parcel now makes it WORSE

## What this parcel actually contains

This submission (documenter `e5680fccbf`) is NOT a fix for the prior bounce
(`ecc1747c09`, `backlog/evidence/BL-440-offline-answer-file-return-path-bounce-20260716.md`).
It is a different, independently in-flight slice — `1ad40107` "BL-440: wire
drain-answer-files.ts into a live daemon sweep" — responding to a SEPARATE,
earlier architect bounce ("drainAnswerFiles had no production caller
anywhere"). It adds `answer-file-drain-sweep!` to `handoffd.bb`'s poll loop.

Confirmed by diff: `extension/src/tools/drain-answer-files.ts` is
byte-identical between `ecc1747c09` (my bounce commit) and this parcel's
HEAD (`c7dd1bb78e`):

```sh
git diff ecc1747c09 HEAD -- extension/src/tools/drain-answer-files.ts
# (no output - zero changes)
```

1. **Failing command**: the SAME repro from the prior bounce still
   reproduces unchanged against this commit (re-run to confirm, not
   re-pasted here - see the prior evidence file for the full script and
   output). `checkPremiseLive` still checks only ticket folder/status,
   never the topic's own message history, so a still-active ticket whose
   specific question was retracted is still misclassified as premise-live
   and the stale answer is still blindly executed.

2. **Commit hash checked out and tested**: `c7dd1bb78e` (QA worktree HEAD,
   documenter merge of `e5680fccbf`).

3. **First error excerpt**: identical to the prior bounce's - see
   `BL-440-offline-answer-file-return-path-bounce-20260716.md` items 1 and
   3 for the full repro and output (`disposition: "acted-on"`, stale answer
   appended as an accepted inbound message right after the swarm's own
   retraction).

4. **Failure class**: `behavior` (same as the prior bounce - the gate still
   does not gate the case it exists to gate).

5. **Expected vs observed**: Expected - the previously-reported defect
   (`checkPremiseLive` never checking the topic's own message history for a
   superseding/retracting swarm message) is fixed before this ticket is
   forwarded again. Observed - the defect is completely untouched; this
   parcel adds unrelated wiring on top of it.

## Why this is a bounce, not merely "not yet done"

Beyond simply not fixing the known defect, this parcel makes its blast
radius WORSE: `answer-file-drain-sweep!` now runs `drainAnswerFiles`
automatically on every `handoffd.bb` chase-sweep cycle, unattended, with no
human invoking it by hand. Previously the defect required someone to run
the CLI manually (per its own `Usage: node drain-answer-files.js
<repo-root>` — a deliberate, occasional action); now a stale ANSWER-*.md
sitting at the backlog root referencing an active-but-moved-on ticket gets
auto-drained and blindly executed on the NEXT sweep tick, with no
opportunity for a human to notice and intervene first. Landing the wiring
before the gate defect is fixed converts a latent bug into a live,
self-triggering one.

## Scope check

Per the "Prior QA Bounce Is Not In Your Worktree" rule (BL-340): this
parcel's own ancestry (`1ad40107`, `a850dc9f`, `82905bbe`, `597ab61f`,
`f74ce37a`, `570bde4d` -> `e5680fccbf`) does not include a fix commit for
`ecc1747c09`'s defect - confirmed above by the empty diff on the one file
that would have to change.

By QA.
