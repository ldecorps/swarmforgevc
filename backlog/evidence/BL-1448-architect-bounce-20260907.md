# BL-1448 — architect review pass, 2026-09-07 (bounce)

Reviewed commit: 353b5fce1f (cleaner review pass evidence).

## Checklist run

- Two-layer boundary / host-owns-I/O / no webview storage / secrets /
  integrate-not-fork / dependency direction: N/A — the parcel touches no
  `extension/src` or `extension/media` file (only shell scripts and one
  `specs/pipeline/steps/*.js` handler).
- `dependency-gate.js`: N/A for the same reason (its scope is
  `extension/src` + `extension/media`; nothing in this parcel's diff falls
  inside it).
- `co-change-report.js` against the three changed files: no alarming
  coupling. The top pair (`test_property_suite_drift_guard.sh` <->
  `check_property_suite_drift.sh`, 15 co-changes) and the `docs/how-to`,
  `specs/pipeline/steps/index.js` entries are the expected guard/test/doc
  triangle, not new coupling this parcel introduced.
- Invariants (both declared): confirmed structurally. Every
  allowlist-dependent case (11, 12, 13, 13b, 13c, 13d, 21) now routes
  through `install_guard_copy_with_allowlist`'s `GUARD_COPY_*`, never
  `"$GUARD"` — invariant 1. The fixture's allowlisted/non-allowlisted names
  stay disjoint per case and the live `property_suite_standing_allowlist.tsv`
  is only ever read (for its header), never written — invariant 2. Both
  encoded by the real suite run, not vacuous.
- Property testing: no touched pure module in this parcel's diff (shell
  fixture helper + one acceptance step handler) — no new property test
  warranted, none added, correctly so.
- `specs/pipeline/steps/index.js`: the new handler is picked up by
  suffix-discovery (`*Steps.js`), matching `required_wiring`'s anchor claim
  — no manual registration line needed or missing.

## D1 — misplaced evidence artifact (cleaner's own output)

`git show 353b5fce1f --stat` (the commit under review) writes ONE file:
`extension/backlog/evidence/BL-1448-cleaner-20260907.md`. The repo's
evidence convention (Article 4.4, every other evidence file in this diff
and in `backlog/evidence/`) is `backlog/evidence/<ticket>-<role>-<date>.md`
at the repo root, not nested under `extension/`. `extension/backlog/`
is not a real location anything else reads.

Cause: `extension/src/tools/record-review-evidence.ts`'s `main()` calls
`recordReviewEvidence({ ...args, root: process.cwd() })` with no check that
`process.cwd()` is the repo root — it silently writes wherever it is
invoked from. The cleaner evidently ran the tool from inside `extension/`
(this project's own convention: "npm runs from `extension/`, never the
repo root"), so it wrote `extension/backlog/evidence/...` instead of
`backlog/evidence/...`.

This is a correctness defect visible in the parcel I am holding — a stray,
wrongly-placed tracked artifact (Guardrails: "no unrelated
local/generated artifacts committed") — not an architecture-boundary
violation, so it is a send-back per the architect prompt's
correctness-defect rule rather than a `rule_proposal`.

Grepped first: `grep -rl "extension/backlog" backlog/` and
`grep -rl "record-review-evidence" backlog/{paused,active,hold}` are both
empty — this specific defect is not already ticketed.

## Remediation

- Blamed role: cleaner (the defect is cleaner's own pass-evidence commit,
  not the coder's implementation).
- Move `extension/backlog/evidence/BL-1448-cleaner-20260907.md` to
  `backlog/evidence/BL-1448-cleaner-20260907.md` (run the recorder from the
  repo root, or `git mv` + amend the stray commit) and remove the empty
  `extension/backlog/` tree.
- Not required for this bounce, but worth a `rule_proposal` separately:
  `record-review-evidence.js`'s `main()` should resolve the repo root
  itself (e.g. from its own compiled path, `out/tools/..`) rather than
  trusting `process.cwd()` blindly, so a future run from `extension/`
  cannot silently misplace the file again.

Rest of the parcel (the actual BL-1448 deliverable: the guard-copy helper,
the seven converted cases, the new acceptance handler) reviewed clean —
no architecture or invariant violation.
