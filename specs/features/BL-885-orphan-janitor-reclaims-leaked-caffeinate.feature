# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-12T16:05:54.419336Z","feature_name":"BL-885 orphan janitor reclaims leaked swarm caffeinate daemons","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-885-orphan-janitor-reclaims-leaked-caffeinate.feature","background_hash":"ee465d14f701dfc02c8fd08e39b8214d92a8b3e49bfb51c5cf55ef09e8284569","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-885 orphan janitor reclaims leaked swarm caffeinate daemons
  The resident-spy tunnel spawns a detached `caffeinate -dims` tracked only by
  a single-slot pidfile; any overwrite or unclean shutdown leaks the prior
  process forever (53 live orphans observed 2026-08-12). The periodic janitor
  sweep reclaims provably swarm-owned leaks: exact `-dims` argv, cwd under the
  host root or a registered worktree, not the pidfile's live PID, and past the
  age gate. PPID 1 is normal for every detached caffeinate and never buys a
  fast path.

  Background:
    Given an orphan janitor sweep wired with a fake process table and audit log
    And the registered project paths are the host root and its role worktrees

  # BL-885 leaked-caffeinate-reclaim-01
  Scenario: a leaked swarm caffeinate is reaped with an audit line
    Given the caffeinate pidfile records live PID 900
    And a process "caffeinate -dims" with PID 901 reparented to launchd
    And its cwd is a registered worktree path
    And its age relative to the caffeinate stale threshold is older
    When the sweep runs
    Then PID 901 is reaped
    And the audit log records reason "leaked-caffeinate" for PID 901

  # BL-885 leaked-caffeinate-reclaim-02
  # Hardener note (2026-08-12, BL-234): mutating the <pid> column on rows 2-6
  # (902->906/894/905/893, 903->898) survives on all five - accepted
  # equivalent mutants, not a coverage gap. reapable-leaked-caffeinate? (
  # orphan_janitor_lib.bb) never takes the raw pid; it takes the pre-computed
  # boolean is-live-caffeinate-pid?, and on every one of these rows a
  # DIFFERENT gate already decides the outcome before that boolean matters:
  # row 2 fails caffeinate-dims? (cmdline is "-i"), rows 3-4 fail
  # project-scoped? (cwd outside/undeterminable), row 5 fails stale? (age
  # younger), and row 6 has no pidfile to compare against at all (is-live-
  # caffeinate-pid? is always false when the pidfile is missing). None of
  # those five gates read the pid's specific digits - only row 1 (pid 900,
  # the pidfile's own tracked PID) makes the exact value load-bearing, and
  # mutating IT (900->899) is killed clean, proving the exemption path is
  # genuinely covered. All other 31 mutants in this outline killed clean.
  Scenario Outline: the sweep decision requires every ownership and age signal at once
    Given the caffeinate pidfile <pidfile-state>
    And a process "<cmdline>" with PID <pid> reparented to launchd
    And its cwd is <cwd>
    And its age relative to the caffeinate stale threshold is <age>
    When the sweep runs
    Then PID <pid> <outcome>

    Examples:
      | pid | pidfile-state        | cmdline          | cwd                        | age     | outcome   |
      | 900 | records live PID 900 | caffeinate -dims | a registered worktree path | older   | survives  |
      | 902 | records live PID 900 | caffeinate -i    | a registered worktree path | older   | survives  |
      | 902 | records live PID 900 | caffeinate -dims | a path outside the project | older   | survives  |
      | 902 | records live PID 900 | caffeinate -dims | not determinable           | older   | survives  |
      | 902 | records live PID 900 | caffeinate -dims | a registered worktree path | younger | survives  |
      | 903 | is missing           | caffeinate -dims | a registered worktree path | older   | is reaped |

  # BL-885 leaked-caffeinate-reclaim-03
  Scenario: the stale threshold honors its environment override
    Given the caffeinate pidfile records live PID 900
    And SWARMFORGE_ORPHAN_JANITOR_CAFFEINATE_STALE_HOURS is set above the default
    And a process "caffeinate -dims" with PID 904 reparented to launchd
    And its cwd is a registered worktree path
    And its age is between the default threshold and the custom threshold
    When the sweep runs
    Then PID 904 survives
