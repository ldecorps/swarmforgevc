# BL-624 — QA pass — 2026-08-16 — BOUNCE

## Scope reviewed

Parcel received from documenter, `merge_and_process documenter 72570501f0`.
QA branch fast-forwarded to `72570501f0` (already applied by a prior QA
session before this one resumed). Lineage confirmed: this ticket's own
hardener merge (`f6ac8b6a3` / `bf569da153`) is an ancestor of `72570501f0`
(`git merge-base --is-ancestor bf569da153 72570501f0` — true). Both prior
bounces on this ticket (architect send-back, `BL-624-onboarder-survey-
untrusted-agent-bounce-20260815.md`; documenter spec-gap note, `BL-624-
onboarding-facilitator-survey-to-gate-bounce-20260816.md`) are independently
re-confirmed fixed: the `--dangerously-skip-permissions` flag is gone from
`contractPhaseRealAdapters.ts` (replaced by `--allowedTools Read,Glob,Grep`),
and `acceptance:` in the ticket YAML is now the required single-line
pointer.

## Checklist completed this pass

1. **`qa-sibling-check.js status --ticket BL-624`** — exit 0, `VERIFY BL-624`
   (no open deferral).
2. **Orphaned-process check** — before and after: `pgrep -fl 'node --test|
   stryker'` clean both times; no lingering vitest workers post-run.
3. **Compile** — `npm run compile` (tsc -p ./ + postcompile stamp): clean,
   no errors.
