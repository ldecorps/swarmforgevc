# BL-625 architect pass — 2026-08-18

## Scope

Received from cleaner as `merge_and_process cleaner be5ccb3721` (a batch
forward carrying BL-919, BL-625, BL-913 as three separate git_handoffs per
Article 2.6 — this evidence covers only BL-625's own work, reviewed as the
second of the three parcels). The implementation is coder's commit
`b94870c00` (onboarder slice 3: prompts, launch handoff, done, topic reuse);
`git diff --stat b94870c00..be5ccb3721 -- <BL-625's own files>` is empty, so
`b94870c00` is the commit actually reviewed here — no cleaner change to
review beyond it.

Files reviewed (`git show --stat b94870c00`):
- `extension/src/onboarding/contractPhaseRelay.ts`
- `extension/src/onboarding/onboarderContractPhaseRouter.ts`
- `extension/src/onboarding/onboarderState.ts`
- `extension/src/tools/contractPhaseRealAdapters.ts`
- `extension/src/tools/telegram-front-desk-bot.ts`
- `extension/test/contractPhaseRelay.test.js`
- `extension/test/onboarderAmbiguousTargetRefusal.property.test.js`
- `extension/test/onboarderContractPhaseRedeliveryIdempotent.property.test.js`
- `extension/test/onboarderContractPhaseRouter.test.js`
- `specs/pipeline/steps/bl625OnboarderPromptsLaunchHandoffSteps.js`
- `specs/pipeline/steps/index.js`

## Checks run (complete inventory, not first-failure-stop)

1. **Two-layer / host-owns-I/O boundary (Article 1.5, local-engineering
   Architecture Rules 1/3)** — `contractPhaseRelay.ts` and
   `onboarderContractPhaseRouter.ts` stay pure decision/dispatch (no fs,
   no process, no network); the new `proposePrompts` adapter method is
   only a seam in `ContractPhaseAdapters` — its real implementation
   (`defaultProposePrompts` in `contractPhaseRealAdapters.ts`, extension-host
   code) is the only place that reads the persisted survey facts, calls the
   prompts CLI building blocks, and writes to disk. No webview code touched
   at all; no browser storage; no secrets involved. This mirrors the
   existing `commitAndPush`/`negotiateApprove` adapter shape unchanged.
2. **Correctness read — target-attribution invariant (invariant 2)** —
   traced `pickUnambiguousInFlightState`
   (`onboarderContractPhaseRouter.ts`): with 2+ in-flight targets, the reply
   text must literally `includes()` exactly one target's `targetRepoUrl` to
   resolve; zero or 2+ matches refuse via `ambiguousMessage`, listing every
   in-flight target. `routeOnboardingMessage` runs this check for any text
   that is not itself a fresh repo URL (a fresh URL always names its own
   target, never ambiguous), before falling through to the pre-existing
   "most recently touched" pickers, which therefore only ever run in the 0/1
   in-flight case the old code already handled. No path found where a 2+
   in-flight ambiguous reply reaches a state-mutating branch.
3. **Correctness read — idempotency invariant (invariant 1)** — the new
   phases (`propose-prompts`, `post-launch-handoff`, `confirm-launch`) sit
   inside the same `runContractPhaseAction`/`decideContractPhaseAction`
   dispatch every earlier phase already uses; `telegram-front-desk-bot.ts`'s
   own redelivery guard (unchanged) still gates the whole
   `routeOnboardingMessage` call. The 12-line diff there only widens the
   no-durable-write short-circuit to also cover the new `ambiguous-target`
   outcome kind, which is correct: that outcome never touches `state`.
4. **`ready-to-launch` never claims a remote launch it cannot observe** —
   `decideContractPhaseAction` narrows this phase to recognizing only
   `proceed`; every other text routes to `renderCannotObserveLaunch`, which
   always restates the disclaimer and the exact command, never attempts to
   answer a status question. Matches ticket item 2 and scenario 03
   verbatim.
5. **Launch command not hardcoded** — `launchCommandFor`/
   `deriveTargetCloneDirName` derive the clone directory from the persisted
   `targetRepoUrl` via the existing `normalizeTargetRepoUrl`, matching the
   prerequisite step's own instructed clone directory; `DEFAULT_LAUNCH_PACK`
   is one named constant (`'mono-router'`), not a literal sprinkled per call
   site. Satisfies the ticket's "Supporting gates" line.
