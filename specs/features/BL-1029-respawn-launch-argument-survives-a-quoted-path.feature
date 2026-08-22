Feature: every respawn path's launch argument survives a quote-bearing install path

  BL-1029: tmux hands a respawn-pane's trailing argument to `$SHELL -c`, so
  that argument must itself be valid POSIX shell. Seven repair sites build it
  by wrapping the persisted launch-script path in a bare pair of single
  quotes, which stops being valid the instant the path contains an apostrophe
  — a real shape for a macOS home directory. BL-1018 fixed exactly one member
  of that family (`single_role_repair_lib.bb`) and left the rest untouched.

  This slice sweeps the family: the quoting becomes one shared thing every
  respawn site goes through, and the argument is verified by running it
  through a real shell rather than by matching text against it.

  # BL-1029 respawn-launch-argument-survives-a-quoted-path-01
  Scenario Outline: a launch path round-trips through a real shell unchanged
    Given a persisted launch script at path <launch path>
    When a respawn command's launch argument is constructed for it
    Then evaluating that argument in a real shell recovers exactly <launch path>

    Examples:
      | launch path                                 |
      | /Users/plain/.swarmforge/launch/coder.sh    |
      | /Users/O'Brien/.swarmforge/launch/coder.sh  |
      | /Users/two words/.swarmforge/launch/$role.sh|

  # BL-1029 respawn-launch-argument-survives-a-quoted-path-02
  Scenario: no respawn site quotes a launch path on its own
    Given the swarm scripts tree
    When every respawn launch-argument construction is enumerated from that tree
    Then each one is produced by the shared quoting helper
    And none interpolates a launch path directly into a quoted shell string

  # BL-1029 respawn-launch-argument-survives-a-quoted-path-03
  Scenario: the enumeration is not vacuous
    Given the swarm scripts tree
    When every respawn launch-argument construction is enumerated from that tree
    Then at least one construction site is found
