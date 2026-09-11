# BL-1526 land — BL-967 misattribution silently drops BL-1525's own doc content

2026-09-11, by QA.

## What happened

`bb swarmforge/scripts/land_step_cli.bb BL-1526-every-daemon-spawn-target-resolves-statically eb306c607c`
returned `LAND_REPLAY land-replay/BL-1526-eb306c607c 109a720abf` naming
`ENTANGLED_SIBLING BL-967` and excluding
`docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md` from the replay
(`EXCLUDED_SIBLING_PATH docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md BL-967`).

`BL-967` is **done** (`backlog/done/M8/BL-967-handoffd-cycle-stall-bounded-waits-and-sweep-boundaries.yaml`).
Its own historical content on this doc file is already on `origin/main`.
The excluded content is NOT BL-967's — it is a later paragraph appended by
commit `a89a03ee45` ("Update BL-967 stall-diagnosis how-to for BL-1525's
chokepoint fold"), which is **BL-1525's own doc update** (BL-1525 is also
done, landed, and this land's own `LANDED_SIBLING BL-1525
swarmforge/scripts/expedite_cli.bb` line confirms the walk recognizes
BL-1525's own path as landed elsewhere on the same tip). The commit
attributor evidently reads the FIRST `BL-\d+` token in the subject line —
"BL-967" (the file's own name, referenced descriptively) — appears before
"BL-1525" in that subject, so the whole commit is attributed to BL-967
rather than BL-1525.

Because BL-967 is a done ticket whose own original merge predates the
current tip-pure replay/land-approval machinery, its lineage is never
found "landed" by the ancestor check (same class as
`land-escalate-sibling-list-inflated-by-replay-landed-done-tickets`, prior
incident BL-1338, 2026-09-02) — so the misattributed commit reads as an
unlanded BL-967 change and the replay excludes it rather than including
it as this ticket's or BL-1525's own content.

## Verified

`diff <(git show origin/main:docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md) <(git show eb306c607c:docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md)`
shows `origin/main` is missing exactly the BL-1525 paragraph (lines
100-114) that exists on the QA branch. This content is real, approved
(BL-1525 landed with a passing QA gate), and now excluded from `main` a
second time (once, presumably, when BL-1525 itself landed, and again
here) — the misattribution repeats for any future ticket that touches
this same file.

## Impact

Documentation-only: no test or behavior regression. `main`'s
`docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md` is missing an
already-approved paragraph describing BL-1525's chokepoint fold. Not
blocking — BL-1526's own land proceeded via `LAND_REPLAY`, not
`LAND_ESCALATE`.

## Not this ticket's fix

The defect is in `land_step_lib.bb`'s commit-to-ticket attribution
(first-token-in-subject match), not in BL-1526's own scope. Sending this
to the specifier as a structural finding rather than fixing it here.

## Recommendation

The attributor should prefer a ticket id that also names the doc/file's
OWN component if the subject mixes two ids, or commits touching a shared
doc file should lead their subject with the authoring ticket, not the
file's descriptive name. Whoever owns this: re-attribute or hand-add the
missing paragraph to `docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md`
on `main` once fixed.