6. **Compile check** — `npm run compile` (tsc -p ./) is clean, no type
   errors.
7. **Declared invariants (2, per the ticket YAML) — Invariants Review**:
   - Invariant 1 (idempotent durable writes under redelivery) extended by
     `onboarderContractPhaseRedeliveryIdempotent.property.test.js`'s new
     "P BL-625" property (fast-check, drives the prompts phase through a
     simulated redelivered `updateId`).
   - Invariant 2 (unattributable reply refused) encoded fresh in
     `onboarderAmbiguousTargetRefusal.property.test.js`, with an explicit
     non-vacuity mutant (`mostRecentlyTouchedMutant`) proven to resolve
     where the real implementation refuses.
   - Both non-vacuous by inspection and by re-running (below).
8. **Dependency-rule gate (BL-259 hard gate)** — ran
   `node out/tools/dependency-gate.js` (cwd `extension/`) against all 5
   changed `src/` files. Reported 3 `acyclic` edges centered on
   `telegram-front-desk-bot.ts` -> `telegramCursorOperatorExec.ts` /
   `telegramCursorOperatorLiveness.ts` (and between those two). Verified
   this is PRE-EXISTING, not introduced by this commit:
   `git show b94870c00^:extension/src/tools/telegram-front-desk-bot.ts |
   grep telegramCursorOperator` shows the identical dynamic imports already
   present before BL-625's commit (same content, shifted 2 lines by this
   parcel's unrelated diff). A full-repo scan (`dependency-gate.js` with no
   args) reports the exact same 3 edges, confirming BL-625 changes nothing
   about this cycle's shape. Already tracked by its own ticket,
   `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`
   (confirmed present, not a duplicate — this evidence file itself is the
   check), and previously documented as pre-existing/out-of-scope by
   `backlog/evidence/BL-622-architect-pass-20260806.md` for a different
   ticket that also merely touched (without creating) this cycle. Per that
   precedent and Article 4.3 (route to the role that owns the fix — here,
   BL-759's own eventual assignee, not BL-625's coder), this is NOT a BL-625
   send-back.
9. **Co-change coupling (BL-255)** — ran `co-change-report.js` against the
   5 changed `src/` files plus the new step-handler file. All flagged
   pairs are within the onboarding module family itself (contractPhaseRelay
   / router / state / adapters / their own tests / the step-handler file /
   `specs/pipeline/steps/index.js`, the append-only registry every
   acceptance-adding ticket touches by design) — no cross-boundary coupling
   into webview code or unrelated subsystems.
10. **Acceptance (BL-233)** — the ticket's `acceptance:` points at a live
    `.feature` file (not `.draft`); its 5 scenarios match the ticket's own
    scenario map exactly; step handlers are registered in
    `specs/pipeline/steps/index.js`. Ran the pipeline directly (below): 5/5
    pass.
11. **Property-testing pass (own section)** — both declared invariants
    already carry fresh property coverage (see #7); no additional
    undeclared-property gap found on the touched pure modules
    (`contractPhaseRelay.ts`, `onboarderContractPhaseRouter.ts`,
    `onboarderState.ts`) beyond what the ticket's own invariants already
    require. No new property test added; none needed.

## Tests re-run independently (all green)

- `npm run compile` (extension/) — clean, no type errors. Note: the unit
  test files import from `extension/out/` (compiled, gitignored per
  Guardrails) — this worktree's `out/` was stale from a prior parcel and
  had to be rebuilt before any of the below would pass; not a code defect.
- `npx vitest run test/contractPhaseRelay.test.js
  test/onboarderContractPhaseRouter.test.js` → 50/50 tests pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/onboarderAmbiguousTargetRefusal.property.test.js
  test/onboarderContractPhaseRedeliveryIdempotent.property.test.js` → 4/4
  tests pass (both BL-624 and BL-625 idempotency properties; both
  ambiguous-target properties, including the non-vacuity mutant check).
- `node specs/pipeline/cli.js
  specs/features/BL-625-onboarding-facilitator-prompts-and-launch-handoff.feature`
  → 5/5 scenarios pass.

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. The pre-existing `acyclic` cycle surfaced by the dependency gate is
unrelated to this parcel's diff and already tracked by BL-759. Forwarding
to hardender.

By architect.
