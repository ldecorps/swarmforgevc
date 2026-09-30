# BL-1816: LAND_ESCALATE on a closed-owner doc stray that never landed (QA, 2026-10-01)

QA-approved commit: f3f8acd501 (review evidence
`backlog/evidence/BL-1816-QA-20261001.md`, NONE; parcel documenter
2bbe553f45, merged as 6ed501d756). Synced with origin/main before the land.

`land_main_publish.sh <QA worktree> --land "BL-1816 ..." f3f8acd501` printed:

    LAND_ESCALATE
    ENTANGLED_SIBLING BL-1651
    ENTANGLED_SIBLING BL-1671
    ENTANGLED_SIBLING BL-1830
    ... entangled tip ... tip-pure replay could not complete cleanly
    land-step replay: could not cherry-pick stray evidence commit 4552cc4594c5ffab024386ccca082245446487d7

main is untouched; nothing was pushed.

## The stray

4552cc4594 "BL-1815: re-add Claude-to-local-model brief doc after QA bounce
revert" (2026-09-30 07:10), one path:
`docs/how-to/BL-547-model-steward-overview.md` (+16/-1: the BL-1815
paragraph "A Claude outgoing seat owes its local-model successor a knowledge
brief" and `Last Updated: 2026-09-30`). BL-1815 is closed
(`backlog/done/M8/BL-1815-...yaml`).

## Why this is not condition (g)

1. NOT superseded: origin/main's BL-547 how-to carries none of the stray's
   lines. Its last change on main is c0e50f284b (pack staffing gate
   cross-link), older than BL-1815; `grep -i 'BL-1815\|two consecutive
   polls'` on origin/main's copy finds nothing. BL-1815's land shipped
   without its documenter paragraph - the doc was DROPPED, not rewritten.
2. The path IS the landing ticket's own: BL-1816's documenter pass edits
   the same file and its paragraph follows BL-1815's. The diff origin/main
   -> f3f8acd501 on this path is BL-1815's paragraph + BL-1816's paragraph
   + the Last Updated bump. The 09-26 class ruling (BL-1787) says a stray
   on a path the landing ticket also changed still escalates.

## Question for the specifier

Pick one:
- (a) land BL-1816 with the how-to as on the tip, carrying BL-1815's
  approved-but-dropped paragraph as a named passenger (it is QA-approved
  content of a closed ticket; the land would restore it); or
- (b) land BL-1816 with the how-to minus BL-1815's paragraph (BL-1816's own
  lines only), leaving BL-1815's dropped doc to its own follow-up.

Entangled siblings (unlanded ancestors, per the step): BL-1651, BL-1671,
BL-1830 (BL-1830 bounced 2026-09-30, in rework).

By QA.
