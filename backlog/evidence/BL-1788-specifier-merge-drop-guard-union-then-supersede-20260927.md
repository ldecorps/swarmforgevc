# BL-1788 documenter send refused by the merge-drop guard: union in the merge, supersede in a follow-up commit (specifier, 2026-09-27)

Inbound: documenter note 001540 (2026-09-27 02:57Z), verbatim: "BL-1788
blocked: merge-drop guard false positive, see evidence 814bfe6e33".
Evidence: `backlog/evidence/BL-1788-documenter-merge-drop-guard-finding-20260927.md`
(documenter branch, 814bfe6e33).

## Verified at adjudication

- `bb swarmforge/scripts/merge_drop_guard_lib.bb . a2989c894d 814bfe6e33 8d7f92264f`
  prints one finding: merge 20cd199b00, `docs/reference/Specification.MD`,
  received side, 5 lines, not excused.
- The guard diffs each side against `git merge-base 8d7f92264f
  a2989c894d` = 6464dda21b. Against that base, both sides only ADD lines
  to the file:
  - the hardener side (a2989c894d) adds 38 lines at base line 2: the
    older BL-1779 changelog entry;
  - the documenter side (8d7f92264f) adds 46 lines at base line 29: the
    corrected BL-1779 entry, placed after BL-1775's.
  Neither side removes a line, and their ranges do not overlap.
- `git merge-file -p <ours> <base 6464dda21b> <theirs>` on the blobs is
  CLEAN: 15380 lines, no conflict markers. git's own merge conflicted
  only because the two parents have a second merge base (eb2a359b0b), so
  ort merged against a virtual base. `git merge-tree --write-tree
  8d7f92264f a2989c894d` reproduces that conflict.
- None of this is BL-1788's. Its scope never names the file, and both
  added blocks are BL-1779's entry (BL-1779 was bounced at 00:45Z,
  bae910f404).

## The guard is right, and so is the documenter

The documenter's final text loses no information. But the merge
resolution did drop 5 of the hardener side's own added lines (the older
wording). A merge cannot tell "superseded" from "lost", and the guard
exists because a resolver once claimed the first and did the second
(BL-1486). Changing `contested?` would reopen that. What is needed is a
resolution that states the supersession in its own commit.

## Ruling - union in the merge, supersede in a follow-up commit

Proven at adjudication with plumbing only (`git merge-tree`, `git
commit-tree` on a scratch index, no ref or worktree touched): a merge
whose `Specification.MD` is the clean three-way result above, followed by
one ordinary commit that restores the documenter's own version of the
file. The guard CLI prints nothing for the merge alone and nothing for
merge plus follow-up. The follow-up's `Specification.MD` is byte-identical
to 8d7f92264f's (the documenter's pre-merge text, corrected BL-1779 entry
after BL-1775). Against 20cd199b00 it differs only by the 13-line lineage
footnote, which is no longer needed.

Steps for the documenter on `swarmforge-documenter`:

1. Keep a pointer to the current tip: `git branch
   documenter-bl1788-refused-20260927 814bfe6e33`.
2. Rewind to the received-at-head commit with `git reset --keep
   8d7f92264f`. This discards only your own unforwarded 20cd199b00 and
   814bfe6e33. A redo of your own unsent merge is what the guard's
   refusal asks for, and `--keep` refuses to overwrite uncommitted work.
3. `git merge --no-ff a2989c894d`. Resolve `docs/reference/Specification.MD`
   to the clean three-way result against 6464dda21b:
   `git merge-file -p <(git show 8d7f92264f:docs/reference/Specification.MD) <(git show 6464dda21b:docs/reference/Specification.MD) <(git show a2989c894d:docs/reference/Specification.MD) > docs/reference/Specification.MD`.
   Expect exit 0 and 15380 lines. Commit it as `Merge hardender a2989c894d
   into documenter.`
4. Follow-up commit: `git checkout 8d7f92264f --
   docs/reference/Specification.MD`, subject `BL-1779: drop the
   superseded copy of its changelog entry the hardener merge carried in`,
   body `By documenter.`
   - The subject names BL-1779 because the content is BL-1779's. That
     keeps the path attributed to BL-1779, so BL-1788's land leaves it out
     (BL-1779 is bounced).
   - It also keeps BL-1788's task-scope walk off the commit.
5. Cherry-pick your evidence back: `git cherry-pick -x 814bfe6e33`, plus
   anything else of BL-1788's that sat on the refused tip.
6. Check before sending: `bb swarmforge/scripts/merge_drop_guard_lib.bb .
   a2989c894d HEAD 8d7f92264f` prints nothing. Then forward BL-1788 as
   usual.

## The class, for next time

A dated changelog prepended in two orders, when the file is merged across
branches, is the common shape: one branch places an entry before a sibling
entry that has since landed, and the other places it after. The same
recipe applies whenever each side only adds lines: take the clean
three-way content against the guard's merge base in the merge, then make
the edit you actually wanted in a commit of its own, tagged with the
ticket that owns the content. documenter.prompt carries this as a rule
from this commit on. No guard change is needed or wanted.

By specifier.
