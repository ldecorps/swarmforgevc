# BL-624 architect pass 2 (post-bounce remediation) — 2026-08-15

## Scope

Received from cleaner as `git_handoff` (task
`BL-624-onboarding-facilitator-survey-to-gate`) pointing at `5ce7cc7150`,
merged as `62e0a468e`. This is the remediation for my own prior bounce
(`backlog/evidence/BL-624-onboarder-survey-untrusted-agent-bounce-20260815.md`,
bounce_count: 1 in the ticket YAML).

Commit in scope: `3a46805ae` ("BL-624: never blanket-skip permissions
surveying an untrusted target clone", by coder). Files touched:
`extension/src/tools/contractPhaseRealAdapters.ts`,
`extension/test/contractPhaseRealAdapters.test.js`.

## Bounced defect — verified fixed

Original defect: `defaultSurveyRepo` shelled to `claude
--dangerously-skip-permissions` with `cwd` set to the real onboarding
target's clone — a clone that later receives a real push with this box's
own git credentials. The established `--dangerously-skip-permissions`
precedent (`claudeCliExecutor.ts`, `pipelineReviewOracle.ts`) is safe only
because their `cwd` is always a disposable scratch fixture; that condition
never held here.

- Read the fixed file in full: `--dangerously-skip-permissions` is gone;
  `surveyCliArgs()` now returns `--allowedTools Read,Glob,Grep` — a pure,
  exported function, matching the ticket's own "CLI invocations go through
  injected seams" gate.
- Diffed the pre-fix (`62c521284:...contractPhaseRealAdapters.ts`) and
  post-fix CLI-args lines directly: confirmed the flag swap is real, not
  cosmetic.
- Non-vacuity verified independently, not taken on the coder's word: ran
  the new tests against the pre-fix source (`git show
  62c521284:extension/src/tools/contractPhaseRealAdapters.ts`) by
  inspection — the pre-fix array contains
  `--dangerously-skip-permissions` and no `--allowedTools`, so both new
  assertions (`args.includes('--dangerously-skip-permissions') === false`
  and `--allowedTools` present with exactly `Read,Glob,Grep`) fail against
  it and pass against the fix.
- Swept the codebase for the same defect class
  (`grep -rn "dangerously-skip-permissions" extension/src/`): the only
  other two sites (`claudeCliExecutor.ts`, `pipelineReviewOracle.ts`) are
  pre-existing benchmark code, out of this parcel's scope, and both
  independently confirmed via their own comments + code to run against a
  disposable `materializeTaskFixture` scratch copy, never the real
  onboarding target clone. No other site shares this defect.

## Correctness — re-run independently

- `npx vitest run --config vitest.config.mjs test/contractPhaseRealAdapters.test.js`:
  7/7 green (the 2 new tests plus the 5 pre-existing).
- `node specs/pipeline/cli.js specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature`:
  7/7 scenarios pass.

## Invariants review (BL-654)

Two declared invariants on this ticket; this parcel's diff (survey CLI
args only) touches neither directly, so this is a re-confirmation, not a
first pass:

1. *"Every durable write is idempotent under redelivery of the same
   Telegram update."* — `onboarderContractPhaseRedeliveryIdempotent.property.test.js`
   exists, non-trivial (3.9s, drives real orchestration), re-run green.
2. *"Nothing is pushed to the target repo before the human has agreed the
   contract."* — `contractPhasePushGatedOnAgreement.property.test.js`
   exists, re-run green. Structurally re-confirmed in
   `contractPhaseRelay.ts`: `runNegotiateApprove` calls `adapters.checkGate`
   (line 184) before `adapters.commitAndPush` (line 192) is ever reached,
   and `commitAndPush` is called from nowhere else in the file (per that
   function's own invariant-2 comment).

No-second-negotiation-engine grep check (ticket's own supporting gate):
`negotiate-onboarding-contract.ts`'s `runObject`/`runApprove` remain the
ONE writer, reached only through `negotiationOutcomeAdapters.ts` from both
`relay-onboarding-negotiation-telegram.ts` and this parcel's
`contractPhaseRealAdapters.ts` — confirmed by grep, no second writer
introduced.

## Dependency-rule gate (BL-259, hard gate)

`node out/tools/dependency-gate.js src/tools/contractPhaseRealAdapters.ts
test/contractPhaseRealAdapters.test.js` (run from `extension/`): **PASSED,
no forbidden edges.**

## Co-change coupling (BL-255)

`node out/tools/co-change-report.js src/tools/contractPhaseRealAdapters.ts
test/contractPhaseRealAdapters.test.js`: all reported co-changes are at
frequency 1–2, below the default threshold (3) — no coupling flagged.

## Property testing pass (architect-owned, engineering.prompt)

The two declared invariants already cover the only property-shaped surface
this parcel touches. `surveyCliArgs()` is a pure function but its only
property of interest ("never includes the dangerous flag, always scopes to
read-only tools") is a fixed-output check already covered exactly by the
coder's two new example tests — no round-trip/idempotence/ordering shape
to add a property test for beyond that.

## Verdict

Clean. The bounced defect is fixed, verified non-vacuous, and swept for
recurrence elsewhere. No new architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.

By architect.
