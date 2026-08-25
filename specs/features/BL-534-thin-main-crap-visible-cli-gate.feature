# mutation-stamp: sha256=46603ea609037c668211f8ca6c03d44cd29ddc592043ab090bc93b0ba4029c21
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T09:38:58.558389788Z","feature_name":"BL-534 thin-main CRAP-visible CLI gate","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-534-thin-main-crap-visible-cli-gate.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"parcel mode passes or fails by main cyclomatic complexity","scenario_hash":"e174444b9ff8496b1c78be791c97985d3bf9c72a7a4f2eaab689aa5d17620f69","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-25T09:38:58.558389788Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-534 thin-main CRAP-visible CLI gate
  Logic left in a tools CLI main() is only hit via subprocess and stays
  CRAP-invisible. This gate keeps main() a thin wrapper over exported
  helpers for files under extension/src/tools/.

  Runner: node extension/out/tools/thin-main-gate.js
  (source extension/src/tools/thin-main-gate.ts), same CLI shape as
  dependency-gate. Parcel mode takes changed tool paths as args; no-arg
  mode scans every extension/src/tools/**/*.ts entry that defines main.

  Measure: for each scoped file that defines a function named main,
  main must be exported and its cyclomatic complexity must be <= 2
  (1 + decision points: if / for / while / switch / catch / ternary /
  logical short-circuit used as control flow inside main's body).
  Branching or formatting logic that belongs in a helper fails the gate.

  Grandfather: parcel mode never allowlists. Full-repo mode may skip
  basenames listed in extension/thin-main-allowlist.txt (one basename
  per line); the allowlist may only shrink after first land.

  # BL-534 main-complexity-outcome-01
  Scenario Outline: parcel mode passes or fails by main cyclomatic complexity
    Given a TypeScript tools file under extension/src/tools/ whose exported main has cyclomatic complexity <complexity>
    When the thin-main gate runs in parcel mode on that path
    Then the gate exit code is <exit>
    And the report <report>

    Examples:
      | complexity     | exit | report                        |
      | greater than 2 | 1    | names that file and main      |
      | at most 2      | 0    | does not flag that thin main  |

  # BL-534 out-of-scope-path-02
  Scenario: files outside extension/src/tools are ignored
    Given a host-layer TypeScript module path under extension/src/bridge/
    When the thin-main gate runs in parcel mode on that path
    Then the report stays empty for that path
    And the process status is success

  # BL-534 full-repo-allowlist-03
  Scenario: full-repo mode skips an allowlisted pre-existing violator
    Given extension/thin-main-allowlist.txt lists the basename of a tools file whose main is non-thin
    When the thin-main gate scans the full tools tree
    Then that allowlisted file does not cause a non-zero exit by itself
    And a non-allowlisted non-thin main still fails the gate
