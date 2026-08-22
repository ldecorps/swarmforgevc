# BL-848 QA bounce (round 2) — 2026-08-08

## Scope

This is QA's re-verification of the bounce-fix re-pass for D1 from
`backlog/evidence/BL-848-qa-bounce-20260808.md` (blank `detected_at` on
sweep-appended ledger entries). Received from documenter as
`merge_and_process documenter e060695ba8`.

D1 itself is CONFIRMED FIXED — see "Other checks run this pass" below. This
bounce is for a second, independent defect found while verifying the
lineage of that fix.

## D1 — cleaner's and documenter's re-verification passes left no committed
trace; indistinguishable from a skipped stage (Article 4.4 / BL-536 pattern)

**Failing command** (provenance inspection, not a test — this is a process
gate, not a functional one):

```sh
cat /Users/ldecorps/projects/swarmforgevc/.worktrees/coder/.swarmforge/handoffs/sent/50_20260807T230738Z_000101_from_coder_to_cleaner.handoff
cat /Users/ldecorps/projects/swarmforgevc/.worktrees/cleaner/.swarmforge/handoffs/sent/00_20260807T233321Z_000042_from_cleaner_to_architect.handoff
cd /Users/ldecorps/projects/swarmforgevc/.worktrees/documenter && git log --oneline -3
cat /Users/ldecorps/projects/swarmforgevc/.worktrees/documenter/.swarmforge/handoffs/sent/00_20260807T235639Z_000036_from_documenter_to_QA.handoff
```

