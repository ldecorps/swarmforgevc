Feature: dev-host bounce under WSL terminates the prior Windows-side window instead of leaking it

  # BL-578: start-extension-dev.js promises "a successful run always ends
  # with exactly one dev host," but under WSL the kill-old stage only sees
  # Linux-side processes — it cannot close the Windows-side Electron window
  # crossing the WSL interop boundary, so every legitimate bounce ADDS a
  # window instead of replacing one (six accumulated, observed). Fix applies
  # both design directions together: (1) make kill-old interop-aware via a
  # pure, unit-testable command-construction seam, and (2) self-guard the
  # bouncer to refuse when .swarmforge/headless-swarm is present, unless
  # --force is passed.

  # BL-578 kill-old-constructs-windows-side-termination-commands-01
  Scenario Outline: kill-old constructs termination commands targeting the Windows-side dev host
    Given a WSL platform fixture
    And an extension path "<extension path>"
    When the kill-old stage runs
    Then the constructed termination command set targets Windows-side dev hosts for "<extension path>"

    Examples:
      | extension path                          |
      | /home/dev/swarmforgevc                   |
      | /home/dev/swarm forge vc with spaces      |

  # BL-578 two-consecutive-bounces-yield-one-host-02
  Scenario: two consecutive bounces record exactly one live host
    Given a WSL platform fixture
    When a dev-host bounce runs twice in succession
    Then the bouncer's own accounting records exactly one live host, never two

  # BL-578 headless-marker-refuses-launch-03
  Scenario: start-extension-dev refuses to launch when the headless-swarm marker is present
    Given ".swarmforge/headless-swarm" is present
    When start-extension-dev runs without --force
    Then it exits non-zero naming the marker
    And it launches nothing

  # BL-578 force-flag-overrides-with-warning-04
  Scenario: --force overrides the headless-swarm refusal with a warning
    Given ".swarmforge/headless-swarm" is present
    When start-extension-dev runs with --force
    Then it launches
    And it prints a warning naming the marker override

  # BL-578 non-wsl-platforms-unchanged-05
  Scenario: non-WSL platforms keep today's kill-old behavior
    Given a native Linux platform fixture
    When the kill-old stage runs
    Then the interop termination path does not activate

  # BL-578 activation-marker-contract-unchanged-06
  Scenario: the activation-marker success contract is unchanged
    Given a fresh, successful dev-host activation
    When start-extension-dev completes
    Then it exits 0 only on that fresh activation, as before this fix
