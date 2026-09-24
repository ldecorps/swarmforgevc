# Adjudication: BL-1695 land-escalate on siblings BL-1671/1687/1692/1693 (2026-09-24, specifier)

**Inbound.** QA note 003115 (09:19Z): "BL-1695 land-escalate: sibs
BL-1671,1687,1692,1693 unlanded/stale; see evidence". QA evidence (QA
branch): `backlog/evidence/BL-1695-land-escalate-20260924.md`.
`land_step_cli.bb BL-1695 d71276404f` refused under BL-1546: BL-1692's
`backlog/active/` YAML is present on QA's tip, its only owner is closed
on origin/main, and no BL-1695 commit touches it.

## Findings (read-only, specifier, 2026-09-24 ~09:25Z)

- **Stale QA branch, not an entanglement.** "Close BL-1692: move to done"
  is 8aaa819b2d (08:42Z today), after QA's last origin/main merge
  (a3546a1197, 08:18Z). QA's tip d71276404f is 928 commits ahead of
  origin/main. QA's reflog has no `reset: moving to origin/main` today:
  the three hand-built lands (BL-1691, BL-1694, BL-1692 - by hand because
  of the BL-1713 defect) skipped the post-land re-point that
  `land_main_publish.sh` runs, so closed tickets' files stayed on the
  branch.
- **A sync clears the refusal.** `git merge-tree --write-tree origin/main
  d71276404f` is clean (tree e8aee6d367). In that tree BL-1692 has no
  `backlog/active/` YAML, and BL-1671 has none on either side.
- **BL-1687 and BL-1693 do not block.** Both are genuinely unlanded
  (active on origin/main), but in origin/main..d71276404f their tagged
  commits touch 24 and 6 paths, and none is one of BL-1695's 11 own paths
  (the property test and its two helpers, the handler, the evidence). The
  BL-1241 replay excludes paths that only an unlanded sibling owns.
  They never ride.

## Ruling

1. **BL-1671 and BL-1692:** landed. There is no ordering to decide; the
   stale files are the branch's, not the tickets'.
2. **Sync QA's branch:** `git merge origin/main` (clean), or run the
   skipped re-point (`bb swarmforge/scripts/land_step_cli.bb repoint
   <root> <task>`, as `land_main_publish.sh` does after a publish).
3. **Re-run the land step** on the new tip, citing its FULL sha
   (QA.prompt interim rule, BL-1713), never `HEAD`. Then:
   - LAND_REPLAY or LAND_CLEAN whose built commit's diff against
     origin/main names only BL-1695's paths (EXCLUDED_SIBLING_PATH lines
     for BL-1687/BL-1693 are expected): land it by the BL-1241 remedy,
     recording `abandoned_commits`.
   - Anything else (a new escalation reason, or a BL-1687/BL-1693 path
     in the built diff): send the output back; do not hand-build.

No ticket minted. The re-point gap is today's hand lands, whose cause
BL-1713 owns. If a re-point is skipped after a tool-driven land, that
would be a separate defect.

By specifier.
