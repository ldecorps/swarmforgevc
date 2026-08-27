# BL-624 — architect pass — 2026-08-15 — BOUNCE

## Scope reviewed

Parcel received from cleaner at `6763758acc` (merged into architect at
`62c521284` on top of `b1e0b861e`). Commits in scope:

- `2e76141ab` (coder) — implement onboarder slice 2: survey through agreed
  contract (BL-624).
- `6763758ac` (cleaner) — dedupe negotiate-onboarding-contract outcome
  translation into `negotiationOutcomeAdapters.ts`.

Files reviewed: `extension/src/onboarding/contractPhaseRelay.ts`,
`extension/src/onboarding/onboarderContractPhaseRouter.ts`,
`extension/src/onboarding/onboarderState.ts`,
`extension/src/tools/contractPhaseRealAdapters.ts`,
`extension/src/tools/negotiationOutcomeAdapters.ts`,
`extension/src/tools/propose-onboarding-contract.ts`,
`extension/src/tools/relay-onboarding-negotiation-telegram.ts`,
`extension/src/tools/telegram-front-desk-bot.ts`, plus their test/property
files and `specs/pipeline/steps/bl624OnboarderSurveyToGateSteps.js`.

## Checklist completed this pass

1. **Dependency-rule gate (BL-259, hard gate)** — `node
   extension/out/tools/dependency-gate.js` against the 8 changed source
   files (compiled fresh first; `out/` was stale and missing these files
   entirely). Reports the pre-existing `telegram-front-desk-bot.ts` <->
   `telegramCursorOperatorExec.ts` <-> `telegramCursorOperatorLiveness.ts`
   acyclic cycle. Confirmed via `git diff b1e0b861e 6763758ac --
   extension/src/tools/telegram-front-desk-bot.ts | grep
   telegramCursorOperator` (zero hits) that this parcel never touches
   either edge. Already tracked as `BL-759` (paused), same disposition as
   the BL-826 architect pass (`BL-826-architect-pass-20260809.md`). No
   violation attributable to this parcel.
2. **Co-change coupling (BL-255)** — `node
   extension/out/tools/co-change-report.js` against the same 8 files.
   Reported coupling is either within this parcel's own file set (expected)
   or pre-existing high-touch-file noise (`telegram-front-desk-bot.ts`,
   `specs/pipeline/steps/index.js`) matching the "co-changes with nearly
   everything" pattern already judged benign in prior passes. No new
   coupling defect.
