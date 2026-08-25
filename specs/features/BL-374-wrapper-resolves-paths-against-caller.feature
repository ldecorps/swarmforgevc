# mutation-stamp: sha256=2be681221d236c42906f0b62718851c509a88b6ba3ba411ef25accb61b8ac443
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T06:07:32.916145502Z","feature_name":"A tool wrapper resolves every path argument against the caller","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-374-wrapper-resolves-paths-against-caller.feature","background_hash":"e0c37a4d3bd12099ff3a64c39883140ac8ce394bdb60f7710ea4f4377ea11af3","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The work directory is resolved against the caller, not the tool's directory","scenario_hash":"c57cb481c66b48df2b4dd76b8189de4a165d94331555998f8d24ebc3a3a6a780","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-14T06:07:15.583010273Z"}]}
# acceptance-mutation-manifest-end

Feature: A tool wrapper resolves every path argument against the caller

# BL-374: run_gherkin_mutation.sh takes three path arguments and absolutizes only two of them.
# FEATURE_FILE and STEPS_MODULE are resolved against the caller's working directory (lines 26-27);
# WORK_DIR is not. The script then `cd`s into the vendored tool directory before exec'ing bb, so a
# relative work-dir silently means two DIFFERENT directories: `mkdir -p` creates it under the
# caller's cwd, and the tool writes its scratch under swarmforge/vendor/aps/ instead. That path is
# git-tracked and NOT gitignored, so the run leaves an untracked diff in the repo that a human then
# has to clean up by hand. The defect is the wrapper's inconsistency, not the caller's choice of
# argument: a wrapper that changes directory owns the job of pinning its arguments first.

Background:
  Given the gherkin-mutation wrapper is run from a worktree

# BL-374 wrapper-resolves-paths-against-caller-01
Scenario Outline: The work directory is resolved against the caller, not the tool's directory
  When the caller passes a <work-dir-form> work directory
  Then the mutation scratch is written to <resolved-location>

  Examples:
    | work-dir-form | resolved-location                                 |
    | relative      | that path beneath the caller's working directory  |
    | absolute      | exactly the path the caller named                 |
    | omitted       | a fresh private temporary directory               |

# BL-374 wrapper-resolves-paths-against-caller-02
Scenario: A mutation run leaves the vendored tool directory clean
  Given the vendored tool directory is tracked by git
  When a mutation run completes with a relative work directory
  Then the vendored tool directory contains no new files
