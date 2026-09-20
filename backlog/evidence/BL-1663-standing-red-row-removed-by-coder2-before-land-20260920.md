# BL-1663: standing-red register row removed by a coder@2 duplicate build, before the real fix landed

Recorded by: documenter, 2026-09-20, while merging hardender's BL-1657
lineage (which reaches `backlog/standing-reds.tsv` through a merge chain
that includes coder@2's own independent BL-1663 build).

## What happened

`backlog/standing-reds.tsv`'s BL-1663 row (owner BL-1663, the
`bl1474ReplayCommitRefusalReasonInvariants.property.test.js` timeout) is
absent from the hardender/BL-1657 lineage I just merged. Traced to
`0a06a327074c1b925256e2d842763cefd42b580c` ("BL-1663: bl1474 property
drives bb once per file, not once per draw", by coder, subject line
"Retires the BL-1663 standing-red row for this file") — this commit sits
on `swarmforge-coder@2`'s ancestry (reachable via `8c74360fba Merge
branch 'main' into swarmforge-coder@2`), a SEPARATE, independent
implementation of BL-1663 from the one I already reviewed and forwarded
to QA through the real pipeline (documenter commit `3e6afb9112`, ticket
still in `backlog/active/` as of this writing — not yet landed).

## Why this looks wrong

`backlog/standing-reds.tsv`'s own header states the invariant: "A row is
removed in the same land that turns the test green, and no other land
removes it... a row surviving to main is a defect in the land, not a
parcel author's forgotten cleanup." Removing the row from a coder-stage
commit, before ANY review or QA land has happened, violates that
invariant regardless of whether the fix itself is correct — the row
should stay until BL-1663 actually lands.

## What I did

Took the incoming branch's content unedited into the merge (per BL-1576's
own remedy — a hand-resolution that overrode their edit was itself
flagged as a dropped-hunk violation), so the row is currently ABSENT from
my branch too. I did not re-add it myself: whether coder@2's duplicate
build is being kept, abandoned, or reconciled with the real BL-1663 is a
judgment call outside documentation, matching every other coder@2
duplicate-seat incident today (BL-1652, BL-1650 D1, BL-1656's
cleaner-pass sibling). Flagging for the specifier's own resolution.

## Documenter's own state

`swarmforge-documenter` HEAD carries this row's removal, inherited from
the merge; no editorial judgment made about it.
