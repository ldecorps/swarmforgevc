# mutation-stamp: sha256=8bd0973a5e7f64ad068523a3c330ba9bd9a0351836e809fa8a15a1a5b0661b1c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T12:10:44.410042010Z","feature_name":"the mutation gate excludes tsc's import-helper preamble as structurally-unkillable boilerplate","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-498-mutation-gate-excludes-tsc-import-helpers.feature","background_hash":"544d59117cbb72776880cd57bf5002e8a4382c2f297a38c946db8568ebec593c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a tsc import-helper shim assignment is excluded from the mutation gate","scenario_hash":"cb0632809421ca9b2ffe1705338ea12f10a92dbb2483972713cfe41603b54e81","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-17T12:10:44.410042010Z"},{"index":3,"name":"the two pre-existing boilerplate shapes stay excluded (regression)","scenario_hash":"f7bf3aca633a42fe2a0d06dc4b4f5115813ead90c1e416a09983a88b6a7dc645","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-17T12:10:44.410042010Z"}]}
# acceptance-mutation-manifest-end

Feature: the mutation gate excludes tsc's import-helper preamble as structurally-unkillable boilerplate

  # BL-485 hardening surfaced a third structurally-unkillable boilerplate shape the
  # BL-447 EntrypointBoilerplateIgnorer does not yet exclude. TypeScript compiles this
  # codebase's own `import * as x` convention (123 src files) by emitting a helper
  # preamble at the head of every such compiled file — `var __createBinding = (this &&
  # this.__createBinding) || (…)`, `__setModuleDefault`, `__importStar`, and
  # `__importDefault` for default imports. Stryker mutates that preamble into ~20-45
  # equivalent survivors PER FILE (mutation-site-count.js scored 65 survivors on one file
  # purely from this shim). They are the SAME class as the two shapes the ignorer already
  # excludes: compiler-emitted boilerplate the project never authored and cannot
  # meaningfully test — every mutant inside is behaviorally equivalent (defensive
  # `Object.create ? fast : slow` fallbacks, `k2 === undefined` guards). Left unexcluded
  # they inflate every `import * as` file's survivor count and recur on every future run,
  # so a module that follows every thin-wrapper/in-process-main rule perfectly still shows
  # survivors it can never kill.
  #
  # The fix extends EntrypointBoilerplateIgnorer to recognize and exclude these tsc helper
  # shim assignments, preserving its load-bearing ANTI-VACUOUS discipline: exclusion is
  # decided by STRUCTURAL LOCATION only (no coverage/kill signal), so it can never classify
  # an untested real-logic mutant as boilerplate. Recognition is pinned to a CLOSED,
  # extensible set of the exact tsc helper names AND the exact `var __NAME = (this &&
  # this.__NAME) || (…)` init shape tsc emits — never a broad head-of-file exclusion, and
  # never a name match alone (mirrors the existing recognizers pinning the exact
  # `require.main === module` and `__esModule` shapes). The classifier stays pure and
  # in-process unit-tested with plain AST literals, exactly like the two existing shapes.

  Background:
    Given the entrypoint-boilerplate ignorer classifies a single compiled AST node

  # BL-498 mutation-gate-excludes-tsc-import-helpers-01
  Scenario Outline: a tsc import-helper shim assignment is excluded from the mutation gate
    Given a tsc-generated helper assignment "var <helper> = (this && this.<helper>) || (…)"
    When the ignorer classifies the node
    Then the node is excluded from mutation

    Examples:
      | helper             |
      | __importStar       |
      | __importDefault    |
      | __createBinding    |
      | __setModuleDefault |

  # BL-498 mutation-gate-excludes-tsc-import-helpers-02
  Scenario: a variable named like a helper but without the tsc init shape is kept (anti-vacuous)
    Given a variable assignment named "__importStar" whose initializer is not the "(this && this.__importStar) || (…)" tsc shape
    When the ignorer classifies the node
    Then the node is kept for mutation

  # BL-498 mutation-gate-excludes-tsc-import-helpers-03
  Scenario: ordinary project logic is kept (anti-vacuous)
    Given an ordinary variable assignment "const total = a + b"
    When the ignorer classifies the node
    Then the node is kept for mutation

  # BL-498 mutation-gate-excludes-tsc-import-helpers-04
  Scenario Outline: the two pre-existing boilerplate shapes stay excluded (regression)
    Given the "<shape>" boilerplate node
    When the ignorer classifies the node
    Then the node is excluded from mutation

    Examples:
      | shape                                                       |
      | require.main === module entrypoint guard                    |
      | Object.defineProperty(exports, "__esModule", { value:true }) |
