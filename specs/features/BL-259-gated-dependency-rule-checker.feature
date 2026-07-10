Feature: a gated static dependency-rule checker enforces the project's dependency-direction rules

  # Operator intake 2026-07-10 (via coordinator): make the architect's PROSE
  # dependency-direction check (architect.prompt:30; cleaner corrects by hand) a
  # real, tool-backed, GATED check — a hard fail like the hardener's
  # no-surviving-mutants gate. Grep-confirmed: no dependency-cruiser / eslint-
  # boundaries / madge / ts-arch in package.json today.
  #
  # Tool: a PINNED declarative dependency-rule checker (recommend dependency-cruiser
  # — declarative forbidden rules, non-zero exit on violation, diffable report;
  # eslint-plugin-boundaries / import no-restricted-paths or ts-arch acceptable).
  # Pinned per the engineering pinned-tools rule; the ruleset config is versioned
  # project source, not generated.
  #
  # COMPLEMENTS BL-255 (temporal/co-change, ADVISORY). This one is STATIC
  # (import-direction) and GATED — two separate tools/lenses (specifier confirms).
  #
  # The acceptance below is tool-agnostic: it asserts the ENFORCED RULES and the
  # GATE behavior, not a specific tool's flags.

  Background:
    Given a pinned dependency-rule checker configured with this project's forbidden-edge ruleset

  # BL-259 clean-passes-01
  Scenario: code that respects the rules passes the gate
    Given changed files with no forbidden dependency edge
    When the architect runs the dependency-rule gate
    Then the gate passes and the parcel may proceed

  # BL-259 violation-hard-fails-and-bounces-02
  Scenario: a violation is a hard fail that bounces to the coder, never forwarded
    Given a changed file that imports across a forbidden boundary
    When the architect runs the dependency-rule gate
    Then the gate fails hard
    And the architect bounces the parcel to the coder naming the offending edge and the rule it breaks
    And the parcel is not forwarded onward

  # BL-259 ruleset-enforced-03
  Scenario Outline: each of the project's dependency rules is enforced
    Given a dependency edge where "<forbidden edge>"
    When the gate runs
    Then it is reported as violating the "<rule>" rule

    Examples:
      | forbidden edge                                     | rule                       |
      | a policy module imports a filesystem or IO module  | no-io-from-policy          |
      | view or webview code imports extension-host IO     | view-not-import-host-io    |
      | view-layer code spawns a child process             | no-process-spawn-from-view |
      | a testable-core module imports the VS Code API     | core-not-vscode-api        |
      | webview code imports browser storage               | no-webview-storage         |
      | the imports form a dependency cycle                | acyclic                    |

  # BL-259 deterministic-report-04
  Scenario: the gate report is deterministic
    Given the same code and ruleset
    When the gate runs
    Then running it again produces the same violation report

  # BL-259 scope-changed-vs-full-05
  Scenario Outline: the gate scopes to changed files per parcel but supports a full-repo CI run
    Given a "<scope>" run
    When the gate runs
    Then it checks "<what is checked>"

    Examples:
      | scope        | what is checked          |
      | per-parcel   | only the changed files   |
      | full-repo    | the whole repository     |
