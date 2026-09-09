# Article 4.2 false positive — BL-1475 QA hand-land ancestry race (2026-09-08)

Operator run, event `BABYSITTER_ESCALATION`
subject `pipeline-code-on-main-c34c1986159f26f5040336149abe3cca574f31f4`.
All times UTC (git author dates below CONVERTED from the host's +01:00, not relabelled).

## Verdict: FALSE POSITIVE — no revert, no ticket, no nudge.

## The commit

- `c34c1986159f26f5040336149abe3cca574f31f4`
  "BL-1475: hand-built tip-pure replay onto origin/main (BL-1241 recipe)"
- Author `t <t@t>`, **02:24:14Z**. Trailer: **`By QA.`** — QA's own tip-pure
  hand-built replay, the BL-1241 recipe.
- 21 files (bridgeServer, blTopicStore, commitIntegrityRunner, gitCommitScopedFile,
  telegram front-desk core + their tests, 3 spec step files).
- Commit body already states why it was hand-built: `land_step_cli.bb`
  LAND_ESCALATE refused `Specification.MD` as shared with **bounced BL-1348**;
  QA blamed every changed line and found the block attribution-only per the
  specifier's **BL-1470** ruling (see
  [[land-step-shared-path-refusal-is-attribution-only-bl1481]] — BL-1481 mechanises it).

## The swarm's own predicate clears it

- `swarmforge/scripts/is_qa_ancestor.sh c34c198615…` → **exit 0** (approved:
  ancestor of `swarmforge-QA`, no bounce verdict in either store).
- `git merge-base --is-ancestor c34c198615 swarmforge-QA` → **YES**.
- No bounce record naming the sha in `.swarmforge/bounces/` or any `backlog/**`
  `bounce_history`.

## Root cause: the same ancestry race as BL-1358 / BL-1362 / BL-1400 — window ~2m45s

| time (UTC) | event |
|---|---|
| 02:24:14Z | QA pushes the tip-pure replay to `origin/main` (`c34c198615`) |
| ~02:26:5xZ | babysitter sweep fires Article 4.2 — QA branch does not yet contain it |
| 02:26:59Z | QA commits `c9d7af7be5` "Merge main into QA." → **ancestry closes** |
| 02:27:09Z | QA `3773873538` records `abandoned_commits` for the replay |
| 02:27:33Z | QA `c1b81d8ea1` records the BL-1470 land-escalate instance |
| 02:27:0xZ | operator re-checks: `is_qa_ancestor.sh` exit **0** |

Article 4.2's predicate is ancestry-only, so on the QA hand-land route the push
to `origin/main` necessarily precedes the merge-back and every such land is
briefly indistinguishable from pipeline code landing outside QA. This is the
**sixth+** instance of the class (BL-1358, BL-1362, BL-1382, BL-1388, BL-1393,
BL-1395, BL-1398, BL-1399, BL-1400, BL-1413 …). The fix remains a settle/grace
period or a `By QA.`-trailer check before escalating — not a change to the
hand-land route.

## Why it will not re-fire

`is_qa_ancestor.sh` now exits 0 for this sha, so the sweep's own gate is
satisfied; no `babysitter_waive.bb --record` is needed (that route is for
non-QA lands, and per BL-1404 the escalation channel still ignores waives).

## Operator actions

Diagnosis and this record only. No revert, no nudge (QA was mid-work — its last
commit landed ~4s before this run), no commit/merge/push to `main`, no code
edited, no backlog state changed. BL-1475 remains QA's/the coordinator's to close.
