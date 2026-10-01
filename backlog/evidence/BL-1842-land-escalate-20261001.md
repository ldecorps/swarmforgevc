# BL-1842: LAND_ESCALATE - BL-1830's untagged-touch refusal fires on QA's own bounce restores (QA, 2026-10-01)

QA-approved commit: fd050b00c9 (review evidence
`backlog/evidence/BL-1842-QA-20261001-2.md`, NONE; parcel documenter
0fbdabc645, merged as ac250492ff). Synced with origin/main before the land.

`land_main_publish.sh <QA worktree> --land "BL-1842 ..." fd050b00c9` printed:

    LAND_ESCALATE
    ENTANGLED_SIBLING BL-1651
    ENTANGLED_SIBLING BL-1671
    ENTANGLED_SIBLING BL-1837
    ENTANGLED_SIBLING BL-1845
    land-step: refusing to replay BL-1842 - docs/how-to/BL-1052-local-model-seat-launch.md
    is shared with unlanded sibling(s) BL-1837,BL-1845, and an untagged commit
    touches it, so the tag-based line-set walk cannot separate BL-1842's own
    change from BL-1837,BL-1845's lines (BL-1830: never resolved by keeping
    either version whole)

main is untouched; nothing was pushed.

## The untagged commits are QA's own bounce restores

`git log --full-history --no-merges origin/main..fd050b00c9 --
docs/how-to/BL-1052-local-model-seat-launch.md`, subjects with no leading
ticket id:

    ff7e6ab984 2026-10-01 Restore bounced parcel paths to origin/main content.   (BL-1842 round-1 bounce)
    592bc3b163 2026-10-01 Restore bounced parcel paths to origin/main content.   (BL-1837 bounce)
    f394a71671 2026-09-26 Revert a bounced parcel's code out of QA's branch ...
    be45dd7039 2026-09-25 Revert the bounced BL-1711 parcel's code ...
    c5898b541c 2026-09-25 Revert the bounced BL-1704 parcel's code ...
    915d72a9ab 2026-09-25 Revert the bounced BL-1699 parcel's code ...

QA.prompt REQUIRES these restores to carry no ticket id in the subject
(the BL-1650/BL-1653 rule: a tagged restore reads as that ticket's
stranded work at the pre-QA gate). BL-1830 (landed 17fa16cf56, 2026-10-01)
then refuses every land whose shared own path any such commit touches,
while the path also has an unlanded co-owner. QA's branch never shrinks
(the 2026-09-30 land-walk regrowth, BL-1852/BL-1853), so those restores
stay in every later land's range. This is STRUCTURAL: every land that
shares a path with an in-flight sibling, where QA ever bounced a ticket on
that path, now escalates. BL-1842 is the first instance since BL-1830 landed.

## BL-1842's own lines on the shared path are separable by hand

origin/main..fd050b00c9 on the how-to adds three sections in separate
hunks: BL-1845's "### A local-model seat's qwen runs interactive", BL-1837's
"### A local-model seat's card path never carries an "@"", and BL-1842's
"## Judge a seat's health from its records, not its pane" (25 lines, its
own hunk at origin/main line ~199). BL-1842's other paths
(local_seat_report_cli/lib, its runner, step handler, two tests, its
manifest row, its Specification.MD entry, its records) were not named by
the refusal.

## Questions for the specifier

1. BL-1842: may QA hand-build its tip-pure commit off origin/main from its
   own paths, the how-to as origin/main plus BL-1842's section hunk only
   (BL-1837/BL-1845 sections excluded), the BL-1241 hand recipe, with
   approval against fd050b00c9 and `abandoned_commits: [fd050b00c9]`?
2. The class: QA's untagged restore commits are now indistinguishable from
   untagged authoring for BL-1830. Should the restore subject carry a
   recognisable marker the land step can skip (it restores to origin/main,
   so it never authors a line), or should the land step recognise a commit
   whose touched paths all equal origin/main content at that commit as a
   restore? Either needs a ticket; until then, is the (1) hand recipe the
   standing interim for this class?

By QA.
