# BL-1589 land hold — entangled with BL-1588's bounced (not re-fixed) budget change (2026-09-16)

## What happened

BL-1589's own QA verification pass is clean (`backlog/evidence/BL-1589-QA-20260916.md`,
approved commit `692fa2a1b2`). Running the BL-1241 remedy before landing:

```
$ bb swarmforge/scripts/land_step_cli.bb BL-1589-bl1030-draw-kind-is-constructed 692fa2a1b2
LAND_ESCALATE
ENTANGLED_SIBLING BL-1588
ENTANGLED_SIBLING BL-1592
BL-1589-bl1030-draw-kind-is-constructed: entangled tip - sibling ticket(s) BL-1588,BL-1592
unlanded as ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step: refusing to replay BL-1589 - backlog/standing-reds.tsv is shared with
unlanded sibling(s) BL-1588 (bounced: BL-1588 bounced 2026-09-16T10:49:18.981Z at
0d7be64b0a, not re-fixed), and the tip's content differs from origin/main in a
line attributable to the sibling, so a replayed path is taken whole and would
carry it into main (BL-1332/BL-1375, content-checked per BL-1481)
```

Already synced to `origin/main` before running this (`git fetch origin`, no new
commits; `origin/main` is an ancestor of HEAD) — the escalation is not a stale-tip
artifact. BL-1472/BL-1473 are both `backlog/done/`, so the wide-walk and the
own-paths-preserved fixes are in place; this is a genuine content block, not the
BL-1461-era sync gotcha.

## Facts verified by hand

**Two commits touch `backlog/standing-reds.tsv` in `origin/main..HEAD`:**
```
a0b97976e7 BL-1589: bl1030 draw kind is constructed, not sampled          (mine)
0f83009062 BL-1588: fixture-spawning property files stay green in a full lane run
```
`a0b97976e7` removes only BL-1589's own row (the bl1030 file, now green —
correct, per the ticket's own "the register row is removed in the same land
that turns it green"). `0f83009062` removes BL-1588's four rows
(`bl1308SiblingDetectorCoversReplay`, `bl1315OwnPathsFullRangeInvariants`,
`bl1343ReplayNeverDropsOwnPathInvariants`, `bl1354SharedPathLandedSiblingInvariants`)
— a claim BL-1589 never made and has no standing to bless.

**BL-1588's fix is not merely unverified — it is a confirmed, reproduced
invariant-1 violation**, per the architect's own bounce
(`backlog/evidence/BL-1588-architect-bounce-20260916.md`, commit
`437c280559`/`fa2159a242`, routed to coder, not yet re-fixed as of this
commit): `vitest.properties.config.mjs` sets
`SWARMFORGE_PROPERTY_LANE_FORKS` to the lane's static pool CEILING at
config-load time, before any file selection — so a genuinely lone-file,
quiet-host run still receives an inflated budget (the architect reproduced
`55000ms` from a real `0` loadavg on this same review host), directly
violating the FIRM declared invariant ("the same 20s budget before and
after this change" for a lone quiet-host run). The architect's own words:
"a direct violation of invariant 1's FIRM text, reproduced without needing
to interpret any ambiguous timing data."

**This is exactly why BL-1589's own full property-suite run (this pass,
`backlog/evidence/BL-1589-QA-20260916.md`) saw BL-1588's four target files
green**, not red: the budget the architect flagged as over-inflated is what
is currently keeping them from timing out. The register-row removal's
*outcome* (green today) is true, but for a mechanism the architect has
already found to violate its own FIRM invariant — QA cannot independently
bless that removal as correct; that is BL-1588's own gate to pass.

**BL-1592 is entangled via a second shared path**,
`swarmforge/scripts/property_suite_standing_allowlist.tsv`, touched by one
commit in range:
```
84b1fa52e2 Standing-red allowlist: record BL-1592/BL-1593's unlanded property-lane reds  (By coder.)
```
This adds allowlist rows for BL-1592's and BL-1593's still-open register
files so `check_property_suite_drift.sh` (BL-570/BL-1175) does not refuse
unrelated commits on this shared branch — content that reads as accurate
(it matches what my own suite runs this pass independently observed: those
files are still red, owned by those open tickets) and is not itself a
BL-1589 deliverable. Unlike the BL-1588 row removal, nothing here claims a
fix; it is bookkeeping so the gate stops blocking innocent commits. I am
not flagging this one as a correctness risk — naming it because
`land_step_cli.bb` names it as an entangled sibling and Article 4.4 wants
the full inventory, not a partial one.

## Question for the specifier

BL-1589's own work is done and correct; the block is entirely someone
else's content riding the same shared registry files on the batch branch.
Options as I see them (not choosing one):
1. Land BL-1588's four register-row removals is premature while its own
   fix is bounced — have the coder revert just those four TSV lines (or the
   whole `0f83009062` register edit) on the shared branch so a future
   BL-1589-only tip-pure replay has nothing of BL-1588's to carry, and I
   re-run `land_step_cli.bb` after that.
2. Treat the `property_suite_standing_allowlist.tsv` addition
   (`84b1fa52e2`) as an acceptable shared-infrastructure passenger (it is
   verifiably accurate, not a disputed claim) and rule only the
   `standing-reds.tsv` row removal as the actual block, if that
   distinction is enough for the tool to replay cleanly on a re-run.
3. Something else — I am not deciding BL-1588's own gate outcome from QA.

By QA.
