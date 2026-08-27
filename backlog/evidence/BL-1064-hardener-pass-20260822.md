# BL-1064 hardener pass — 2026-08-22

**Parcel:** architect-forwarded commit `efe68335f0` ("BL-1064: architect pass
— compliant, forwarding to hardener"), merged into `swarmforge-hardender`
(see this ticket's own merge commit, immediately preceding this evidence
commit). No conflicts.

## BL-149 cooldown gate (all three touched production files)

    bb swarmforge/scripts/mutation_cooldown_gate.bb "$(pwd)" specs/pipeline/steps/bl1064LogGroundingSourceSteps.js
    -> DECISION: run (no history on main yet — brand new file)
    bb swarmforge/scripts/mutation_cooldown_gate.bb "$(pwd)" specs/pipeline/steps/bl643NonPipelineAgentsSteps.js
    -> DECISION: skip-cooldown (file_age_days 1.27 on main — BL-1005 touched it 2026-08-21)
    bb swarmforge/scripts/mutation_cooldown_gate.bb "$(pwd)" specs/pipeline/steps/index.js
    -> DECISION: skip-cooldown (file_age_days 0.01 on main — another ticket registered a step there minutes earlier)

Per the gate and the same-day BL-1033 precedent: no *additional* hand-authored
or differential mutation testing of `bl643NonPipelineAgentsSteps.js`/`index.js`
this pass. This does not exempt the ticket's own acceptance gate (BL-113 below)
or its suites (run below) — those are the ticket's actual hardening evidence,
not extra mutation-testing of a churning file. `index.js` is a pure
registration line with no logic of its own; its cooldown status is moot for
mutation purposes either way.

## Suites re-run directly (all green)

- Acceptance, `specs/pipeline/scripts/run_acceptance.sh` on this ticket's own
  feature — **4/4 pass**.
- Property lane, `npx vitest run --config vitest.properties.config.mjs
  test/bl1064LogGroundingSource.property.test.js
  test/bl643NonPipelineAgentPaths.property.test.js` — **6/6 pass** (4 + 2),
  confirming the previously-permanently-red bl643 tests stay green.
- Sibling-feature regression check,
  `BL-643-non-pipeline-agents-documented-as-a-class.feature` (the feature the
  edited step file primarily serves) — **18/18 pass**, no regression.
- Two other consumers of the edited module, re-run directly:
  `test/bl1005OnboarderBuildStateGate.test.js` (23/23) and
  `test/bl1005OnboarderGateNonVacuity.property.test.js` (2/2) — both clean.

## Non-vacuity, independently reproduced (not taken on the architect's word)

Removed the new `'Front Desk': [...]` override block from
`bl643NonPipelineAgentsSteps.js` by hand (via a `./tmp/` backup, restored
after), re-ran the property lane: both `bl643NonPipelineAgentPaths.property
.test.js` tests failed with the exact original message (`row "Front Desk" log
literal(s) not found ... [".swarmforge/operator/front-desk-diagnostics.log"]`,
now also carrying the new DERIVED-source clause), and 2 of the 4
`bl1064LogGroundingSource.property.test.js` tests failed too. Restored the
file (`git diff` empty afterward) and confirmed all 6 green again before
proceeding. The fix is load-bearing, not a passthrough.

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1064-front-desk-log-literal-has-no-verification-source.feature \
      ./tmp/bl1064-mutation-workdir \
      specs/pipeline/steps/index.js \
      soft

Result: `outcome: pass`, **2/2 killed**, 0 survived, 0 errors — the one
`Scenario Outline`'s two `<literal>` examples (`front-desk-supervisor.log`,
`front-desk-diagnostics.log`). Both kills are real assertion failures (the
step handler's `KNOWN_LITERALS` guard rejecting the mutated string), not
crashes — confirmed by reading each mutant's captured TAP output. Manifest
embedded in the feature file (`tested_at` present, `Killed: 2`). Mutation
workdir removed; no `gherkin-mutator`/`mutationWorker.js` processes left
running afterward.

## Tooling scope

No `extension/src/*.ts` file touched anywhere in this ticket's history
(confirmed empty `git diff --name-only <base>..<parcel> -- '*.ts'`) — pure
JS step-handler files under `specs/pipeline/steps/`, one property test file.
CRAP (scoped to `extension/src/*.ts`) and Stryker (scoped to `out/**/*.js`,
compiled TS) do not apply; DRY (`npm run dry` → `jscpd --config .jscpd.json
src`) is likewise scoped to `extension/src` and does not reach these files
either. Per engineering.prompt's untooled-surface fallback, coverage here is
carried by the property lane (both real-table-enumeration and generated
checker-behavior halves, independently re-run above) and BL-113 Gherkin
mutation. The ticket's own `notes:` already record `IR-DRY: 0 findings` at
mint time.

## Guard sweep (parcel touches `specs/pipeline/steps/`: new
`bl1064LogGroundingSourceSteps.js`, edited `bl643NonPipelineAgentsSteps.js`
and `index.js`)

    cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')

**13/13 guard files pass, 125/125 tests** — including
`bl643NonPipelineAgentsStepsGuards.test.js`, the dedicated guard for the
exact file this parcel edits.

## Orphaned processes / leaked fixtures

Checked before and after every run (`pgrep -fl 'node --test|stryker|gherkin-
mutator|mutationWorker'`, scoped to this worktree) — clean throughout, nothing
left running. `git status --short extension/test/` clean after the property
runs — no leaked fixture files.

## Verdict

Hardened. The invariant ("every row whose log literal is written somewhere
other than its launcher declares that writer explicitly; the check never
falls back to a source that cannot contain the literal") is proven by: the
real-table enumeration (both halves of the coder's property test), the
generated checker-behavior properties reaching the mixed/derived/declared
shapes that caused the original defect, an independent by-hand non-vacuity
reproduction of the original failure, and 2/2 real BL-113 Gherkin mutation
kills on the one Scenario Outline. No survivors anywhere. CRAP/DRY/Stryker
not applicable (no `.ts`/`src` touched) per the same untooled-surface
fallback as BL-1033/BL-1060 today. Forwarding to documenter.

By hardender.
