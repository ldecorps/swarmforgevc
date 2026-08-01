Feature: babysitterd is a deterministic daemon managed by the swarm lifecycle

  # BL-611: the LLM-based babysitter role never behaved right at deterministic
  # health-checking work; a hand-built deterministic prototype
  # (.swarmforge/operator/babysitter_check.sh + babysitterd.sh, untracked and
  # gitignored) already does the job and is running live. This ticket ports
  # that prototype into the repo: managed by start/stop-swarm and ./swarm
  # ensure like the other daemons, its finding-assembly core pure and unit
  # tested, its nudge contract pinned, and the agent-based babysitter fully
  # recycled/removed so exactly one babysitter exists after this ticket: the
  # daemon.

  Background:
    Given SWARMFORGE_SKIP_BABYSITTER is not set

  # BL-611 lifecycle-start-stop-01
  Scenario: start-swarm brings up babysitterd and stop-swarm cleans it up
    When start-swarm.sh runs
    Then babysitterd is running with a live pidfile
    When stop-swarm.sh runs
    Then babysitterd is stopped and its pidfile is removed

  # BL-611 double-start-refused-02
  Scenario: a second start is refused while the pidfile is live
    Given babysitterd is already running with a live pidfile
    When start_ancillary_services.sh attempts to start babysitterd again
    Then the second start is refused
    And the original babysitterd process is left running

  # BL-611 kill-all-includes-babysitterd-03
  Scenario: kill_all_swarm terminates babysitterd via its pidfile like the other daemons
    Given babysitterd is running with a live pidfile
    When kill_all_swarm.sh runs
    Then babysitterd is signalled via its pidfile
    And its pidfile is removed

  # BL-611 ensure-restarts-dead-leaves-live-alone-04
  Scenario Outline: swarm ensure restarts a dead babysitterd and leaves a live one alone
    Given babysitterd is <babysitterd state>
    When ./swarm ensure runs
    Then babysitterd ends the tick running
    And <ensure action> occurs

    Examples:
      | babysitterd state | ensure action                    |
      | not running        | a fresh babysitterd is started   |
      | already running     | no restart is performed           |

  # BL-611 pure-check-fires-and-stays-quiet-05
  Scenario Outline: each sweep check fires on its degraded snapshot and stays quiet on green
    Given a green snapshot with no degraded condition
    When the finding-assembly core evaluates it
    Then no finding is produced for <check name>
    Given a snapshot degraded only by <degraded condition>
    When the finding-assembly core evaluates it
    Then exactly the <check name> finding is produced

    Examples:
      | check name                  | degraded condition                                          |
      | live-session-per-role       | a role pane with no live claude process (via ps --ppid)      |
      | remote-control-flag         | a live process missing --remote-control                      |
      | handoffd-supervisor-fresh   | handoffd.log older than 5 minutes                             |
      | dead-letter-nonempty        | a non-empty .swarmforge/handoffs/failed/ box                 |
      | stuck-in-process            | an in_process parcel older than 30 minutes in a worktree mailbox |
      | menu-blocked-pane           | a pane capture showing an interactive menu/dialog             |
      | busy-but-frozen             | an unchanged spinner-stripped content hash across 3 sweeps    |
      | memory-floor                | available memory below the configured floor                  |

  # BL-611 claim-risk-scan-check-11-06
  Scenario: the salvaged claim-progress risk scan runs as check 11
    Given babysitter_assess_lib.bb's existing unit tests
    When they run against the ported deterministic check
    Then they still pass
    And their findings flow through the same severity and nudge contract as the other checks

  # BL-611 rotate-not-honored-check-9-07
  Scenario: an honored-vs-unhonored rotate note is distinguished correctly
    Given the newest completed parcel carries a rotate instruction older than the grace period
    And its target role differs from the active-role file's persona
    And the note is newer than the active-role file's mtime
    When the sweep runs
    Then a CRIT finding names the parcel, expected persona, and actual persona
    Given the active-role file's mtime is newer than that same rotate note
    When the sweep runs again
    Then no CRIT finding is produced for that note

  # BL-611 swarm-starved-check-10-streak-08
  Scenario: swarm-starved requires two consecutive idle sweeps and ignores abandoned parcels
    Given active tickets are present
    And zero pending and zero in_process parcels are counted across master and worktree mailboxes
    And no pane shows a busy footer
    And this is the first such idle sweep
    When the sweep runs
    Then no swarm-starved finding is produced
    Given the same idle condition persists into a second consecutive sweep
    When the sweep runs again
    Then a swarm-starved CRIT finding is produced
    Given the only pending-looking parcels are abandoned or older than 120 minutes
    When the sweep runs
    Then those parcels do not suppress the swarm-starved finding

  # BL-611 planned-pause-suppresses-starvation-checks-17
  Scenario: a planned pause suppresses the starvation checks but an overdue resume is CRIT
    Given a control-pause record marked active whose untilMs has not yet passed
    And a snapshot that would otherwise produce a swarm-starved and a rotate-unhonored finding
    When the sweep runs
    Then no swarm-starved finding is produced
    And no rotate-unhonored finding is produced
    Given a control-pause record still marked active whose untilMs expired more than 15 minutes ago
    When the sweep runs
    Then a resume-overdue CRIT finding is produced

  # BL-611 busy-detection-survives-truncation-6d-09
  Scenario: busy detection survives an 80-column truncated pane capture
    Given a pane capture whose busy-footer hint fragment is truncated away by the terminal width
    And the capture still carries the spinner glyph and elapsed-time pattern
    When the sweep classifies the pane
    Then the pane is classified busy
    And no swarm-starved finding fires from this pane alone

  # BL-611 aged-active-claim-counts-as-motion-6d-10
  Scenario: an aged in_process claim under active work does not read as starvation
    Given an in_process claim older than the aged-claim window
    And the claim's owning worktree resident is verifiably busy
    When the sweep evaluates swarm-starved
    Then this claim does not contribute to a starved finding
    Given a same-aged in_process claim whose owning worktree resident is idle
    And no other motion is present
    When the sweep evaluates swarm-starved
    Then this claim does contribute to a starved finding

  # BL-611 nudge-dedup-cooldown-11
  Scenario: a persistent finding nudges once per cooldown window, then again after it expires
    Given a CRIT finding was nudged less than the cooldown ago
    When the same finding-key recurs on the next sweep
    Then no additional nudge is sent
    Given the cooldown has since expired
    When the same finding-key recurs again
    Then a new nudge is sent

  # BL-611 nudge-skip-coordinator-absent-12
  Scenario: a nudge is skipped and logged when the coordinator pane is down
    Given a CRIT finding is due to nudge
    And the coordinator pane/process is down
    When the nudge step runs
    Then no keystrokes are sent to any pane
    And a NUDGE-SKIP line is logged

  # BL-611 nudge-eligibility-13
  Scenario Outline: nudge eligibility follows severity except for the stuck-* WARN carve-out
    Given a sweep whose only finding is <finding shape>
    When the nudge step runs
    Then exactly <nudge count> nudge is sent

    Examples:
      | finding shape        | nudge count |
      | a CRIT finding        | one         |
      | a stuck-* WARN finding | one        |
      | any other WARN finding | zero       |

  # BL-611 read-only-apart-from-nudge-14
  Scenario: the sweep is read-only apart from the coordinator nudge line
    Given a pane blocked on an interactive menu
    When the sweep runs
    Then a report finding is produced
    And no keystrokes are sent toward the menu

  # BL-611 agent-babysitter-fully-removed-15
  Scenario: the agent-based babysitter is gone and the daemon owns the name
    Given the repo after this ticket lands
    When a repo-wide grep for "babysitter" is run
    Then the only matches are the deterministic daemon, its salvaged pure libraries, docs, and history
    And no babysitter.prompt role, LLM launch path, or wake runtime remains

  # BL-611 status-and-scripts-clean-16
  Scenario: start, stop, and ensure scripts run clean and status reports the live daemon
    When ./start-swarm.sh, ./stop-swarm.sh, and ./swarm ensure run
    Then none of them error on a missing reference to a removed file
    When ./swarm status runs
    Then it reports no row for the retired agent-based babysitter
    And it reports the deterministic babysitterd daemon
