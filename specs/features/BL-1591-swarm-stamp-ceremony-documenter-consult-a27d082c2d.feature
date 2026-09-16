Feature: BL-1591 Stamp-off review of the ceremony documenter consult-session hotfix

  BL-848 review-only certification of landed commit a27d082c2d (2026-09-16).
  The night closing ceremony's rotate-documenter step called
  rotate_to_role.sh documenter, the resident-invoked rotation entry that
  respawn-as! (BL-805) refuses whenever the resident holds an undrained
  in_process parcel - the normal case mid-work overnight. The old fallback
  sent a plain note to the coordinator, which cannot respawn a pane it does
  not own, so the documenter never got a session and no briefing was written
  on 2026-09-15 or 2026-09-16 (ceremony state "rotate-documenter" ->
  "briefing-missing" -> "swarm-stopped"). The hotfix spawns the documenter's
  OWN roles.tsv session on a refused rotation through a new standalone
  consult_spawn_cli.bb, which writes the same consult marker handoffd.bb's
  existing consult-teardown-sweep! already manages.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1591 swarm-stamp-ceremony-documenter-consult-01
  # Census pin (BL-1445): the three test names are asserted literally.
  Scenario: the real rotate-documenter fallback test passes and names its three cases
    When the rotate-documenter fallback vitest file runs against the compiled ceremony tool
    Then it reports three tests passed and none failed
    And its passing tests are named a refused rotation spawns documenter its own ephemeral session, a successful direct rotation never triggers a consult spawn, and spawnConsultDocumenter is independently exercised

  # BL-1591 swarm-stamp-ceremony-documenter-consult-02
  Scenario: the consult spawn CLI shell test passes, names its four checks, and is a standing suite member
    When the consult spawn CLI shell test runs with its fake tmux
    Then it reports every check passed
    And its passing checks include cases 01 through 04
    And the shell suite manifest lists test_consult_spawn_cli.sh as standing

  # BL-1591 swarm-stamp-ceremony-documenter-consult-03
  Scenario Outline: the CLI spawns once, refuses to race, and never fabricates a session
    Given a fixture root where the documenter's <state>
    When consult_spawn_cli.bb runs for that role requested by coordinator
    Then it prints status <status> and exits <exit>
    And it issues <spawns> new-session commands

    Examples:
      | state                                    | status             | exit | spawns |
      | session is absent and no marker exists   | spawned            | 0    | 1      |
      | session is live                          | already-exists     | 0    | 0      |
      | session is gone but a marker exists      | already-consulting | 0    | 0      |
      | roles.tsv row is missing                 | no-such-role       | 1    | 0      |

  # BL-1591 swarm-stamp-ceremony-documenter-consult-04
  Scenario: a marker the CLI wrote is torn down by the daemon's existing sweep
    Given a consult marker written by consult_spawn_cli.bb for a role whose session is live, whose pane is idle, and whose mailbox is empty
    When the consult teardown sweep runs
    Then the session is killed
    And the marker is cleared

  # BL-1591 swarm-stamp-ceremony-documenter-consult-05
  # Undecided means: state is neither certified nor waived, human_decision
  # is null and decided_at is null. The row moves pending -> stamp-open the
  # moment the mint links the stamp ticket, so the literal state pending is
  # unreachable from inside the parcel (BL-1560 cleaner D1, 2026-09-14).
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit carries no human decision
