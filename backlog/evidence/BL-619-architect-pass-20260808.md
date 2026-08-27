# BL-619 architect pass — 2026-08-08

Reviewed commit: `5a63eded52f2c7fb1825d5a7741f6ef0cef06484` ("BL-619: morning
briefing leads with a token-burn exhaustion warning"), received via cleaner's
`303f6636f0` (evidence-only commit, no defects), merged into this worktree.

## Checklist (Article 4.4 — run-or-blocked, never assumed-clean)

- **Two-layer boundary (tiles/webview vs tmux)** — N/A, no webview/tmux code
  touched.
- **Extension host owns I/O, webview presentation-only** — RUN, clean. This
  slice is entirely extension-host CLI tooling
  (`extension/src/tools/usage-anchor.ts`, `token-burn-section.ts`) plus pure
  metrics modules (`burnProjection.ts`, `burnSectionText.ts`,
  `usageAnchorStore.ts`); no webview file touched.
- **No webview storage** — N/A, same reason.
- **Secrets stay in extension-host env only** — RUN, clean. No secrets
  touched. The one new piece of persisted state
  (`.swarmforge/operator/usage-anchors.jsonl`) is a human-transcribed
  percentage, not a credential, and lives under the already-gitignored
  `.swarmforge/` tree — confirmed via
  `git check-ignore -v .swarmforge/operator/usage-anchors.jsonl`.
- **Integrate-not-fork** — N/A/consistent: `swarmforge/scripts/` changes
  (`handoffd.bb`, `briefing_email_lib.bb`) are this project's own maintained
  fork (local-engineering.prompt Architecture Rule 2), not SwarmForge's
  external source.
- **High-level policy independent of IO/UI/framework, adapters depend
  inward** — RUN, clean. `burnProjection.ts`/`burnSectionText.ts` are pure
  (injected clock, no fs/env/network); `usageAnchorStore.ts` is the one
  narrow impure read/write layer; `token-burn-section.ts`/`usage-anchor.ts`
  are thin CLI `main()` wrappers over those exported helpers (verified by
  reading each file — `main()` in both is a straight-line compose-and-print,
  no business logic inline). `handoffd.bb`'s `token-burn-briefing-section`
  shells to the compiled CLI using the exact same pattern as every sibling
  `*-briefing-line` adapter in that file, degrading to `nil` on any failure.
  `briefing_email_lib.bb`'s new `prepend-content-block` mirrors the existing
  `append-content-block` exactly, and the new `:token-burn-section` adapter
  slot is applied last (after subject derivation) precisely so the
  warning's own leading text can never leak into the subject headline —
  traced this ordering by hand against `build-briefing-subject`'s
  first-non-empty-line logic; confirmed it reads pre-prepend `content`, so
  the coordinator-authored body still drives the headline.
- **Dependency-gate hard gate (BL-259)** — RUN, clean:
  `node extension/out/tools/dependency-gate.js src/metrics/burnProjection.ts
  src/metrics/burnSectionText.ts src/metrics/usageAnchorStore.ts
  src/tools/token-burn-section.ts src/tools/usage-anchor.ts` (run from
  `extension/`, under Node 22 — the default `nvm` shell here is 20.20.2,
  below the tool's `^22||^24||>=26` floor) → `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change coupling** — RUN, clean.
  `node extension/out/tools/co-change-report.js` against all 7 changed
  production files (the 5 new TS files plus `briefing_email_lib.bb` and
  `handoffd.bb`). Every new TS file's top co-changers are its own BL-619
  siblings (each other, their own unit tests, the Gherkin step file, the two
  `.bb` files) — a single shared-history feature, one co-change each, no
  cross-domain surprise. `briefing_email_lib.bb`/`handoffd.bb` co-change
  broadly (expected — both are established briefing-section hub files); the
  top hits are the pre-existing `briefing_email_test_runner.bb`/
  `specs/pipeline/steps/index.js`/`operator_lib.bb` triad every other
  briefing-line ticket already touches, not anything new.
- **Invariants review (BL-633/BL-654)** — N/A. The ticket YAML declares no
  `invariants:` field, so this review has no obligation to discharge.
- **Property testing pass (undeclared properties on touched pure
  modules)** — RUN, no gap found, nothing added. Assessed
  `burnProjection.ts`'s two property-shaped candidates:
  - `deriveBurnRateFromAnchors`'s order-independence (does the two-anchor
    rate depend on input order?) — already directly covered by an explicit
    example test (`test/burnProjection.test.js`, "order-independent - the
    latest pair is picked regardless of input order").
  - `nextWeeklyResetMs`/`currentWeeklyWindowStartMs`'s date arithmetic
    (month/year rollover, DST) — the classic property-test target for
    calendar code, but the implementation uses `Date#setDate` beyond the
    month's day count rather than manual day/month math, which is JS's own
    built-in normalization path; there is no hand-rolled rollover logic for
    a property to usefully stress. Existing unit tests already hit the
    same-day-but-time-passed rollover case.
  - `decideProjection` is a single-line `<` comparison, already
    table-tested across 4 boundary rows plus a non-positive-rate edge case.
  Given the above, this parcel's touched pure surface is adequately covered
  by its existing 23 example-based unit tests; manufacturing a property
  test here would not exercise anything the examples don't already prove.
- **Correctness read** — RUN, clean. Traced the subject/prepend ordering
  (above), the malformed-config precedence in `composeBurnSection` (malformed
  beats no-anchor beats the real decision, matching the ticket's own
  precedence list), and the CLI failure path (`token-burn-briefing-section`
  catches and returns `nil`; `send-unsent-briefings!` already treats every
  optional adapter as absent-safe). No defect found.

## Tests run

- `npx tsc --noEmit -p extension` — clean.
- `npx vitest run test/burnProjection.test.js test/burnSectionText.test.js
  test/tokenBurnSectionCli.test.js test/usageAnchorCli.test.js
  test/usageAnchorStore.test.js` — 5 files, 48 tests, all passed.
- `node specs/pipeline/cli.js
  specs/features/BL-619-briefing-burn-rate-exhaustion-warning.feature` — all
  9 scenarios / 14 cases pass via real fixtures and subprocesses (no mocks).
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS.
- `node extension/out/tools/dependency-gate.js …` — PASSED, no forbidden
  edges.

## Verdict

NONE — no defects found. Forwarding to hardener.
