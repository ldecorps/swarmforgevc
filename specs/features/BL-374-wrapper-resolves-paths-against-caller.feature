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
