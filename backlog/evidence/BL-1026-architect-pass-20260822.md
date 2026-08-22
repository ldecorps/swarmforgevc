# BL-1026 architect pass — 2026-08-22

**Parcel:** cleaner forward `61c2ec972b` (coder's real work commit
`5f053536e` — "BL-1026: land the expeditor's raised stage budget and gate
every place that states it"), merged into architect at `2d022e5b0`.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect found
in the parcel's own changed code.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary rules:** N/A. This parcel touches
  no `extension/` file at all (`swarmforge/scripts/expedite_lib.bb`,
  `expedite_cli.bb`, `expedite.sh`, two docs, one test runner, one property
  runner, one acceptance-step file, `specs/pipeline/steps/index.js`). It is
  maintained-fork `swarmforge/` tooling work, not VS Code extension/webview
  code — the tiles/webview/tmux-substrate boundary, secrets-in-host, and
  no-webview-storage rules do not apply to this diff.
- **Dependency-rule hard gate (BL-259):** run per-file
  (`node extension/out/tools/dependency-gate.js <each changed file>`).
  `specs/pipeline/steps/index.js` alone reproduces the known pre-existing
  BL-759 `telegram-front-desk-bot.js` acyclic cycle (confirmed unrelated: the
  *old*, pre-BL-1026 content of that same file, tested from a scratch copy,
  reproduces the identical unrelated cycle — the one-line `require` addition
  did not introduce it). Every other changed file passes clean individually.
  Attributed per the standing rule (parcel touches zero `extension/` files ⇒
  cannot have introduced a TS edge): CLEAN for this parcel.
- **Co-change coupling (BL-255):** ran
  `node extension/out/tools/co-change-report.js` over the parcel's changed
  files. Reported "suspected coupling" is exactly the five stated-budget
  mirror sites plus their own test runner and `index.js` — precisely the set
  this ticket exists to hold together by design. No unexpected coupling to
  code outside the ticket's declared scope.
- **Declared invariant (1)** — "Raising the default never disarms the
  valve... boundary is >= not >": encoded as P1/P2/P3 in
  `bl1026_stage_budget_property_runner.bb`, plus two new non-vacuous unit
  cases (test 15) in `expedite_lib_test_runner.bb`. Independently verified
  non-vacuous by hand, not by trusting the commit message: changed
  `(>= elapsed budget)` to `(> elapsed budget)` in a scratch copy of
  `expedite_lib.bb`, re-ran the property runner live — **603 failures**
  (P1/P2/P3 all correctly red, including the boundary-exact case) — then
  restored the file and re-confirmed `ALL PROPERTIES HOLD` / `ALL PASS` at
  baseline.
- **Declared invariant (2)** — "Every place... states the same value... and
  the check fails when one is changed": encoded as P4/P5/P6, plus the real
  four-site gate run at the end of `expedite_lib_test_runner.bb`.
  Independently verified non-vacuous: stubbed `budget-mirror-findings` to
  always return `[]` in a scratch copy, re-ran both suites live — unit
  runner **6 FAILUREs** (every mirror-gate assertion), property runner
  **745 failures** (P4/P5/P6) — then restored and re-confirmed clean.
- **Mirror sites, checked by hand against the regex:** all four prose sites
  (`expedite_cli.bb`, `expedite.sh`, the manual, the how-to) now state `90`
  consistently in both spellings (bare "(default 90 min)" and the manual's
  paired "`5400000` (90 min)", where 5400000 = 90×60×1000). Grepped each
  file for `min)` to confirm no second, unrelated "(N min)" phrase exists
  that the regex could misparse.
- **Verification re-run live** (not trusted from the commit message):
  - `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → `ALL PASS`.
  - `bb swarmforge/scripts/test/bl1026_stage_budget_property_runner.bb` →
    `400 runs`, all coverage floors cleared, `ALL PROPERTIES HOLD`.
  - `node specs/pipeline/cli.js specs/features/BL-1026-the-expeditor-states-its-stage-budget-once.feature`
    → **6/6** (all three scenarios, including the outline's four rows).

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The pure surface this parcel added (`budget-statements`,
`budget-mirror-findings`, `format-budget-mirror-findings`) is already fully
covered by the coder's declared-invariant property tests reviewed above
(P4–P6) plus the pure/impure split itself (`read-budget-mirrors` is the one
clearly-marked impure function; everything else is pure and exercised).
Nothing further to add.

## What was NOT re-litigated

- `stage-timeout-verdict`'s pre-existing shape (clock injection, explicit-
  vs-default override): unchanged by this parcel except the constant value
  and comment; already covered by pre-existing test 15's original assertion
  and this parcel's own new boundary cases.
- The out-of-scope "progress-aware budget" question: the ticket's own notes
  correctly assign this to the specifier with an explicit trigger; not this
  parcel's job and not reopened here.

— By architect.
