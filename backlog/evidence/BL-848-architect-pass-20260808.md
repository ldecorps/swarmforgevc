# BL-848 architect pass — 2026-08-08 (post QA-bounce re-forward)

## Scope

Re-review after QA bounce D1 (`backlog/evidence/BL-848-qa-bounce-20260808.md`:
sweep-appended ledger entries wrote a blank `detected_at`). Received from
cleaner as `merge_and_process cleaner 4eaa77594b` (cleaner forwarded coder's
fix commit unchanged — clean pass, no cleanup needed).

Delta reviewed (`git diff --name-only 4eaa77594b~1 4eaa77594b`):
- `swarmforge/scripts/operator_runtime.bb`
- `swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`

## Checks run (complete inventory, not first-failure-stop)

1. **Prior-bounce-fixed check (workflow-detailed "check against `main`")** —
   read `backlog/evidence/BL-848-qa-bounce-20260808.md` from the `main` ref.
   D1's traced root cause (`git-log-main` format string never captured a
   commit date; `resolve-main-commits` never threaded one; `new-entry`
   received `detected-at=nil` with no fallback) is fixed: `git-log-main` now
   captures `%cd` under `--date=format:%Y-%m-%d`, threads it as
   `:detected-at`, and `resolve-main-commits` falls back to
   `(ms->ymd now)` — matching `hotfix_ledger_update.bb`'s own `today`
   convention (`java.time.LocalDate/now`, same system-default zone) — only
   for the defensive nil case. CONFIRMED FIXED, not just claimed: ran
   `bash swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
   — 13/13 PASS including the new
   `"the new entry's detected_at is a real YYYY-MM-DD date, never blank
   (BL-848 QA bounce)"` assertion.
2. **Correctness read of the fix** — format string changed from
   `%H%x1f%s%x1f%b%x1e` (3 fields) to `%H%x1f%s%x1f%cd%x1f%b%x1e` (4 fields);
   split-limit and field indices updated in lockstep (`parts 0/1/2/3` =
   sha/subject/date/body, split limit raised 3→4). No off-by-one. `now` is
   `hotfix-certification-sweep!`'s own parameter, already in scope at the
   `resolve-main-commits known-commits now` call site (operator_runtime.bb:1415).
   No new defect found.
3. **Dependency-rule gate (BL-259 hard gate)** — the parcel's two changed
   files are both under `swarmforge/scripts/`, not `extension/src/`;
   `node extension/out/tools/dependency-gate.js <files>` (run under Node 22
   via nvm — local default Node 20.20.2 does not satisfy dependency-cruiser's
   `^22||^24||>=26` requirement, same pre-existing environment gap QA already
   reported as orthogonal) confirms this directly: depcruise cannot even
   locate `.bb`/`.sh` paths inside its `extension/`-rooted scan — the gate is
   structurally scoped to extension TypeScript module boundaries and has no
   applicable ruleset for Babashka/shell files. A full-repo scan (no args)
   was also run for completeness: it reports 3 pre-existing `acyclic`
   violations among `telegram-front-desk-bot.ts` /
   `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`.
   `git diff --name-only a7d9c3ac 4eaa77594b -- '*.ts' | grep -i telegram`
   is empty — none of those files are in this parcel's lineage. Pre-existing
   drift, out of this ticket's scope, not a blocker here (surfacing only).
4. **Co-change coupling (BL-255)** — ran
   `co-change-report.js` on the changed files plus `hotfix_certification_lib.bb`.
   `operator_runtime.bb`'s reported "suspected coupling" set
   (`specs/pipeline/steps/index.js`, `operator_lib.bb`, various
   `test_operator_runtime_*.sh`) is the file's known baseline as a large
   shared daemon touched by nearly every operator-loop ticket — consistent
   with prior passes on this file, nothing newly introduced by this 2-file
   delta. No suspicious cross-boundary coupling (e.g. to webview/UI code).
5. **Two-layer boundary / host-IO-ownership / webview-storage / secrets** —
   N/A this delta: no `extension/` or webview file touched.
6. **Declared invariants (3, ticket YAML)** — this delta touches only
   `git-log-main` date capture and `resolve-main-commits` threading; it does
   NOT touch `decide-entry-state` (invariant 1 & 3, the certification gate)
   or the resurfacing-cooldown path (invariant 2). Those were already
   independently verified in this QA cycle: E2E procedure items 2-4 in
   `backlog/evidence/BL-848-qa-bounce-20260808.md` ("Other checks run this
   pass") all CONFIRMED, and this parcel's fix cannot have regressed them —
   confirmed by re-running `bl848_hotfix_certification_property_runner.bb`
   (PASS) and the full wiring-test suite (13/13 PASS, unchanged behaviour on
   the gate/cooldown checks 02/03).
7. **Scope discipline (BL-506)** — `git diff --name-only 4eaa77594b~1
   4eaa77594b` shows exactly the 2 files named above; no ticket-less files
   folded in.
8. **Full related suite run**:
   - `test_operator_runtime_hotfix_certification_sweep.sh` — 13/13 PASS
   - `hotfix_certification_lib_test_runner.bb` — PASS
   - `bl848_hotfix_certification_property_runner.bb` — PASS
   - `hotfix_ledger_update_test_runner.sh` — 14/14 PASS
9. Untracked `swarmforge/scripts/operator_path_lib.sh` in this worktree is
   pre-existing known debt (BL-796, per coder's prior status), not part of
   this parcel's diff — left untouched, not staged.

## Verdict

NONE — no architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener.
