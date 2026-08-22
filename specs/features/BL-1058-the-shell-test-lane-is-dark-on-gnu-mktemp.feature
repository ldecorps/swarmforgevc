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
