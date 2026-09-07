# A `land-plan` LAND_CLEAN verdict can be wrong when entanglement predates the parcel's own last hop — found verifying BL-1446, 2026-09-07

## Summary

`land-plan`'s docstring promises `{:action :land}` "when no entanglement is
present (or the check could not tell)". This is false in a real, common
shape: a sibling ticket's genuinely unlanded work, baked into the parcel as
an ancestor of the parcel's OWN last hop (via a shared batch-role branch —
cleaner and architect both process several tickets on one continuous
branch, Article 2.6's normal case), is invisible to `land-plan`'s candidate
walk and never reported. `LAND_CLEAN <commit>` then recommends pushing that
commit unchanged — which pushes the unlanded sibling's real content to
`main`. Not the same bug as BL-1446 (post-hop landed-history false
positives) or BL-1447 (replay-completeness before publish, which only
guards the `:replay` path — this fires on `:land`, where there is no
replay to check).

## How found

Verifying BL-1446 (this ticket), re-ran the exact real-world land inputs
from this session's own BL-1448 land (two genuine incidents, not
synthetic): `bb land_step_cli.bb BL-1448 6c8caf27fb` and `bb
land_step_cli.bb BL-1448 d854af2126`. Both now (post-BL-1446) return bare
`LAND_CLEAN`, naming no sibling at all. Both commits are known, by hand
verification at the time (`backlog/evidence/BL-1448-QA-20260907.md`), to
carry BL-1349's own real, unlanded `bounce_history` (introduced by
`832429ff79`, `37727ac582`, `3f37abba98`, `699dcc6b87` — none reachable
from `origin-main`) as an ancestor.

Root cause: `land-plan`'s candidate walk uses `walk-base =
task-scope-gate-lib/parcel-own-base` (unchanged by BL-1446 — explicitly out
of its scope: "Keep `parcel-own-base` itself unchanged for the send-time
gate"). For BL-1448, `parcel-own-base` resolves to `429f8defcc` (the
documenter's own final handoff commit — checked directly:
`task-scope-gate-lib/parcel-own-base "." "BL-1448"` → `429f8defcc`). Both
cited commits are QA's own merge of `429f8defcc` (or later), so
`ancestry-commits root walk-base commit` walks only the merge commit(s)
themselves — BL-1349's entangling commits, absorbed into the shared
cleaner/architect branch long before the documenter's final hop, sit
BEFORE `walk-base` and are never visited. A direct, unbounded call
(`entangled-siblings root commit task-ticket-id` — walk-base defaults to
`origin-main`, the widest walk) correctly finds `{:entangled #{BL-1349
BL-940 BL-1444}, :unlanded #{BL-1349 BL-940}, ...}` for the same commit:
the wide walk sees it, the walk `land-plan` actually uses does not. This is
exactly the invariant BL-1446 states and tests for a DIFFERENT direction
(post-hop syncs must not manufacture false entanglement) but does not
cover the reverse (pre-hop entanglement must not be missed) — its own
acceptance scenario 03 varies only the number of POST-hop syncs (0/1/2),
never a sibling entangled BEFORE `walk-base`.

## Why this matters

Article 2.6/BL-1241's own text calls shared-batch-branch entanglement the
NORMAL case ("ordinary pipelining on a long-lived role branch produces
exactly this"). Any ticket sharing a cleaner/architect pass with a
still-active sibling is exposed: if `parcel-own-base` lands on a hop after
the sibling's commits were absorbed (routine once a ticket has passed
cleaner/architect and moved on to hardener/documenter/QA), `land-plan`
reports `LAND_CLEAN` for a tip that is not, in fact, clean. This session's
own QA caught it only because a SEPARATE presence/content diff (done for
the BL-1424/BL-1446 replay-completeness reason, not this one) happened to
surface BL-1349's yaml already, and re-ran `land_step_cli.bb` afterward out
of due diligence while verifying BL-1446 — not because any current tool or
role-prompt check would have caught a bare `LAND_CLEAN` push on its own.

## Not covered by BL-1446 or BL-1447

- BL-1446 fixes: (a) commits reachable from `origin-main` wrongly counted
  as candidates via a post-hop sync, (b) a replay's own-paths wrongly
  bounded to the last hop. Both verified fixed, independently, against
  this session's own two incidents (`land_step_cli.bb BL-1448 6c8caf27fb`
  now correctly excludes the landed siblings BL-099/BL-1454/BL-1460 and no
  longer drops BL-1448's own content in the replay it built the first time
  — see `backlog/evidence/BL-1448-QA-20260907.md`).
- BL-1447 fixes: a `:replay` tip missing a parcel path, checked before
  publish. This gap fires on `:action :land` (no replay is ever built), so
  BL-1447's path-by-path check never runs.

## Recommendation

A defect ticket scoped to `land-plan`'s own `walk-base` for the CANDIDATE
walk (not `own-paths`, already fixed): either candidate detection should
also always read `origin-main..commit` (matching BL-1446's own-paths fix,
at the cost of BL-1432's per-land bound — the tradeoff BL-1432 explicitly
accepted the other direction), or `parcel-own-base` should resolve to the
parcel's FIRST hop for land-time purposes rather than its last (mirroring
BL-1446's own "How" direction for own-paths: "attribute ... from the
parcel's FIRST recorded handoff ... never from the last hop" — stated
there for own-paths, not yet applied to the candidate walk that decides
whether to look at all). Either fix should show up as a fourth invariant:
"a genuinely unlanded sibling's commit, absorbed into the parcel's history
before its own last hop, is never missed by the bounded walk."

Not blocking BL-1446's own approval — BL-1446 fully delivers what it
claims, verified above. Sent as a `note` to the specifier alongside this
record; no ticket minted by QA (specifier's call per Article 1.2).

By QA.