3. **Invariant 1** ("every durable write is idempotent under redelivery of
   the same Telegram update") — encoded as
   `onboarderContractPhaseRedeliveryIdempotent.property.test.js`, 120 runs,
   drives the REAL `findProcessedOnboardingUpdate`/
   `writeOnboardingStateAndMarkUpdateProcessed` guard (unmodified by this
   ticket) through BL-624's new phases with a fake adapter set. Proves by
   construction that op 0 leaves `prerequisites-ready` and the run never
   reaches `contract-agreed`, so the property genuinely exercises the
   plateau it claims to. Non-vacuous by construction (asserts exact resend
   semantics + no state mutation on redelivery, not merely "no crash").
   The underlying durable writes for propose/negotiate
   (`writeAndCommitBootstrapPlan`, `updateTargetContract`) are pre-existing,
   already-idempotent infra this ticket does not modify (confirmed via
   `targetBootstrap.ts`'s own header comments). Ran green via `npm run
   test:properties`.
4. **Invariant 2** ("nothing is pushed before the human has agreed the
   contract") — encoded as
   `contractPhasePushGatedOnAgreement.property.test.js`, 300 runs, checks
   `commitAndPush` is invoked iff this turn actually agreed (not
   already-ended) AND the gate allowed, across every `ContractPhaseAction`
   variant. Structurally reinforced: `commitAndPush` has exactly one call
   site (`proveGateAndPush`), reachable only after `phase` is set to
   `'contract-agreed'`. Ran green.
5. **Supporting gate** ("no parallel negotiation state") —
   `negotiationStateSingleWriter.test.js`, a static grep confirming only
   `negotiate-onboarding-contract.ts` calls `updateTargetContract` or
   touches the negotiation round-log paths. Ran green; BL-624's own new
   `contractPhaseRealAdapters.ts` correctly routes through the shared
   `negotiationOutcomeAdapters.ts` wrapper rather than reimplementing.
6. **Acceptance** — `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature`:
   7/7 scenarios pass, matching the ticket's own scenario map.
7. **Unit suite** — `vitest run` on all touched test files: 330/330 pass
   (6 files; the 2 property-test files run separately per the project's
   own test:properties separation and are covered by items 3-4 above).
8. **Wiring sanity** — confirmed `targetPath` threaded into
   `createRealContractPhaseAdapters(targetPath)` at
   `telegram-front-desk-bot.ts`'s `handleOnboarderMessage` is the CLI's own
   `swarmRepoRoot` (this box's own SwarmForge project directory, matching
   every other `.swarmforge/operator/*` reader/writer in the same file and
   `onboarderStateStore.ts`'s own `swarmRepoRoot` parameter naming), not the
   onboarding target's clone path. Correct.
9. **Property-testing pass (architect-owned)** — no additional
   property-shaped pure module beyond items 3-4 found undercovered in this
   parcel's touched files.

## D1 — correctness/security defect: unrestricted, permission-skipping
agent runs inside an untrusted, non-scratch clone with live push credentials

**Class:** behavior (security). **Blamed role:** coder.

`contractPhaseRealAdapters.ts`'s `defaultSurveyRepo` (lines 98-112) is the
FIRST real implementation of "gather RepoSurveyFacts from a live repo" —
`contractSurvey.ts`'s own `proposeContractFromSurvey` is a pure function
over already-gathered facts and never itself shells to an agent (confirmed:
no existing file previously implemented this step). It runs:

```
execFileSync('claude', ['-p', surveyPrompt(), '--output-format', 'json',
  '--dangerously-skip-permissions'], { cwd: localPath, ... })
```

where `localPath` is a **real git clone of an arbitrary, human-supplied
GitHub URL** — the actual repo being onboarded, not a disposable fixture.
That same directory later receives real commits (`runObject`/`runApprove`,
existing infra) that `commitAndPush` (line 176) pushes to the target's real
GitHub remote using the box's own ambient git credentials.

The code's own header comment justifies this by pointing to the
established convention in `claudeCliExecutor.ts`
(`src/benchmark/claudeCliExecutor.ts:63-67`): *"`--dangerously-skip-permissions`
is safe here because `cwd` is always a scratch copy
`materializeTaskFixture` creates fresh per trial, **never the real
repository**."* That safety condition is the entire justification for
skipping permissions there, and it does not hold in
`contractPhaseRealAdapters.ts`: `localPath` is not a throwaway scratch
copy — it is the actual target repo's clone, sitting under
`swarmRepoRoot/.swarmforge/onboarding-clones/`, connected to a real remote
with real push access.

**Failure scenario:** a human onboards `https://github.com/someone/repo`
where the repo's README or code contains adversarial text (deliberately
planted, or picked up via a compromised dependency/fork). The survey prompt
(`surveyPrompt()`, lines 65-73) explicitly instructs the agent to *"Read the
repo's languages, top-level layout and README... identify real use cases
evidenced in its own code."* With `--dangerously-skip-permissions`, nothing
gates any tool call that content coaxes the agent into making —
reads/writes/exec are not confined to `localPath` (no `--add-dir`,
container, or other confinement is used anywhere in this file or its
callers; grep-confirmed no sandboxing flags exist in this codebase's claude
CLI call sites). The agent could read host secrets outside `localPath` and
smuggle them into `RepoSurveyFacts`/the posted contract, or take destructive
action on the host, or push arbitrary content through the same git identity
`commitAndPush` later reuses. This is a direct exposure against
Architecture Rule 4 ("secrets stay in the extension-host environment only")
in a case no earlier BL-590 ruling ("runs on primary box, clones by URL,
existing CLIs only, existing gate" — BL-624.yaml's own
`approval_context`) addresses; the human never approved "run an unrestricted
agent inside the untrusted clone" as part of BL-590's design.

**Remediation pointer:** the survey step needs a real confinement boundary
before `--dangerously-skip-permissions` is defensible here — at minimum,
run the survey agent under a permission mode that does not blanket-skip
approval (e.g. an allowed-tools list scoped to read-only operations inside
`localPath`), or execute it inside an actual sandbox/container with no
access to host secrets and no network beyond what surveying requires. This
is a design decision for the coder to make (with a rule_proposal for the
specifier if it needs BL-590-level ruling on the general question of
untrusted-repo agent confinement across the whole onboarder feature) — not
something the architect fixes in place.

## Disposition

Everything else in this parcel (invariants 1-2, dependency/co-change gates,
acceptance, unit suite, wiring) is clean. This is the ONLY defect found
this pass. Per Article 4.4, one bounce for the whole pass, to the coder
(the file/step is new code this ticket adds, not a pre-existing pattern
being reused unmodified — BL-759 is the correct comparison for "pre-existing,
not blamed on this parcel" and this does not qualify for that treatment).