**Commit hash checked out and tested**: `e060695ba825dbe557771dadeff1cf79dcd3d349`
(this QA parcel's tip, `merge_and_process documenter e060695ba8`, BL-848
bounce-fix lineage rooted at coder's fix `4eaa77594b`).

**First error excerpt** (actual handoff/log output from the commands above):

```
# coder -> cleaner handoff:
commit: 4eaa77594b
merge_and_process coder 4eaa77594b

# cleaner -> architect handoff (same commit hash, unchanged):
commit: 4eaa77594b
merge_and_process cleaner 4eaa77594b

# documenter worktree tip — authored "By hardener.", not documenter:
e060695b BL-848: re-verify post-QA-bounce fix, close Gherkin mutation gap   <- "By hardener."
704d6607 Merge commit '1e62fbdc3d' into swarmforge-hardender
1e62fbdc BL-848: architect pass — clean, no defects, forwarding to hardener

# documenter -> QA handoff (hardener's own commit hash, unchanged):
commit: e060695ba8
merge_and_process documenter e060695ba8
```

**Failure class**: `behavior` — same honest classification this ticket's
own bounce-routing table (QA role prompt) already uses for a missing stage
pass ("a stage's pass is MISSING ENTIRELY... `behavior` was the honest
class for BL-575's missing documenter pass"). Not compile/unit/integration/
acceptance: nothing broke functionally: D1 is genuinely fixed and all
suites are green (see below). The defect is that TWO stages of the pipeline
left zero durable evidence of having reviewed this delta.

**Expected vs observed**: Expected, per Article 4.4 ("A clean pass leaves a
commit, or it is indistinguishable from a skipped stage... A review stage
that forwards exactly the commit it received leaves no trace in the
parcel's lineage... BL-536 (2026-08-04) burned a full QA bounce +
re-entry cycle re-running architect and hardener passes that had in fact
run but committed nothing"): both cleaner and documenter commit an
explicit-NONE (or defect) evidence entry to their own branch for this
bounce-fix delta, even when the verdict is "nothing to change." Observed:
cleaner forwarded `4eaa77594b` — the exact commit it received from coder,
byte-for-byte, with zero new commit on `swarmforge-cleaner` — to architect.
Documenter forwarded `e060695ba8` — the exact commit it received from
hardener, authored "By hardener.", with zero new commit on
`swarmforge-documenter` — to QA. Neither branch carries a
`backlog/evidence/BL-848-cleaner-pass-*.md` or
`backlog/evidence/BL-848-documenter-pass-*.md` for this second (bounce-fix)
round — only the first-pass cleaner commit (`3d5c1e7b`, from before the QA
bounce) exists. Per this ticket's own routing table this is indistinguishable
from cleaner and documenter never having reviewed the fix at all, mailbox
timestamps notwithstanding (mailbox/session logs are not the durable
artifact the rule requires).

**Root cause**: neither stage produced a commit — not even an
explicit-NONE evidence file — when it found nothing to change on the
narrow, single-commit bounce-fix delta. `merge_and_process` was executed
(the merge itself is real, confirmed by `git log`'s merge commits at each
downstream hop: `cf343317` architect merging cleaner's forward, `704d6607`
hardener merging architect's forward), but the review verdict itself was
never written down.

**Blamed role**: **cleaner** (earliest of the two — Article 4.4 "one
bounce, many owners... the single `git_handoff` goes to the EARLIEST blamed
role") for its own missing pass-commit on this round, AND **documenter**
for its own missing pass-commit on this round. Both must clear their own
item before the parcel forwards past them again.

**Remediation pointer**: `cleaner` — review the bounce-fix delta
(`4eaa77594b`, 2 files: `swarmforge/scripts/operator_runtime.bb`,
`swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`)
and commit `backlog/evidence/BL-848-cleaner-pass-round2-<date>.md` stating
its verdict (even if NONE), then forward as usual. `documenter` — same,
for the same delta plus anything hardener's re-pass added
(`e060695ba8`: hardener-pass evidence file update + Gherkin mutation
manifest on the feature file); commit
`backlog/evidence/BL-848-documenter-pass-round2-<date>.md` confirming no
doc-facing surface changed (or updating docs if it did) before forwarding
to QA again.

## Other checks run this pass (complete inventory, not first-failure-stop)

- **D1 from round 1 (blank `detected_at`) — CONFIRMED FIXED.** Re-ran the
  exact repro from `backlog/evidence/BL-848-qa-bounce-20260808.md` against
  this commit: `detected_at: 2026-08-08` (a real date), not blank.
- `bb swarmforge/scripts/test/hotfix_certification_lib_test_runner.bb` — PASS
- `bb swarmforge/scripts/test/bl848_hotfix_certification_property_runner.bb` — PASS
- `bash swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
  — 13/13 PASS, including the coder's new non-vacuous regression check for
  the round-1 bounce.
- `bash swarmforge/scripts/test/hotfix_ledger_update_test_runner.sh` — 20/20 PASS.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature`
  — PASS (10/10 scenarios).
- `required_wiring` items re-confirmed: sweep called from `tick!`'s per-tick
  bundle (`operator_runtime.bb:2007`), gated by `timer-due?`
  (`operator_runtime.bb:1410`); `backlog/hotfix-ledger.yaml` still seeded
  with BL-849's commit (`f9cf29c29b`) and the genuine unaccounted finding
  (`f175bc56d1`); `docs/how-to/BL-848-certify-an-operator-hotfix.md` still
  linked from `docs/index.md`.
- Gherkin mutation manifest (BL-113, closed by hardener's re-pass): present
  and well-formed in the feature file (`mutation-stamp` + embedded manifest,
  6/6 mutants recorded killed for both Scenario Outlines).
- Scope discipline (BL-506): `git diff --name-only ca33c97b e060695ba8`
  shows only ticket-relevant files (the active ticket YAML, two evidence
  files, the feature file, the two implementation/test files). The two
  pre-existing uncommitted stray items in this worktree
  (`backlog/active/BL-773-...yaml` bounce_history merge,
  `swarmforge/scripts/operator_path_lib.sh`, known BL-796 debt) are
  confirmed NOT part of this commit range — left untouched, not staged.
- Orphaned test/mutation processes: none before or after this pass
  (`pgrep -fl 'node --test|stryker'` empty both times).
