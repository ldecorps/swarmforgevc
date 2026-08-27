# BL-1028 hardener pass — 2026-08-22

**Parcel:** architect-forwarded commit `1330ee78c0` ("BL-1028: architect
pass — compliant, forwarding to hardener"), merged into `swarmforge-hardender`
cleanly (no conflicts).

## Scope

`swarmforge/scripts/promote_and_route_next.sh` obeys a `commit_integrity_cli.bb`
refusal instead of overriding it with a raw unlocked `git commit`, and rolls
back the `git mv` it staged (scoped to its own two paths, never a blanket
reset) when it does not commit. Only shell/Babashka test infra changed — no
`extension/src/*.ts` touched, so Stryker/CRAP/DRY do not apply (verified:
`git diff a5a1e1cf6..1330ee78c0 --name-only` has zero `.ts`/`.tsx` files).

## Suites re-run directly (all green, matching architect's report)

- `bash swarmforge/scripts/test/test_bl1028_promotion_obeys_integrity_refusal.sh`
  — 8/8 PASS.
- `bb swarmforge/scripts/test/bl1028_promotion_refusal_property_runner.bb` —
  30 runs, floored coverage across 5 refusal shapes + novel/unknown reasons,
  ALL PROPERTIES HOLD.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh` on the feature) —
  10/10 pass.

## BL-113 Gherkin acceptance mutation (soft, all 4 positionals explicit)

    specs/pipeline/scripts/run_gherkin_mutation.sh \
      specs/features/BL-1028-promotion-must-not-bypass-a-refused-integrity-commit.feature \
      ./tmp/bl1028-mutation-workdir \
      specs/pipeline/steps/index.js \
      soft

The feature had no manifest before this pass (architect's evidence covered
acceptance and lint-gate, not BL-113). Result: `outcome: pass`, **8/8
killed**, 0 survived, 0 errors — both `Scenario Outline`s' `reason` column
(4 examples each: lock-timeout, verify-mismatch, commit-failed,
close-guard), one single-character-case mutation per cell. Manifest now
embedded in the feature file (`tested_at` 2026-08-22T14:18:17Z). The two
plain `Scenario:`s (03, 04) correctly carry no mutants — no `Examples:` to
mutate. Mutation workdir removed after the run; no `gherkin-mutator`/
`mutationWorker.js` processes left running.

## Hand-verified non-vacuity, independent of the coder's own authoring-time proofs

The coder's property-runner header documents four non-vacuity breaks proven
at authoring time. Re-derived one independently rather than taking it on
the comment: mutated the refusal branch's guard from
`(( INTEGRITY_RC != 0 ))` to `(( INTEGRITY_RC == 1 ))` (an exit-code-1-only
key, exactly invariant 1's "for any refusal reason, present and future"
concern).

- The **shell** suite (`test_bl1028_promotion_obeys_integrity_refusal.sh`)
  did NOT catch this mutant — every stub CLI in that suite exits with
  `System/exit 1`, so `INTEGRITY_RC` is always 1 there; the exotic-exit-code
  case is out of that suite's fixture space by construction.
- The **property runner** DID catch it — 58 failures across multiple
  `:exit-code` values other than 1 (2, 3), confirming P1/P2 genuinely depend
  on `!= 0`, not `== 1`.
- Source restored byte-identical (`diff` against a pre-mutation copy, clean)
  before re-running anything else; no suite was left running against the
  mutated file at any point (single-writer discipline per the detach/mutate
  rule).

This is exactly why the parcel's own suites are read TOGETHER: a mutant
outside one suite's fixture space is still killed by the combined harness.

## Guard sweep (BL-1028 touches `specs/pipeline/steps/index.js` and adds a
new step-handler file there)

    cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')

12 guard files (grown from the 6 recorded when this rule was written).
**11/12 pass.** The one failure —
`tempDirTrapGuard.test.js` on `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`
— is confirmed PRE-EXISTING and NOT this parcel's: present on `main`,
`origin/main`, and this branch's own tip (`702a044c4`) *before* the BL-1028
merge landed (`git show <ref>:<path>` succeeds on all three, byte-identical
last-touched at `71ee902a2`, a BL-1025 commit). Already ticketed as
**BL-1033** (`backlog/paused/`, `status: todo`, assigned to specifier) — the
same defect every other hardening pass this session has hit and recorded
(BL-1039's evidence file above cites it verbatim). Not re-ticketed; not
this parcel's fix to make.

## Orphaned processes

`pgrep -fl 'node --test|stryker|gherkin-mutator|mutationWorker'` checked
before and after every run in this pass — clean throughout. No leftover
temp dirs from the Gherkin mutation workdir (removed explicitly).

## Verdict

Hardened. The fix's two invariants (obey every refusal reason; leave the
index exactly as found) are proven by the shell suite, the property
runner, and now BL-113 Gherkin mutation over both `Scenario Outline`s —
8/8 killed, no survivors. One exit-code-keying mutant independently
verified to survive one suite but be killed by another, confirming the
combined harness (not any single file) is what earns the mutation claim.
One unrelated, pre-ticketed (BL-1033) guard failure noted and left alone.
Forwarding to documenter.

By hardender.
