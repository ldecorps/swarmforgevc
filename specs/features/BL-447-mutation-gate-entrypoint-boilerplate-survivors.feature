Feature: The mutation gate excludes structurally-unkillable CLI-entrypoint boilerplate but never real logic

# BL-447 (feature, cleaner rule_proposal 2026-07-16 during BL-445's mutation pass): every tools/CLI
# module ends with the shared `if (require.main === module) { runCliMain(main); }` entrypoint guard
# (runCliMain is swarm-metrics.ts's shared wrapper, at ~52 call sites) and, from tsc, an
# `__esModule`/exports module-boilerplate header. Neither can be killed by ANY test: an in-process
# test calls main() directly and never executes the guard (NoCoverage), and a subprocess smoke test
# spawns a fresh node process that never carries Stryker's in-memory activeMutant/coverage signal, so
# it can never register a kill. So these mutants SURVIVE on all ~52 tools/CLIs no matter how well the
# author follows the existing thin-wrapper + in-process-main() rules (engineering.prompt) - the
# hardener's no-surviving-mutants gate is then permanently blocked by noise or forced to rubber-stamp.
# check-suite-duration-budget.ts is exemplary of those rules and still showed 9/42 survivors, incl. the
# NoCoverage guard block.
#
# DISTINCT FROM BL-446. BL-446 is the ACTIVATION defect (0 mutants killed repo-wide - the gate reports
# nothing as killed). THIS is the opposite failure mode, surfacing once the kill mechanism works again:
# real kills DO happen (33/42 on that file), but a fixed residue of boilerplate mutants always survives.
# So BL-447 MUST be verified against a WORKING kill mechanism (after BL-446, on a fresh cache-cleared
# non-incremental run) - hence depends_on BL-446 - or an excluded-boilerplate survivor is
# indistinguishable from a broken-activation one.
#
# THE EXCLUSION MUST BE SURGICAL (anti-vacuous - the load-bearing constraint). It excludes ONLY the
# entrypoint guard + generated module boilerplate, decided by STRUCTURAL LOCATION, never by whether a
# mutant happens to lack coverage. A mutant in real exported logic MUST still be mutated and MUST still
# survive-and-surface when untested - otherwise this recreates a BL-446-style vacuous gate one file at a
# time.
#
# TWO things must hold, verified DIFFERENTLY (mirrors BL-445/BL-446):
#   1. DURABLE CONTRACT (the scenarios below): a pure, in-process-testable classifier decides, per
#      candidate mutant, whether it lands on structurally-unkillable entrypoint/module boilerplate
#      (excluded) or on mutable code (kept). Same shape the project already uses (classifySuiteDuration /
#      computeWorkerMemoryBudget): a pure decision, thin AST wiring around it.
#   2. WIRED + OPERATIONAL (QA e2e, not a Gherkin scenario): the classifier is wired into the LIVE Stryker
#      gate as an Ignorer (Stryker's `Ignorer.shouldIgnore(path) => reason|undefined`, PluginKind.Ignore;
#      extension/src/mutation/stryker-plugin.ts already declares the plugin array - today only a Reporter;
#      the Ignorer is its sibling). A pure predicate with zero live callers is a dark feature
#      (engineering.prompt wiring rule), so this wiring is part of the deliverable, not "later".
#
# Scope (verify the live path at build time - specifier rule): extension/stryker.config.json (mutate:
# out/**/*.js; appendPlugins out/mutation/stryker-plugin.js); extension/src/mutation/stryker-plugin.ts
# (extend its plugin array with the Ignorer that delegates to the pure classifier); the shared entrypoint
# wrapper runCliMain in extension/src/tools/swarm-metrics.ts and the `if (require.main === module)` guard
# tsc emits across ~52 tools/CLIs; the tsc `__esModule`/exports header. The Ignorer inspects the compiled
# JS AST (out/**/*.js is the mutate scope), so the guard and the defineProperty(__esModule) node are both
# reachable there. Mechanism is the architect/coder's call - the Ignorer plugin is the precedented
# candidate; a bare `// Stryker disable` source comment does NOT cover the generated boilerplate (no
# source line to annotate). Do NOT hand-edit mutation manifests (engineering guardrail). Do NOT weaken the
# gate beyond this exact boilerplate class.

Background:
  Given the mutation gate is classifying a candidate mutant for a tools/CLI module

# BL-447 entrypoint-boilerplate-excluded-01
Scenario Outline: a candidate mutant is excluded only when it lands on structurally-unkillable boilerplate
  Given a candidate mutant located in "<location>"
  When the mutation gate decides whether to mutate it
  Then the mutant is "<disposition>"

  Examples:
    | location                       | disposition |
    | require-main-entrypoint-guard  | excluded    |
    | generated-esmodule-boilerplate | excluded    |
    | exported-business-logic        | kept        |

# BL-447 entrypoint-boilerplate-excluded-02
Scenario: exclusion is decided by structural location, never by absence of coverage
  Given a candidate mutant in exported business logic that no test covers
  When the mutation gate decides whether to mutate it
  Then the mutant is kept so it surfaces as a survivor, never excluded as boilerplate
