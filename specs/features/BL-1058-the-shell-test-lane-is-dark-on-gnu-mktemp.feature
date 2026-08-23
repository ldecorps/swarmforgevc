# mutation-stamp: sha256=6b288f9d391af26faa6d1ba3c4177f9a85db2df97e12e483665a03f6454cbdcc
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T16:42:40.952813523Z","feature_name":"The tmp-cleanup helper initializes under either mktemp dialect","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1058-the-shell-test-lane-is-dark-on-gnu-mktemp.feature","background_hash":"a620c9a9e90970657dc3170c78046912e09b0835419b7acc9f30a26a4e692777","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The helper initializes under either mktemp dialect","scenario_hash":"8a4b33aaae3e75c08244090feccb72b599184e3c4e216894107b9f30f80f69ec","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T16:42:40.952813523Z"},{"index":1,"name":"Registered fixture roots are swept whatever the exit path","scenario_hash":"04f3c8a5c041c8073a6244af1c61fbcd58115979e3bf4b99bc002cbc3156b042","mutation_count":18,"result":{"Total":18,"Killed":18,"Survived":0,"Errors":0},"tested_at":"2026-08-22T16:42:40.952813523Z"}]}
# acceptance-mutation-manifest-end

Feature: The tmp-cleanup helper initializes under either mktemp dialect

  The shared shell-test cleanup helper creates its registry with BSD-only
  mktemp syntax. On a GNU coreutils userland that call is a hard error, so all
  83 shell test files that source the helper under set -euo pipefail die at
  source time, before a single test body runs. The helper's own suite dies the
  same way, which is why nothing caught it until the host moved.

  The registry must be created in a form both userlands accept, and a registry
  that cannot be created at all must say so by name rather than leaking a bare
  tool error and leaving the sourcing shell half-initialized.

  BL-801's design is preserved unchanged: the registry stays a file keyed per
  top-level process, so registrations made inside a command-substitution
  subshell survive, and the EXIT trap keeps sweeping it with a read loop that
  touches no array index. Only the call that creates the file changes.

  Background:
    Given a script running under set -euo pipefail

  # BL-1058 tmp-cleanup-portable-mktemp-01
  Scenario Outline: The helper initializes under either mktemp dialect
    Given a mktemp on PATH that accepts only "<dialect>" template syntax
    When the script sources the tmp-cleanup helper
    Then the helper exposes a registry file that exists

    Examples:
      | dialect |
      | GNU     |
      | BSD     |

  # BL-1058 tmp-cleanup-portable-mktemp-02
  Scenario Outline: Registered fixture roots are swept whatever the exit path
    Given a mktemp on PATH that accepts only "<dialect>" template syntax
    And the script sources the tmp-cleanup helper
    And the script registers a fixture root <site>
    When the script "<ending>"
    Then the fixture root no longer exists

    Examples:
      | dialect | site                               | ending                    |
      | GNU     | directly                           | reaches its end cleanly   |
      | GNU     | directly                           | exits on a failed command |
      | GNU     | from inside a command substitution | reaches its end cleanly   |
      | BSD     | directly                           | reaches its end cleanly   |
      | BSD     | directly                           | exits on a failed command |
      | BSD     | from inside a command substitution | reaches its end cleanly   |

  # BL-1058 tmp-cleanup-portable-mktemp-03
  Scenario: A registry that cannot be created fails loud and by name
    Given a mktemp on PATH that fails for every invocation
    When the script sources the tmp-cleanup helper
    Then the script exits non-zero
    And the error names the tmp-cleanup registry as what could not be created