4. **Unit suite** — `npm test` (full vitest run, 433 files / 7679 tests):
   427 passed, 6 files failed (7 tests). Of those:
   - `onboarderRenameNoResidualFacilitator.test.js` — **genuine, deterministic
     failure** (D1 below). Reproduced in isolation, not a timing artifact.
   - The other 5 failing files (`activateBounceWatcher`, `bounceDrain`,
     `bounceWatcher`, `dependencyGateCliReportsAndScope`,
     `renderBriefingDiagramsCli`) all fail with `Test timed out` /
     `[vitest-worker]: Timeout calling "onTaskUpdate"` — a known
     unconfigurable-worker-heartbeat pattern (cf. BL-871). Host load average
     was 183–234 on a 4-core box for the full verification window
     (`uptime`, `getconf _NPROCESSORS_ONLN` = 4) — roughly 50x nominal.
     Re-ran these 5 files in isolation: all 6 assertions still time out
     individually (20s test timeout), consistent with CPU starvation, not
     a functional regression. **None of these 5 files are touched anywhere
     in BL-624's own commit chain** (`git diff --name-only f58b74530
     72570501f0 -- test/` confirmed — only `contractPhaseRealAdapters.test.js`
     changed). Not attributed to this ticket; not blocking.
5. **Property suite** — `npm run test:properties` (full run, 94 files / 295
   tests, re-run twice to confirm): 4 files failed
   (`bl789MacHostSwitchFreshnessBridgeAdoptInvariants`,
   `bl796NvmNodePathFollowUpAdoptInvariants`,
   `bl797MutationGateProbeCrashFallback`, `bl760DuplicateChainGuard`), all
   with `Test timed out` (one at 768s) under the same extreme host load.
   None of these files are in BL-624's changed-file set (`git diff
   --name-only f58b74530 72570501f0` — zero matches). Not attributed to
   this ticket; not blocking. The ticket's own two declared-invariant
   property tests
   (`onboarderContractPhaseRedeliveryIdempotent.property.test.js`,
   `contractPhasePushGatedOnAgreement.property.test.js`) are not in this
   failure list — both green.
6. **Acceptance** — `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature`:
   7/7 scenarios pass, sequenced after the unit run per constitution.
7. **Wiring** — all 7 scenario tags
   (`survey-runs-on-own-clone-01` … `clone-failure-is-a-visible-hold-07`)
   have step-handler matches in `specs/pipeline/steps/
   bl624OnboarderSurveyToGateSteps.js`, itself wired into
   `specs/pipeline/steps/index.js`; production call sites confirmed in
   `extension/src/onboarding/contractPhaseRelay.ts`.
8. **required_wiring** — ticket YAML has no `required_wiring:` field; N/A.

## D1 — unit-test defect: residual "facilitator" filename not allowlisted

**Class:** unit. **Blamed role:** coder.

**Failing command:** `npx vitest run test/onboarderRenameNoResidualFacilitator.test.js`
(run from `extension/`).

**Commit tested:** `72570501f0`.

**First error excerpt:**
```
FAIL  test/onboarderRenameNoResidualFacilitator.test.js > no live
git-tracked file still says "facilitator" outside the dated record and
the named naming-decision citations
AssertionError: unexpected residual "facilitator" mentions (BL-684):
["specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature"]
+ actual - expected
+ [
+   'specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature'
+ ]
- []
```

**Expected vs observed:** expected `scanUnexpected()` to return `[]`;
observed it returns the BL-624 feature file's own path, because that path
contains the retired word "facilitator" and is not in
`extension/test/onboarderResidualAllowlist.js`'s `ALLOWED_EXACT_PATHS`.

**Root cause / why this is real, not a flake:** deterministic — a plain
`git grep` + array-membership check, unaffected by host load. Traced the
history: the feature file's *content* (Feature title, Background, step
text) was already correctly renamed "facilitator" → "onboarder" by BL-684
(`d3474a052`, "rename Onboarding Facilitator to Onboarder across live
surface") — confirmed via `git show d3474a052 -- specs/features/BL-624-
onboarding-facilitator-survey-to-gate.feature`. BL-684's own commit message
states the rename applies "everywhere except ... each ticket/feature
file's own preserved BL-### filename slug (boundary 2)" — i.e. the
*filename* is deliberately grandfathered, exactly like
`ALLOWED_BACKLOG_TICKET_BASENAMES` already grandfathers
`BL-624-onboarding-facilitator-survey-to-gate.yaml` by basename. But
`onboarderResidualAllowlist.js`'s `ALLOWED_EXACT_PATHS` (which requires
exact hardcoded paths for feature files, unlike the basename-pattern
allowance for tickets) was never given the matching entry for BL-624's (or
BL-625's) own feature file — only BL-590/684/714's feature files are
listed. Confirmed this gap predates BL-624's own pipeline work entirely:
the feature file blob at this path is byte-identical between `main` and
this ticket's HEAD except for the hardener's manifest-header stamp
(`git diff main HEAD -- specs/features/BL-624-...feature` — only the
`acceptance-mutation-manifest` block differs); the "facilitator" filename
itself has sat on `main`, unallowlisted, since BL-684 landed (`0cc180923`
era), never previously caught because no full-suite run had exercised this
specific file against the residual-guard test until BL-624 reached this
gate. No role in BL-624's own coder→cleaner→architect→hardener→documenter
chain introduced or renamed this file.

**Remediation pointer:** add `specs/features/BL-624-onboarding-facilitator-
survey-to-gate.feature` (and, since BL-625 shares the same slug pattern and
will hit the identical gate when it lands, `specs/features/BL-625-
onboarding-facilitator-prompts-and-launch-handoff.feature` if/when that
file exists) to `ALLOWED_EXACT_PATHS` in
`extension/test/onboarderResidualAllowlist.js` — mirroring the precedent
already set by `39012c6df` (BL-714) and `e0d63c6bf` (BL-792), each of which
allowlisted its own new file in the same parcel. Routed to coder per
Article 4.3's default (ownership not clear-cut — true root cause is
BL-684, already closed and merged; this is a one-line shared-allowlist
fix, matching the established pattern coder already follows for this exact
guard).

## Branch-hygiene note (BL-490/BL-495 "must revert")

Evaluated reverting BL-624's content out of this QA branch per the
constitution's bounce-revert rule. Declined to do so this pass: QA's
branch history for this window is a sequence of plain fast-forwards (no
merge commit to `git revert -m 1` against — `git reflog show
swarmforge-QA` shows `Fast-forward` entries only since the last QA
bounce), and the full changed-file diff since before BL-624 started
(`git diff --name-only 2e76141ab^ HEAD`) includes files that belong to
OTHER currently-active tickets riding the same branch via routine
`main`-merges (`specs/features/BL-768-*.feature`, `specs/features/BL-895-
*.feature`, `specs/features/BL-900-*.feature.draft`,
`extension/test/support/bounceKeyPairArb.js`), plus shared files
(`specs/pipeline/steps/index.js`, `docs/reference/Specification.MD`) that
BL-895/BL-900 may also depend on. A blind checkout-to-pre-BL-624 revert of
the touched-file set risks deleting or corrupting that unrelated, still-
active work. Flagging this to the coordinator by `note` rather than acting
destructively without a safe, precisely-scoped revert path; QA has not
approved or landed anything to `main`, so no rejected content escapes this
worktree either way.

## Disposition

One bounce, one defect (D1), everything else in the full inventory above
is clean or explicitly attributed to unrelated environmental noise (host
load 183–234 on 4 cores, not reproducible against files this ticket
touched). Routing to coder.

By QA.
