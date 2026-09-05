# BL-1370 — CLEANER BOUNCE, 2026-09-05

One item, D1. Full checklist run before this bounce (Article 4.4); nothing
else blocked on it.

## D1 — the amended invariant 1 (path-component boundary fix) is not in this
parcel, though the ticket now requires it to be

**Class**: spec-conformance / missing implementation. **Blamed role**: coder
(a production fix in `process_table_lib.bb` is new behavior — cleaner's
remit is refactor-with-no-new-behavior, not writing it).

The coder's own priority-00 note ("shared scope classifier claims
prefix-sibling roots") triggered a same-day specifier amendment
(`3daeaf5b1c`, 2026-09-05 01:01:33Z), which reworded invariant 1 and added:

> FIX IT IN THIS PARCEL, in `process_table_lib.bb`, keeping it the ONE
> classifier: a path matches the cwd only when equal or followed by `/`,
> and matches the command line only when followed by `/`, whitespace, a
> quote, or end of string.

The commit this handoff carried (`5243b76535`, committed 2026-09-05
01:30:55Z — *after* the amendment) is NOT built on that amendment
(`git merge-base --is-ancestor 3daeaf5b1c 5243b76535` is false) and does
not include the fix:

- `swarmforge/scripts/process_table_lib.bb:148-157`
  (`project-scoped-process?`) is byte-for-byte the pre-amendment bare
  `str/includes?`/`str/starts-with?` matching — still claims
  `/repo-2`/`.worktrees/coder-cursor2` for `/repo`/`.worktrees/coder`.
- `extension/test/bl1370WorktreeStrayCheck.property.test.js:141-159`
  contains a test literally titled *"known boundary: a prefix-shaped
  sibling root IS CLAIMED by the shared classifier"* — it asserts
  `stray === true` for the exact prefix-sibling case invariant 1 now
  forbids, with a comment: *"the fix belongs there and not here. Reported
  to the specifier as a finding... This test exists so the day it changes,
  it changes visibly."* That day is supposed to be this parcel, per the
  amendment — the test pins the bug rather than proving its absence.
- `swarmforge/scripts/test/test_bl1370_worktree_strays.sh` has no
  prefix-sibling case at all (its own/other-worktree test at line 122 uses
  unrelated paths, `mine` vs `theirs`, never a shared-prefix pair) —
  scenarios 07/08 from the amended feature file are not exercised here.
- The amended feature file's own scenarios 07/08 (which I already have in
  my branch via an earlier, unrelated merge-up of the specifier's
  amendment commit) describe exactly this case and are not what this
  commit's acceptance handler was built against.

This matters more than a typical spec-conformance gap because of what the
tool does: `check_worktree_strays.bb --reap` sends `kill -- -<pgid>` to
whatever the shared classifier calls "mine." Per the ticket's own
`approval_context`: *"This tool kills processes, so the bound that matters
is invariant 1... a second notion of scope is exactly how a tool like
this ends up killing a colleague's running suite."* Shipping it with the
known-and-accepted prefix-sibling gap live is the exact failure mode the
ticket exists to prevent — `.worktrees/coder` reaping
`.worktrees/coder-cursor2`'s live suite.

**What is NOT wrong**: everything else in the delivered commit is
internally coherent and was clearly built carefully against the
PRE-amendment ticket text (the coder's own note that found the gap is
itself good work) — this is a timing/sequencing miss (the amendment
landed on `main` while the coder was already deep into implementation),
not a quality lapse elsewhere. `check_worktree_strays.bb`,
`worktree_stray_lib.bb`, the step handler (BL-1371 discovery-registered,
confirmed) and the shell suite's other cases (own-clean, own-stray,
group-vs-pid reaping, stable wording) are well-built and need no rework
once the classifier fix lands — expect this to come back as a small,
additive follow-up, not a rewrite.

## What was checked before concluding this is the only blocking item

- `jscpd` over the new JS files: 0 clones (the two `.bb` files aren't a
  format jscpd recognizes; read them by hand instead, see D1 above).
- `specs/pipeline/steps/bl1370WorktreeStrayCheckSteps.js::registerSteps`
  present and matches the `*Steps.js` directory-walk discovery suffix
  (BL-1371) — `required_wiring` anchor satisfied.
- No prior bounce history for BL-1370 before this one (mint → approve →
  promote → amend (spec, not code) → coder). This is BL-1370's first
  bounce.
- `main`/`origin/main` in sync at merge time (both at the amendment's own
  tip, since I had already merged `3daeaf5b1c` into this branch via an
  earlier, unrelated merge-up before this parcel arrived).

Recording via `record-bounce.js` next; sending a `note` (priority 00) to
coder pointing here, per Article 4.3 (routes to the role that owns the
fix — the specifier already told coder exactly which lines to change).

## Revert disposition — and the `record-bounce.js` false `violation` verdict

`record-bounce.js` reports `verdict: violation` with `liveFiles:
[backlog/evidence/BL-1370-cleaner-bounce-20260905.md]` for the commit
passed (`12b538c4b9`, this evidence file's own commit). Same tool
behaviour as the documented BL-962/BL-963 false positives: **no revert
applies to this bounce**. Nothing delivered here is DEFECTIVE content to
strip out — `check_worktree_strays.bb`, `worktree_stray_lib.bb`, the step
handler and the shell suite's own-clean/own-stray/group-reap cases are all
correct and reusable once the classifier fix lands; the only thing wrong
is an ABSENCE (the amended invariant 1's fix and its two scenarios),
which reverting the merge would not fix and would instead destroy good
work. This is a "please add the missing piece" bounce, not a "please
remove this" bounce.

By cleaner.
