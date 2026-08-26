# BL-556 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner tip `e970666a3a` (merged into architect as `fa7799a8d`).
Lineage: `ad362a9d18` (coder, evaluate pure ingest) + `e970666a3a`
(cleaner, split `run-evaluate` helpers + shared artifact-id refuse seam).
No prior bounce on this ticket.

## Scope

Slice 2 Model Steward `evaluate`: pure ingest of captured recruiter scorecard
(+ optional bake-off) JSON into capability registry, role-matrix evidence
pointer, and evidence-backed certification report with regression-diff and
optional `--decertify-on-regression`. New
`model_steward_evaluate_lib.bb`, CLI `evaluate` dispatch, store
`evidence-dir` / `read-evidence-json!`, APS steps + unit/property cover.

## Architecture

- Integrate-not-fork: steward scripts under maintained `swarmforge/scripts/`.
- No `extension/src/**` production surface; no webview/storage/secrets.
- Pure ingest boundary held: evaluate lib has no subprocess/network; CLI
  `run-evaluate` only reads JSON via store seam and writes registry/report.
  Policy (`apply-evaluate`, `regression-diff`, id refuse) stays in bb lib;
  CLI is thin load/print/dispatch after cleaner split (CC budget).

## Required hard gate: dependency-gate.js

Parcel is primarily babashka + APS. Extension property file scan: **PASSED**.
Full-repo scan: standing BL-759 acyclic cycle only
(`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).
Not re-reported (BL-759 / BL-1063).

## Co-change

`model_steward_cli.bb` ↔ store/lib/Slice-1 partners — expected hub coupling;
informational, non-actionable for this additive evaluate path.

## Invariants

Ticket declares **no** `invariants:` block — declared-invariant check is a
no-op (BL-654). Undeclared property cover (below) still present.

## Property-testing pass (undeclared)

`bl556EvaluateIngest.property.test.js`: missing `scorecard_id` refuses;
`regression-diff` only pass→fail. Green (2 tests).

Non-vacuity (empirical): stubbed `require-artifact-id` to invent
`invented-scorecard_id` → refuse property RED; restored; green; `git diff`
clean.

## Correctness read-through

- Capture contract requires `:scorecard_id` / `:bakeoff_run_id` — never
  fabricates recruiter-scorecard:… pointers.
- Capability dimensions reuse Slice-1 `cost_latency` naming (combined).
- Unit runner `bl556_evaluate_ingest_test_runner.bb`: **ALL PASS**.

## Inventory

**NONE**

## Verdict

Pass to hardender. (Sibling BL-682 in the same tip is forwarded as its own
`git_handoff` per Article 2.6 — see `BL-682-architect-pass-20260824.md`.)
