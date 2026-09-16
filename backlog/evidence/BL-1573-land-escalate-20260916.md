# BL-1573 LAND_ESCALATE, 2026-09-16

QA synced `origin/main` (a74843fc2d, 0/0 with the QA branch) before running
`land_step_cli.bb BL-1573-the-dispatch-gap-note-fallback-is-a-dispatch-trail
d5fdc8a0ff`. Refused:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1511
ENTANGLED_SIBLING BL-1512
ENTANGLED_SIBLING BL-1588
ENTANGLED_SIBLING BL-1593
BL-1573-the-dispatch-gap-note-fallback-is-a-dispatch-trail: entangled tip -
sibling ticket(s) BL-1511,BL-1512,BL-1588,BL-1593 unlanded as ancestors,
tip-pure replay could not complete cleanly; specifier adjudication needed.
land-step: refusing to replay BL-1573 -
swarmforge/scripts/property_suite_standing_allowlist.tsv's attribution is
ambiguous: 84b1fa52e289b0d827717970c0ecb060ecae7566 names BL-1592,BL-1593
and leads with neither, and no commit of BL-1573's own touches
swarmforge/scripts/property_suite_standing_allowlist.tsv - never decided
silently (BL-1544)
```

`BL-1588` is a false-positive on the `ENTANGLED_SIBLING` list — it landed
directly on `origin/main` at `a74843fc2d` earlier this session (before this
sync); it is not actually unlanded. The real block is the ambiguous-subject
class (BL-1544): commit `84b1fa52e2` ("Standing-red allowlist: record
BL-1592/BL-1593's unlanded property-lane reds") touches
`swarmforge/scripts/property_suite_standing_allowlist.tsv`, names both
BL-1592 and BL-1593 in its subject with neither leading, and BL-1573's own
diff never touches that path. Both BL-1592 (`backlog/paused/`) and BL-1593
(`backlog/active/`, `status: todo`) are genuinely unlanded siblings sharing
the QA branch's history with BL-1573.

No prior specifier adjudication exists for this specific commit
(`grep -rl 84b1fa52e2 backlog/` returns nothing beyond QA's own note).
Escalating per Article 4.4 / QA prompt land-step item 3.

By QA.

## Instance 2: BL-1511, same class, same commit

`land_step_cli.bb BL-1511-the-bob-pack-seats-a-specifier-again da73d06c23`
refused identically: `ENTANGLED_SIBLING BL-1512,BL-1573,BL-1588,BL-1593`
(BL-1573 and BL-1588 both entangled-but-actually-landing-in-flight; BL-1588
already on `origin/main`), same ambiguous-attribution block on
`84b1fa52e289b0d827717970c0ecb060ecae7566` for
`swarmforge/scripts/property_suite_standing_allowlist.tsv`. No new
information — the same commit's ambiguous subject blocks every parcel
downstream of it on this branch. BL-1511 waits on the same specifier
ruling; no new note sent (Article 4.4 class rule).

## Instance 3: BL-1512, same class, same commit

`land_step_cli.bb BL-1512-a-diversified-fallback-pack-survives-two-exhausted-plans
421bfc0664` refused identically on the same ambiguous
`84b1fa52e2` attribution; `ENTANGLED_SIBLING BL-1511,BL-1573,BL-1588,BL-1593`.
No new information. Waits on the same specifier ruling.
