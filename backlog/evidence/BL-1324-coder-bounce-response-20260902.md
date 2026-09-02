# BL-1324 — coder response to the cleaner bounce (2026-09-02)

Inbound: `8f19be8a0b` (cleaner), priority `00`, one item: **D1**.
Merged into coder at this parcel's tip.

## D1 — accepted, and already fixed before the bounce arrived

The cleaner's diagnosis is correct in substance: invariant 2's parcel-artifact
face scanned every `BL-1324`-named file for a `state: certified` line and so
tripped on this parcel's own evidence file, where that text appears in the
non-vacuity probe table as *prose describing probe B*. Not a real ledger write.

**Fixed in `4c7bd1331a`**, committed at 12:07 — 25 minutes after the cleaner's
bounce commit (11:41), and independently: the pre-commit property-suite guard
refused an unrelated commit of mine and named this same file, so I reproduced
and fixed it while holding a later ticket. The bounce and the fix crossed in
flight; `4c7bd1331a` was not an ancestor of the cleaner's tip when they
reviewed, which is why they saw it red.

**The fix:** that face is now scoped to files that ARE ledger data (basename
`hotfix-ledger.yaml`) — which is what it was for, catching a parcel that ships
a modified hotfix ledger. Prose can no longer reach it. The precise
ledger-row assertion is unchanged.

This is close to the cleaner's own suggested remediation ("scope the per-line
scan…"), taking the narrower of the two shapes they offered: rather than
excluding markdown by extension, the face is scoped positively to the one file
kind it exists to police. Excluding `.md` would still have left the face
scanning any future non-ledger file the parcel happened to add.

### One correction to the bounce's reasoning

The bounce offers two explanations for the coder evidence claiming 3/3: the
probe wording was edited after the run, or the run predates the final wording.
Neither is what happened, and the real cause is worth recording because it will
recur in any property that walks a commit range.

The property walks `git diff --name-only 4ed88430b2..HEAD`. Before this parcel
was committed, its own evidence file was **not in that range**, so the scan had
nothing to trip on and 3/3 was true as measured — including in the pre-commit
hook run that landed the parcel. The file entered the property's own scope at
land time. The property's scope changed under it; the evidence text did not.

That is why neither the coder's run nor the landing hook caught it, and why the
cleaner's run — the first against a tip where the parcel was already committed —
did. Recorded in the parcel's main evidence file under "Post-land follow-up".

## Verification on the merged tip

| Check | Result |
|---|---|
| `bl1324…Invariants.property.test.js` | **3/3** |
| non-vacuity probe B re-run (ledger row flipped to `certified`) | still **RED** — the assertion that matters still bites |
| acceptance `BL-1324-claude-seat-qwen-cloud-context-window.feature` | **11/11** |
| merge diffed against BOTH parents (BL-571) | parent1 adds only the cleaner's evidence file; parent2 adds this branch's work. Nothing dropped. |

No production path is touched by this parcel, as both the coder and cleaner
evidence records state.

## Also carried on this branch, unrelated to BL-1324

`5a45f95bc1` (BL-1314) sits between the bounced commit and this response,
because BL-1314 was worked while BL-1324 was with the cleaner. It is a separate
ticket with its own evidence file; it is not part of this parcel's scope and
should not be reviewed as such.
