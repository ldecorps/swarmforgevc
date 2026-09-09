# Article 4.2 escalation `pipeline-code-on-main-bca4418b9a` — FALSE POSITIVE (orphaned land-replay source)

Operator adjudication, 2026-09-08T01:49:20Z. First delivery of this subject; no prior
evidence file and no waive named this sha.

## The finding

babysitterd: `bca4418b9a74b97d8860643a4c217f025890744c` "BL-1408: hand-built
tip-pure replay onto origin/main (BL-1241 recipe)" (author t, 2026-09-08
01:44:28Z) touches `specs/pipeline/steps/bl1408CommitGuardTestsDeriveTheirSetSteps.js`.

`is_qa_ancestor.sh bca4418b9a` exits **1**:

> not approved: bca4418b9a has a land-replay record naming source 3c8581c68b,
> which is not itself approved

## Why the predicate says no

QA DID record the land-approval, one minute after the land:

    {"at":"2026-09-08T01:45:48.779224074Z","ticket":"BL-1408","commit":"bca4418b9a","source":"3c8581c68b"}

The row is well formed. The BL-1334 replay path then asks whether the named
SOURCE is approved, and `3c8581c68b` ("BL-1408: QA review pass evidence
(NONE)", 2026-09-07 18:07:26Z) is **no longer an ancestor of `swarmforge-QA`**
— `git merge-base --is-ancestor 3c8581c68b swarmforge-QA` = 1, and
`git branch -a --contains 3c8581c68b` lists nothing. It is orphaned.

It was orphaned by BL-1408's FIRST land attempt failing: ledger row
`{"at":"2026-09-07T18:09:22Z","ticket":"BL-1408","commit":"0c7804cbdf","source":"3c8581c68b"}`
— and `0c7804cbdf` ("BL-1408: tip-pure replay onto origin/main") is **not on
main** either. That is the BL-1463 pattern already recorded on the QA line
("a topic-record sweep on main blocks every land by fast-forward exhaustion,
20 attempts, all rejected"). The QA branch was rebuilt past the failed
attempt, taking `3c8581c68b` out of `swarmforge-QA`'s history, and today's
rebuild at 01:44Z re-used the same (now dangling) source sha in its record.

## Why it is nonetheless not an Article 4.2 violation

The flagged pipeline file's content **was** QA-reviewed:

    diff <(git cat-file -p 3c8581c68b:specs/pipeline/steps/bl1408CommitGuardTestsDeriveTheirSetSteps.js) \
         <(git cat-file -p bca4418b9a:specs/pipeline/steps/bl1408CommitGuardTestsDeriveTheirSetSteps.js)
    -> IDENTICAL (197 lines)

`3c8581c68b` is a genuine QA-line commit (parent chain: "Merge documenter
3e9d8139a8 into QA"), it carries QA's own review-pass evidence for BL-1408
with NONE findings, and neither `bca4418b9a` nor `3c8581c68b` appears in any
bounce store (`.swarmforge/bounces/*.jsonl` clean, no `bounce_history` row).
The 240-file spread between the two trees is just main's 7.5h of drift since
the fork, not unreviewed content riding along.

Contrast the two sibling lands of the same hour, which did NOT flag, because
their sources are still on the QA line:

    BL-1477 86e42d21ef <- ccd92e1751   is_qa_ancestor -> 0 approved
    BL-1474 2d2138ec2c <- 8af7688f51   is_qa_ancestor -> 0 approved
    BL-1408 bca4418b9a <- 3c8581c68b   is_qa_ancestor -> 1 NOT approved

Same recipe, same recorder, same minute-scale window. The only difference is
that BL-1408's source was orphaned by its earlier failed land.

## Expected to self-heal — no action taken

`is_qa_ancestor.sh` checks direct ancestry from `swarmforge-QA` BEFORE the
BL-1334 replay path. `swarmforge-QA` is currently `79e07eeb7a` "Merge main
2f19d96594 into QA" (01:31Z), which predates the 01:44Z land. QA merges main
into QA routinely (twice inside two minutes at 01:29Z / 01:31Z). At the next
such merge `bca4418b9a` itself becomes a QA ancestor, the ancestry path
approves it directly, and the escalation stops without anyone recording
anything.

Operator therefore took NO action: no waive (coordinator's call, BL-1344), no
land-approval re-record (QA's call, BL-1405), no nudge — QA was mid-turn on
another parcel at the time (14m49s spinner, resolving Specification.MD
conflicts) and nudging it toward a self-clearing record would cost more than
it saves.

## If this subject re-fires

It means the self-heal did not happen (QA's main->QA merge did not land, or
the ledger row's dangling source is being consulted before ancestry). The
close-out is then QA's: re-record the BL-1408 land-approval naming a source
that IS a current `swarmforge-QA` ancestor, so `is_qa_ancestor.sh bca4418b9a`
exits 0 (BL-1405). Do not re-derive the review question — it is settled above.
