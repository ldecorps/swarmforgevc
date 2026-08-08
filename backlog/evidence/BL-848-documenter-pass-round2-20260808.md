# BL-848 documenter re-pass (round 2) — 2026-08-08

## Scope

QA bounce round 2 (`backlog/evidence/BL-848-qa-bounce-round2-20260808.md`, D1)
blamed documenter (alongside cleaner) for forwarding the round-1 bounce-fix
lineage (`e060695ba8`, received unchanged from hardener) to QA with zero
committed trace of a documenter review — indistinguishable from the pass
never having run (Article 4.4 / BL-536 pattern). This is that committed
re-pass, covering the full bounce-fix delta:

- `4eaa77594b` (coder) — `git-log-main` now captures the committer date so
  sweep-appended ledger entries never get a blank `detected_at`. Touches
  `swarmforge/scripts/operator_runtime.bb` and
  `swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`
  only.
- `e060695ba8` (hardener round 1) — re-verification evidence file plus the
  Gherkin mutation manifest embedded in
  `specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature`
  (6/6 mutants killed).
- `33b00a72f5` (hardener round 2) — a second evidence file only; no
  production/test/feature diff versus round 1 (confirmed in its own commit
  message).

## Review

Checked every file this delta touches for doc-facing surface:

- `operator_runtime.bb` change is a pure internal correctness fix (how a
  detection date is captured/derived) — no new command, flag, ledger field,
  env var, or user-visible behavior. `detected_at` was already an
  undocumented internal ledger field before this fix; it stays undocumented
  now for the same reason (implementation detail of the sweep, not a
  contract callers rely on). Confirmed: `grep -rn detected_at docs/` returns
  nothing, in either direction — the fix neither breaks nor requires a doc
  reference.
- The two test-file diffs (wiring smoke assertion, evidence files) are not
  user-facing.
- The Gherkin mutation manifest addition is a test-harness artifact
  (`mutation-stamp` + embedded manifest), not scenario/behavior text — the
  feature file's documented scenarios are unchanged from what round 1
  already reviewed.
- Re-checked `docs/how-to/BL-848-certify-an-operator-hotfix.md` (my round-1
  doc, commit `6e71ad8a`) end to end against this delta: nothing in it
  claims a `detected_at` format or behavior that this fix contradicts. Still
  linked from `docs/index.md`. No edit needed.
- No diagram (architecture or swarm-workflow) depicts ledger internals or
  the sweep's date-capture logic — neither is affected.

## Verdict

NONE — no documentation change required for this bounce-fix delta.
Forwarding to QA unchanged in doc content, with this evidence committed so
the pass leaves a trace per Article 4.4.

By documenter.
