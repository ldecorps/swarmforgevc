Feature: A mutation run that kills no mutants is surfaced as a broken gate, not accepted as a clean pass

# BL-446 (bug, cleaner-reported rule_proposal 2026-07-16): Stryker mutation testing was observed
# killing ZERO mutants repo-wide (94 mutants across 2 files, 0 killed) even with coverageAnalysis
# off and full-suite-per-mutant runs, while the SAME mutations ARE caught by a plain `vitest run`.
# So only Stryker's kill mechanism is broken, not the tests. This is critical: the hardener's
# no-surviving-mutants gate is the project's mutation quality floor, and a tool that kills nothing
# makes every "no survivors" verdict since the regression VACUOUS - a wholly-untested file and a
# perfectly-tested one both read as a clean pass.
#
# TWO things must hold and they are verified DIFFERENTLY (mirroring BL-445):
#   1. OPERATIONAL (the actual fix + QA e2e, NOT a Gherkin scenario): the tool must KILL detectable
#      mutants again. Root-cause and fix the regression, then prove it with a FRESH, cache-cleared,
#      non-incremental scoped Stryker run that reports a non-zero kill count and a Killed verdict for
#      a mutant a plain `vitest run` catches. The 0-killed symptom must not reproduce.
#   2. DURABLE RATCHET (the scenarios below): a mutation-gate health verdict that classifies a run's
#      killed/survived counts and SURFACES a zero-kill run as a broken/suspect gate instead of
#      letting it pass silently as "no survivors". This is root-cause-agnostic: whatever broke the
#      tool, a future recurrence can never again be misread as a clean pass.
#
# ROOT CAUSE IS NOT YET PROVEN - DO NOT BLINDLY REVERT BL-422 (specifier constraint). The cleaner
# fingered BL-422's vitest pool/heap change as the likely cause, but the installed vitest-runner
# (node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js:36-49) STILL forces
# `pool:'threads'` + `maxThreads:1`, overriding vitest.config.mjs's BL-422 `pool:'forks'` - so
# BL-422 most likely does NOT reach the mutation path at all. Investigate the more probable causes
# FIRST and confirm with a fresh run before changing anything: (a) the incremental cache
# (`incremental:true` + stryker-incremental.json in stryker.config.json) is KNOWN to report stale
# Killed/Survived verdicts until deleted - delete it and re-run non-incrementally before trusting
# any verdict, including any that seem to show killing works; (b) the activation plugin path
# (`appendPlugins: ["./out/mutation/stryker-plugin.js"]` + out/mutation/stryker-plugin.ts and the
# per-worker stryker-setup); (c) the config's top-level `require('./out/tools/vitest-worker-memory-
# budget')` resolving inside the Stryker sandbox. Whatever the cause, PRESERVE BL-422's OOM
# protection for plain `vitest run` - the fix must not reintroduce the unbounded worker pool.

Background:
  Given a completed mutation run summarized by its killed and survived mutant counts

# BL-446 mutation-gate-zero-kill-broken-01
Scenario Outline: a mutation run's kill outcome is classified for gate health
  Given a mutation run reporting "<killed>" killed and "<survived>" survived mutants
  When the run's mutation-gate health is classified
  Then the health is reported "<health>"

  Examples:
    | killed | survived | health            |
    | 8      | 0        | healthy           |
    | 5      | 3        | healthy           |
    | 0      | 94       | zero-kill-suspect |
    | 0      | 0        | no-mutants        |

# BL-446 mutation-gate-zero-kill-broken-02
Scenario: a zero-kill run is surfaced as a suspect gate, never a silent clean pass
  Given a mutation run that killed no mutants across many survivors
  When the mutation-gate health verdict is produced
  Then the run is surfaced as zero-kill-suspect with its mutant counts, not reported as a clean gate pass
