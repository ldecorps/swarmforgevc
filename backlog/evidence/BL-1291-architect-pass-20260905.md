# BL-1291 — architect pass, 2026-09-05

Ticket: BL-1291-a-live-repo-read-is-pinned-or-justified
Role: architect
Commit reviewed: f4294ee16a (coder — routed directly per `stage_skip_reasons`
in the ticket YAML: cleaner/hardener/documenter all skipped with recorded
justification, `required_stages: [coder, architect, qa]`)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1291LiveRepoReadPinnedSteps.js`) and full-repo:
  `Dependency-rule gate PASSED: no forbidden edges.` in both. Change is
  test-only (two `.test.js` files) plus one step handler using
  `node:assert`, `node:path`, `node:fs` and the extension's own guard
  helper module — no webview, no VS Code API, no secrets, no browser
  storage.
- **Co-change report**: only each file's own pre-existing feature-family
  coupling (BL-1243's own siblings, BL-1193's own siblings) — nothing new
  or suspicious.

## Sole invariant, verified independently

"A test's cost and verdict never depend on live repository content it did
not establish; where a test must read live state, the reason it cannot
use a pinned fixture is recorded rather than left implicit." Ran the real
guard myself:

```
cd extension && npx vitest run --config vitest.config.mjs test/liveRepoDerivationGuard.test.js
→ 19/19 pass, including "the real extension/test tree has no unjustified
  live-repository derivation"
```

This is the standing red itself, now green — confirmed directly, not
inferred from the coder's evidence.

## Per-file review

- **`bl1243PaneActivitySignal.test.js`**: replaced `fs.readdirSync(FIXTURES)`
  (four call sites) with an explicit `FIXTURE_FILES` array. Verified the
  pinned list is a complete, accurate match of the live fixture directory
  (`ls specs/features/fixtures/BL-970/` — all 7 files present, none
  dropped, none invented) — a wrong or stale pin here would silently
  narrow test coverage, which I checked is not the case.
- **`deprecateRetiredReferents.test.js`**: recorded a `BL-1038-EXEMPT:`
  comment with a substantive reason on the one test that hands the live
  repo root to `loadRetiredTokens`. Verified against the guard's own
  contract (`liveRepoDerivationGuard.test.js`'s own tests distinguish a
  reasoned exemption, which is honored, from a bare `BL-1038-EXEMPT:`
  marker with no reason, which is NOT honored and still fails) — the
  recorded reason is well past that bar.
- **`docsStructureRealTree.test.js`**: left untouched, with the coder's
  reasoning recorded rather than silently doing nothing. Verified this
  claim myself: the file's `REPO_ROOT` binding is `execFileSync('git',
  ['-C', __dirname, 'rev-parse', '--show-toplevel'], ...)`, not the
  `path.join(__dirname, '..', '..')` shape the guard's
  `LIVE_ROOT_BINDING_RE` pattern matches — an earlier, unrelated fix
  (2026-09-02) already moved this file outside the guard's detection
  pattern before this ticket touched it. Not a defect in this parcel: a
  file the guard genuinely does not flag needs no fix, and the coder
  verified this with a live run rather than assuming.

Re-ran the three target files' own test suites for regression: 22/22 pass
(`bl1243PaneActivitySignal.test.js` 8, `docsStructureRealTree.test.js` 5,
`deprecateRetiredReferents.test.js` 9).

## Acceptance wiring

Feature declares 3 scenarios / 5 scenario runs (Outline with 3 examples +
2 plain scenarios). Independently drove
`bl1291LiveRepoReadPinnedSteps.js::registerSteps` against all 5 with my
own harness — all passed, including scenario 02's real scan of the entire
`extension/test` tree returning zero violations (the actual fix, not a
synthetic fixture). `registerSteps` export present per the ticket's
`required_wiring` anchor (BL-1371).

## On the stage-skip routing

The ticket's own `stage_skip_reasons` (cleaner: no shared duplication to
fold; hardender: no production module changes, test-only; documenter: no
living doc beyond `engineering.prompt`, unchanged) are consistent with
what I found in the diff — two test files and one step handler, no
production code. Nothing here suggested cleaner/hardener/documenter
concerns were actually needed despite the skip.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to QA per this
ticket's `required_stages: [coder, architect, qa]`.
