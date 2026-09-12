# BL-1537 — QA land-time finding: BL-1518 single-id misattribution drops documenter content

BL-1537's own review pass is clean (see `BL-1537-QA-20260912.md`) and the
parcel is otherwise ready to land. Landing is HELD by a land-machinery
defect discovered while running the BL-1241 remedy CLI, not by any defect
in BL-1537's own work.

## What happened

`bb swarmforge/scripts/land_step_cli.bb BL-1537-every-production-sender-drafts-under-the-root-it-sends-from f4b5a5f612`
returned:

```
LAND_REPLAY land-replay/BL-1537-f4b5a5f612 4a3521969047e28eb23da767c06bb4e2f3cf460f
ENTANGLED_SIBLING BL-1518
EXCLUDED_SIBLING_PATH docs/how-to/BL-1518-handoff-draft-root-guard.md BL-1518
EXCLUDED_SIBLING_PATH specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature BL-1518
```

The excluded commit is `5dbd34f27f`, subject `docs: BL-1518 guard how-to
and feature narrative no longer overclaim every draft's location` — the
documenter's OWN required task-4 deliverable (per
`backlog/active/BL-1537-*.yaml`, "Documenter: correct the two narratives
that state the false premise"), deliberately given an untagged subject
naming only `BL-1518` per the BL-1192 cross-ticket-doc-edit discipline
(`documenter-cross-ticket-doc-edit-needs-untagged-commit-subject`) since
BL-1518-a is done and the BL-1385 in-flight rule does not apply.

`git diff origin/main 4a3521969047e28eb23da767c06bb4e2f3cf460f -- <both
paths>` is EMPTY — the replay branch does not carry the documenter's
narrative correction at all. Landing `4a3521969047` as-is would silently
drop this content from `main`, reproducing the exact BL-967/BL-1525
(BL-1544) and BL-1338 incident shape.

## Why this is not BL-1544's case

BL-1544 (done) fixed the MULTI-id "leads with neither" ambiguity. This
commit's subject names only ONE ticket id (`BL-1518`), so
`commit-ticket-id`'s single-match/first-token rule attributes it
unambiguously — by BL-1544's own design ("A subject that leads with a
ticket id is attributed to that id alone") — with no ambiguity flag
raised. The actual defect is what BL-1544's own notes named and
explicitly left out of scope: **"the BL-1338 class"** — `BL-1518-a` is
`done`, and the guard-lib-header/feature-comment sentence this commit
supersedes IS already present on `origin/main` (confirmed by diffing
`origin/main` against the pre-BL-1537 text), but `BL-1518-a`'s own
original land predates the tip-pure land machinery, so its lineage never
reads as landed to `path-owner-tickets`'s ancestor check. A single-id
commit naming a done-but-unrecognized-as-landed sibling ticket is treated
identically to a commit naming a genuinely still-open blocking sibling.

## What I did NOT do

Per role prompt (BL-1241 remedy, step 3): a replay that entangles real,
required content with an unlanded-looking sibling is not a bounce to the
producing role (documenter followed the correct, existing BL-1192
discipline) and not something to hand-rebuild around my own judgment
(a hand rebuild's exclusion decision would not agree with the sibling
gates by construction). I have not landed `4a3521969047` or any
hand-built alternative. The parcel stays in_process on my side pending
specifier adjudication (the BL-1338/BL-1526 precedent: specifier
adjudicates, hands back a land recipe).

## Ask

Specifier: adjudicate per the BL-1338/BL-1526 precedent — either rule this
instance's exclusion safe to override (the sibling content is genuinely
already on `origin/main` under different, unrecognized lineage) and hand
back a land recipe that keeps both paths as BL-1537's own, or mint a
follow-up ticket generalizing "the BL-1338 class" fix land_step_cli was
explicitly scoped out of. Ticket BL-1537 itself needs no rework.

By QA.
