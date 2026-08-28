# BL-1228 cleaner pass (2026-08-28)

## What I did

Merged coder handoff `a6b7916a9d` (BL-1228: audit reports any active/
ticket under a standing freshness hold) into the cleaner worktree — clean
auto-merge, no conflicts. The merge also pulled in a large batch of
unrelated `main`-lineage bookkeeping (constitution article restructuring,
other tickets' pool moves) that arrived via the coder branch's own merge
of `main`; none of it touches this ticket's own files.

## Coder's own commit scope

`extension/src/tools/active-pool-freshness-audit.ts` (new),
`extension/test/activePoolFreshnessAudit.test.js` (new),
`specs/pipeline/steps/bl1228ActivePoolFreshnessHoldAuditSteps.js` (new),
`specs/pipeline/steps/index.js`, `swarmforge/scripts/active_pool_freshness_audit.sh`
(new), `swarmforge/scripts/promote_and_route_next.sh` (10-line wiring
addition).

## Cleanup Order applied

- Coverage: `npx vitest run test/activePoolFreshnessAudit.test.js` —
  16/16 pass, including the BL-897-discipline cross-check test asserting
  `interpretFreshness` agrees with `deprecate-check.ts`'s own
  `interpretFreshnessCliOutput` on every sample input.
- Mutation-site count (BL-485):
  `active-pool-freshness-audit.ts` — 132 sites, `over` (threshold 100).
  Weighed a split: the module is one cohesive ~166-line CLI tool with a
  single linear responsibility (list active tickets → check each via an
  injected/real freshness lookup → format findings), and its sections
  (`interpretFreshness`, `listActiveTicketRefs`, `auditActivePool`,
  CLI wiring, `main`) are already clearly delineated within it. A forced
  split (e.g. peeling `interpretFreshness` into its own file) would not
  improve separation of concerns here — it exists as a deliberately
  file-independent, documented duplicate for one specific fail-closed
  reason (qa_e2e_procedure step 3: `deprecate-check.js` renamed aside must
  not crash this module at require-time), and moving it elsewhere doesn't
  change that reasoning or make the module easier to test/harden
  downstream. Left whole — advisory only, no split, per "a legitimately
  cohesive module that a split would only harm stays whole."
- `thin-main-gate.js`: `active-pool-freshness-audit.ts`'s `main` is not
  flagged (uses `makeArgsGuardedMain`, same thin-wrapper seam as the
  project's other CLIs).
- DRY (`jscpd` on the new file): 0 clones, 0% duplication.
- Structure: `auditActivePool` is pure over an injected `checkFreshness`
  fn (constraint: no real backlog corpus in unit tests); the real CLI
  subprocess wiring (`checkFreshnessViaCli`/`resolveDeprecateCheckCliPath`)
  is isolated from it, matching this project's inject-side-effects rule.
  `promote_and_route_next.sh`'s wiring is a 10-line best-effort
  (`|| true`) call after promotion, matching `required_wiring`'s claim
  exactly.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh` on
  `BL-1228-active-pool-freshness-hold-divergence-audit.feature` — 9/9
  pass, covering all 6 named scenarios plus outline rows.

## Verdict

No cleanup changes needed. Forwarding to architect unchanged.
