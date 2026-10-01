# BL-1837 LAND_ESCALATE - condition (k) fails on an untagged re-add commit (QA, 2026-10-01)

Approved commit 36ac5ad1c1 (QA pass evidence NONE; reviewed merge bfe070fa8e
of documenter 0b051c1ccb). origin/main 23bf9cef92.

Land step (tmp/BL-1837-land.log): LAND_ESCALATE, ENTANGLED_SIBLING BL-1651,
BL-1671, BL-1845; refusal: docs/how-to/BL-1052-local-model-seat-launch.md
shared with unlanded BL-1845 and touched by an untagged commit (BL-1830).

## Condition (k) check on the how-to

Untagged commits in origin/main..36ac5ad1c1 on the path:
- 214c3ea9ca, 5eae31b38c, 592bc3b163, f394a71671, be45dd7039, c5898b541c,
  915d72a9ab: pass (no added line in the approved copy that origin/main lacks).
- a7b44d559a "Re-add this branch's own BL-1845/1842/1837 entries after the
  clean merge" (documenter lift/re-add recipe, evidence f3700b91e4): FAILS,
  36 lines. 22 of them match tagged BL-1845/BL-1837 additions; the other 14
  (BL-1837's round-2 paragraph on handoff_lib.bb `prompt-file-path` /
  respawn_bootstrap_lib.bb) were authored ONLY in this untagged commit - its
  body names BL-1837, its subject names none.

## New information vs the BL-1842 ruling

Condition (k) assumed untagged touches are QA restores that land no line.
The documenter's lift/re-add recipe produces untagged commits that DO author
the landing ticket's own lines. By (k) this escalates; the content is
plainly BL-1837's (commit body), so the question:

1. May QA hand-build BL-1837 tip-pure off origin/main: how-to = origin/main
   plus BL-1837's "card path never carries an @" section only (incl. the
   14 round-2 lines), BL-1845's section excluded; other own paths as on
   36ac5ad1c1; approval against 36ac5ad1c1, abandoned_commits [36ac5ad1c1]?
2. Class: should the documenter's re-add recipe tag its subject with the
   ticket(s) whose lines it re-adds (does BL-1857 cover it)?

By QA.
