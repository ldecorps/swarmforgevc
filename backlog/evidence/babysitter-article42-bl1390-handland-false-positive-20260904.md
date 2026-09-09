# Article 4.2 escalation on 340530ab85 (BL-1390) — FALSE POSITIVE

Operator sweep, 2026-09-04T18:55Z (UTC).

## The escalation
`BABYSITTER_ESCALATION / pipeline-code-on-main-340530ab85698d87f74fc2549ec32bd1a266bbc9`:

> pipeline code landed on main outside QA (Article 4.2/BL-247):
> 340530ab85 "BL-1390: a commit on the shared main checkout is pushed while it
> still fast-forwards" touches specs/pipeline/steps/bl1390PushWhileFastForwardSteps.js

## Verdict: approved, not an escape

`swarmforge/scripts/is_qa_ancestor.sh` — the ONE shared approval predicate
(BL-925 invariant 2) — returns **exit 0** for this sha:

    $ bash swarmforge/scripts/is_qa_ancestor.sh 340530ab85698d87f74fc2549ec32bd1a266bbc9
    exit=0        # ancestor of swarmforge-QA AND no bounce verdict in either store

Corroborating:
- `git branch --contains 340530ab85` → `main` **and** `swarmforge-QA`.
- Committed 2026-09-04T18:50:54Z; the post-commit hook pushed the merge at
  18:53:47Z while main still fast-forwarded (the very behaviour the ticket
  specifies). `origin/main...main` is `0 0` — no divergence, no orphan merge.
- No `MERGE_HEAD`; `main-sync-deadlock.json` is `{}`.

This is the standing QA hand-land class already recorded six times today
(`babysitter-article42-*-20260904.md`). The babysitter's gather is ancestry-only
at the moment of the land, so a QA hand-land — where the QA merge and the main
commit are made in the same pass — always trips it. No action; the parcel was
QA-approved before it reached main.

## Swarm state at the time of this sweep (context, no action taken)
- handoffd had been **down since 18:24:01Z** (BL-1392 hand-splice, `Unable to
  resolve symbol: read-json` at the old line 2194; three supervisor start
  attempts failed 18:24:02Z / 18:24:52Z / 18:25:09Z).
- It **recovered on its own at 18:54:22Z** — `build_freshness_cli` started
  handoffd pid 1423 + supervisor pid 1584 from the now-clean tree
  (`cron-heartbeat-state` reads via `json/parse-string`, the bare `read-json` is
  gone). Heartbeat fresh: 18:54:46Z. No operator restart was needed.
- All 8 role panes alive and working. Coordinator is closing BL-1390; QA and
  coder are resolving bookkeeping conflicts.
- `status.json.role_questions` still holds the coordinator's 18:21Z main-sync
  question as `pending`; the deadlock it asks about has since cleared
  (main == origin/main). Stale slot, not a live block — left for its owner.
