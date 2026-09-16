# BL-1573 (and BL-1511, BL-1512) LAND_ESCALATE - adjudicated by the specifier, 2026-09-16 13:45Z

Inbound: QA note, priority 00, 13:28Z (00_20260916T132857Z_002793):
"BL-1573 land-escalate: ambiguous BL-1592/1593 subject 84b1fa52e2". QA
evidence `backlog/evidence/BL-1573-land-escalate-20260916.md` (QA branch,
three instances: BL-1573 at d5fdc8a0ff, BL-1511 at da73d06c23, BL-1512 at
421bfc0664, all refused identically).

## The refusal, verified on main at b928177a63 (origin/main in sync)

`land_step_cli.bb` refuses each tip on
`swarmforge/scripts/property_suite_standing_allowlist.tsv`: commit
84b1fa52e2 ("Standing-red allowlist: record BL-1592/BL-1593's unlanded
property-lane reds", coder, 2026-09-16 11:33) names two ids and leads with
neither, so its attribution is ambiguous (BL-1544, `land_step_lib.bb`
subject attribution: several ids named, none leading -> `:ambiguous? true`);
no commit of the landing ticket's own touches the path; and the tip's
content differs from origin/main. The BL-1544 clause refuses exactly that
triple, correctly - it exists so a path is never silently excluded.

What the difference is, at every one of the three tips:

```
git diff origin/main..<tip> -- swarmforge/scripts/property_suite_standing_allowlist.tsv
 1 file changed, 1 deletion(-)
-test/bl1280MkdtempMigrationInvariants.property.test.js  allowlist  owner BL-1593 (...)
```

The tips carry a strict SUBSET of origin/main's rows (`comm` of the two
row sets: one origin-only row, no tip-only row). origin/main's six rows
are the five 84b1fa52e2 added - landed on main byte-identical by the
specifier at f16bb00007 (BL-1589 adjudication) - plus BL-1595's row
(505789d0a8). Somewhere on the QA branch's merges the bl1280 row went
missing; a whole-path replay from any of the three tips would DELETE it
from main. So the refusal guards something real: the row that keeps
BL-1593's red allowlisted for the BL-1175 drift gate.

BL-1588 in the `ENTANGLED_SIBLING` list is stale (landed at a74843fc2d
before QA's latest sync); BL-1592 (paused) and BL-1593 (active) are both
`human_approval: approved` and unbounced, so neither is a BL-1375 blocker
and the BL-1481 content check - and with it BL-1594's `:vacuous` trap that
sank the BL-1589 restore - is never reached for them.

## Ruling: restore the path to origin/main's content on the QA branch, then re-run

Nothing in the tips' version of the path is anyone's deliverable; the only
net change is a lost row. Per the how-to's own BL-1544 third bullet ("the
tip content already matches origin/main - nothing is at stake; a two-tree
diff with no net change never reaches delivered"), make it match:

```
git fetch origin
git show origin/main:swarmforge/scripts/property_suite_standing_allowlist.tsv > swarmforge/scripts/property_suite_standing_allowlist.tsv
git diff origin/main -- swarmforge/scripts/property_suite_standing_allowlist.tsv   # must be empty
git commit -m 'BL-1573: restore property_suite_standing_allowlist.tsv to origin/main content (a QA-branch merge dropped the bl1280 row; nothing of BL-1573 here). By QA.' -- swarmforge/scripts/property_suite_standing_allowlist.tsv
git merge origin/main
bb swarmforge/scripts/land_step_cli.bb BL-1573-the-dispatch-gap-note-fallback-is-a-dispatch-trail <new tip>
```

With the path identical to origin/main it drops out of the two-tree diff
before `own-paths` ever classifies it, and the ambiguous 84b1fa52e2 no
longer has a path to be ambiguous about. The `BL-1573:`-leading subject
also makes the landing ticket an owner of the path (BL-1544's first
bullet), so even a reader that reaches the clause keeps it. No hand-built
land. The one restore commit sits on the QA branch ahead of BL-1511's and
BL-1512's tips too: land those from tips that include it (their own paths
are unchanged) - one restore serves all three instances.

If the step still refuses after the restore, quote the new text and note
me again: that would be a different clause than this one.

## Class rule (QA prompt item 4): an ambiguous-subject commit on a shared bookkeeping path

When BL-1544 refuses on a path the landing ticket never meant to deliver,
compare the tip's content with origin/main first: a subset or identical
content means the remedy is the restore above, never a re-authoring of the
ambiguous commit and never a hand-build. A tip that carries lines origin
lacks is a different case (someone's undelivered work) and comes back as
its own note. Append instances here.

## Recorded, not ticketed

- The batch branch's 84b1fa52e2 named two tickets and led with neither,
  which is the send-time rule's blind spot for a bookkeeping commit that
  belongs to no parcel; the same rows had already been landed on main by
  the specifier an hour earlier (f16bb00007) because the register rows and
  the allowlist mirror rows belong together (the specifier's memory rule
  since BL-1589). A coder who must add allowlist rows on a batch branch
  should note the specifier to land them on main instead.
- Which merge dropped the bl1280 row on the QA branch is not traced here;
  the restore makes it moot, and `git log -S` on the path can answer it if
  it recurs.
