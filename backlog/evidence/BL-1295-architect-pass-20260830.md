# BL-1295 architect pass — 2026-08-30

Reviewed commit: 6d0d34fce3 (merge cleaner BL-1295 into architect, coder work
riding under launcher commit 2e519c4a8 per evidence
backlog/evidence/BL-1295-coder-20260830.md).

## Dependency gate (BL-259, hard gate)

`node out/tools/dependency-gate.js test/bl1295RevertAttributionInvariants.property.test.js
../specs/pipeline/steps/bl1295RevertSubjectAttributionSteps.js ../specs/pipeline/steps/index.js`
reports one violation:

```
../specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js -> ../specs/pipeline/steps/index.js violates "acyclic"
```

Pre-existing, not introduced by this parcel — grepped and confirmed already
tracked: backlog/evidence/BL-726-architect-pass-cleaner-d01f755315-20260827.md,
BL-1213-cleaner-pass-20260828.md, BL-1189-cleaner-removes-resurrected-bounce-content-20260828.md,
BL-1237-reference-freshness-guard-is-direction-aware-bounce-20260829.md. No
new forbidden edge from this parcel's own files.

## Co-change (BL-255, informational)

`co-change-report.js` on the three parcel-owned files: all reported
co-changes are frequency 1, below the default threshold (3). No suspected
coupling.

## Architecture

Pure bb-script fix (`task_scope_gate_lib.bb`) plus test/spec infra
(`extension/test/*.property.test.js`, `specs/pipeline/steps/*`). No
webview/extension-host boundary, no VS Code API surface, no browser storage,
no secrets, no SwarmForge source modification — out of scope for every
architecture rule this role enforces.

## Invariants Review (Article, BL-633/654)

Ticket declares two invariants. Both are encoded as non-vacuous property
tests in `extension/test/bl1295RevertAttributionInvariants.property.test.js`:

- Invariant 1 (revert never attributed to the quoted ticket): pure-predicate
  property over `subject-names-task?`, generator explicitly derives revert
  subjects FROM the plain ones (collision-candidate by construction), also
  asserts the word "revert" alone doesn't exempt a hand-written commit.
- Invariant 2 (verdict unchanged by a benign revert): builds two real git
  repos (with/without the revert) and diffs the real gate's verdict; also
  confirms scenario 02's teeth (genuine foreign commit still refused, path
  named).

Ran `npx vitest run --config vitest.properties.config.mjs
bl1295RevertAttributionInvariants` — 3/3 pass.
Ran `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` — ALL
PASS.

## Acceptance wiring (required_wiring)

`specs/pipeline/steps/index.js` registers `bl1295RevertSubjectAttributionSteps`
(required_wiring entry satisfied). Ran the real APS pipeline
(`specs/pipeline/runnerAdapter.js`) against
`specs/features/BL-1295-revert-subject-does-not-blame-the-reverted-ticket.feature`
end to end through the real step handlers: all 3 scenarios pass (`# pass 3,
# fail 0`).

## Property-testing pass (undeclared properties)

No other pure module was touched by this parcel beyond what the declared
invariants above already cover; no additional property test needed.

## Verdict

Architecturally compliant, invariants correctly and non-vacuously encoded,
wiring live-verified. No correctness defect spotted. Forwarding to hardener.
