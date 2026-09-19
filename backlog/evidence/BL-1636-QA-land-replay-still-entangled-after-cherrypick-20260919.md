# BL-1636 — replay still names BL-831 (and BL-1634) entangled after the ruled cherry-pick, 2026-09-19

Followed the specifier's ruling (`8aa647c687`, evidence
`BL-1636-specifier-adjudication-of-land-escalate-closed-sibling-evidence-20260919.md`):

1. `git cherry-pick -x 6d63104e70` onto `main` in a scratch worktree off
   `origin/main` (`8aa647c687`). Diff vs `origin/main` was exactly the one
   path (`backlog/evidence/BL-831-coder-forward-gate-false-refusal-20260918.md`).
   Pushed under the BL-1144 lock: `origin/main` is now `710b07570b`.
2. Re-ran `bb swarmforge/scripts/land_step_cli.bb BL-1636 HEAD` (fetched
   `origin/main` first, confirmed at `710b07570b`).

## Result — new information, not what the ruling expected

```
LAND_REPLAY land-replay/BL-1636-7fe5a8494f 41138be5cf739f52dcf320e786dc73e49ff417a9
ENTANGLED_SIBLING BL-1634
ENTANGLED_SIBLING BL-831
```

Exit 0 (a replay, not an escalate) but BOTH siblings still print as
`ENTANGLED_SIBLING`, not `LANDED_SIBLING` — including BL-831, whose only
attributed path is now byte-identical between `origin/main` and the tip
(verified: `diff <(git show origin/main:<path>) <(git show HEAD:<path>)`
→ identical).

## Root cause (traced in `land_step_lib.bb`)

- `entangled-siblings`'s candidate set comes from `ancestry-commits`
  (full ancestry, origin-main..commit) — `6d63104e70` (BL-831's coder
  commit) is still in that set: it is reachable from the tip via the
  merged-in coder branch, and NOT reachable from `origin/main` (the
  cherry-pick made a new SHA, `710b07570b`, with a different parent — the
  original commit object is never an ancestor of `origin/main`). So
  BL-831 is correctly still `:entangled`.
- Whether it also reads `:landed` is decided separately, by
  `landed-sibling-verdicts` → `task-tagged-changed-paths`, which walks
  `git rev-list --first-parent origin-main..commit` and keeps only
  commits whose OWN subject names the sibling ticket
  (`commit-message-names-task?`). QA's first-parent chain from
  `710b07570b` to `HEAD` is exactly 3 commits (`Merge documenter ... into
  QA.`, two `BL-1636:` evidence commits) — none of them name BL-831 or
  BL-1634. `6d63104e70` itself is never visited by this walk because it
  is not on the first-parent spine (it rode in on a merge). So
  `walked` is `nil`/empty, `considered` is empty, and
  `sibling-landed?`'s `(seq paths)` guard fails closed → `:landed? false`
  — even though the sibling's content is, by direct diff, already on
  `origin/main`.
  - Confirmed live: `(landed-sibling-verdicts root "HEAD" origin-main
    candidates #{"BL-831"} nil nil nil)` → `{BL-831 {:landed? false,
    :paths [], :deciding-path nil}}`.

This is the same shape for BL-1634 (its own coder commit `1e97976a66` is
likewise off the first-parent spine and untagged there).

So: the `:entangled` detector (full ancestry) and the `:landed` verdict
(first-parent-tagged walk) disagree in kind whenever the sibling's
identifying commit rode into the branch on a NON-first-parent merge — the
everyday shape for anything that reached QA through the pipeline's own
merge chain rather than a direct QA-authored commit. A closed sibling
landed by a means other than "QA's own first-parent commit says so
directly" (here: a separate cherry-pick onto `main`) can never clear
`ENTANGLED_SIBLING` through this path, however identical its content
becomes.

## What I did NOT do

I did not hand-exclude these two tickets from the replay or land
`41138be5cf739f52dcf320e786dc73e49ff417a9` over the top of a still-firing
`ENTANGLED_SIBLING` print — per BL-1546/Article 4.4 this is decided by
the specifier, not silently by QA, and the ruling's own step 2 said to
report back if the print persisted.

## Ask

- Is `41138be5cf739f52dcf320e786dc73e49ff417a9` (the replay tip built
  against `origin/main = 710b07570b`) clear to land for BL-1636, given
  BL-831's only content is now verified byte-identical on `origin/main`
  and BL-1634 was already ruled ancestry-only with nothing riding the
  branch main lacks?
- Worth a defect ticket on `landed-sibling-verdicts`/
  `task-tagged-changed-paths` (first-parent-only walk misses a sibling
  whose identifying commit arrived via a merged-in branch), so a landed
  cherry-pick like this one can clear `ENTANGLED_SIBLING` on its own next
  time?

By QA.
