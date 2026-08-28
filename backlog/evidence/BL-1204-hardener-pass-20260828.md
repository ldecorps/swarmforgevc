# BL-1204 hardener pass — 2026-08-28

Merged architect handoff `03bbad81ea` (3rd architect pass, verifying
cleaner's re-fix of the Background fixture-leak bounce D1). No conflicts.

Production TypeScript for this ticket (the redeploy wiring itself) was
already landed on `main` in an earlier pass — `git diff main...HEAD` for
`extension/src/` shows no BL-1204 changes here; this pass is entirely
about the acceptance step handler's own fixture-lifecycle correctness.

## Mutation cooldown gate (BL-149)

`bl1204RedeployTargetsReachableAndListedSteps.js` is `file_age_days: 0.04`
— inside the 3-day cooldown, `skip-cooldown`. No Stryker relevant here
anyway (this is a `specs/pipeline/steps/*.js` acceptance step file, not a
`src/*.ts` production file); hardening below is BL-113 Gherkin mutation
(the file's own applicable gate) plus a hand-verified fixture-leak fix,
matching the project's Babashka/no-Stryker-surface fallback discipline.

## Two real fixture-leak gaps found and fixed (not just the one architect closed)

Architect's D1 (Background running unconditionally) is fixed and reverified
clean (3 consecutive `run_acceptance.sh` runs, 4/4 green, 0
`/tmp/bl1204-acceptance-*` stragglers). But the SAME leak class — a throw
between `mkdtempSync` and cleanup — still had two more instances left in
this file, both in the redeploy-target Outline's own two steps:

1. **The terminal ("Then") step's cleanup only ran after every assertion
   passed.** `fs.rmSync(st.root, ...)` sat as the LAST line of the step,
   after 7 assertions including an async marker poll. Any one of them
   throwing (a real regression, or — as directly confirmed below — a
   Gherkin mutant) skipped cleanup entirely. Fixed by wrapping the
   assertions in `try { ... } finally { fs.rmSync(...) }`.

2. **The FIRST ("When") step could itself throw, with nothing downstream
   to catch it.** `mkFixtureRoot()` runs at the top of "the operator sends
   ...", but `assert.ok(spec, ...)` a few lines later throws for any
   target outside `TARGET_SCRIPT`'s three keys. When that step throws, the
   scenario stops there — the "Then" step (and its new `finally` from fix
   #1) never runs at all, so its cleanup can't reach a root that never
   made it out of the first step. Fixed by wrapping the first step's body
   in `try { ... } catch (err) { fs.rmSync(st.root, ...); throw err; }`.

**Both hand-verified as real, non-vacuous gaps — not theoretical:**

- Gap #1: reverted to `git show HEAD:...` (the true pre-hardening file),
  mutated `assert.equal(st.target, target)` to compare against a value
  that can never match, ran `run_acceptance.sh` 3 times: **3 leaked
  `/tmp/bl1204-acceptance-*` dirs**, one per Outline example, confirmed
  present after the run. Re-applied the `try/finally` fix, repeated the
  same mutation: 0 leaks, scenario still fails loud (assertions still
  catch the mutation — this only closes the fixture-cleanup gap, it does
  not soften the check).
- Gap #2: found live via my own BL-113 run, not by hand: running
  `run_gherkin_mutation.sh` against this feature with fix #1 already
  applied but fix #2 not yet applied left **3 leaked fixture dirs** — one
  per mutated `Examples` value (`frontdesk`→`fRontdesk`,
  `all`→`alL`, `miniapp`→`miNiapp`), each hitting the `assert.ok(spec,
  ...)` throw in the first step. Applied the `try/catch` fix, reran the
  identical mutation pass: same 3/3 killed result, 0 leaks.

Restored the working tree cleanly between each hand-mutation probe
(diffed and `node --check`'d after every restore) — no mutated content
left in place at any point between checks, per the "never hand-mutate a
source file a detached suite is still reading" / one-writer discipline
(no detached job was outstanding here; these were foreground, synchronous
probes, so the hazard that rule guards doesn't apply, but the same
restore-and-verify discipline was followed).

## BL-113 Gherkin mutation (final, both fixes in place)

`run_gherkin_mutation.sh` soft, against `Scenario Outline: A built
redeploy target is reachable from Telegram` (the only Outline in this
feature — the help-message scenario is a plain `Scenario:`, nothing to
mutate there per BL-638):

```
Total 3, Killed 3, Survived 0, Errors 0
```

All 3 mutants are killed via `TARGET_SCRIPT[target]`/`assert.ok(spec,
...)` — a keyed lookup on the Examples value itself, not a shape-based
branch (BL-908 class check: the lookup is `TARGET_SCRIPT[<mutated
literal>]`, which genuinely misses for any value outside the three real
keys — non-vacuous). Manifest committed with the feature file.

## Verification

- `npm run compile`: clean.
- `run_acceptance.sh` on the BL-1204 feature, 3 consecutive runs: 4/4
  green each time, 0 leaked fixture dirs.
- `vitest run telegramCursorBridgeCore telegramCursorBridgeRedeployTargets`:
  129/129 pass (unchanged — this ticket's production wiring was already
  hardened in an earlier pass; nothing here touches `extension/src`).
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/`): ran
  all 12 non-property `*Guard*.test.js` files. Same 4 pre-existing
  failures as the prior BL-1203 hardening pass this session
  (`liveRepoDerivationGuard`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
  `socketFixtureShortRootGuard`) — none name this file or any BL-1204
  file; `liveRepoDerivationGuard`'s violations are BL-1209/BL-1212
  (todo, paused), the others are pre-existing/already-reported reds
  unrelated to this parcel (see BL-1203-hardener-pass-20260828.md for the
  full grep).

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Deleted every
scratch file this pass created:
`/tmp/bl1204steps.bak`, `/tmp/bl1204steps.orig.bak`,
`/tmp/bl1204steps.true_orig.js`, all `/tmp/bl1204-acceptance-*` leaked
during hand-verification, and `tmp/bl1204-gherkin-work/` (the mutation
worker's own work dir).

By hardener.
