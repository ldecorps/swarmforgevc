Feature: BL-1225 a build-freshness sync's restart leaves a readable trail behind it

  Two forensic gaps in build_freshness_cli.bb, found while diagnosing the
  2026-08-28 phantom crash-loop (BL-1224).

  First, restart-operator-group! spawns the replacement runtime with
  `(process/process {:out (str log-file) :err (str log-file)} ...)`. Passing a
  path string to :out TRUNCATES that file - verified directly: a runtime.log
  holding "PRE-EXISTING" contained only the new process's own output
  afterwards. Every sync therefore erases the stop/start history a post-mortem
  needs, and on a busy merge night the syncs are frequent. The project's own
  normal entry point start_operator_runtime.sh already redirects with `>>`.

  Second, restart-handoffd-group! invokes start_handoff_daemon.sh with no
  caller set, so its audit line reads `caller=unknown`. That script already
  reads SWARMFORGE_DAEMON_START_CALLER and prints whatever it finds; the
  attribution seam exists and nothing uses it. Ten of ten daemon starts in the
  2026-08-28 crash window read `caller=unknown`, and the only way anyone tied
  them to build-freshness was by correlating timestamps by hand.

  # BL-1225 sync-initiated-restart-leaves-a-readable-trail-01
  Scenario: the previous runtime's log lines survive a sync restart
    Given runtime.log holds a line written by the running operator runtime
    When a build-freshness sync restarts the operator runtime
    Then runtime.log still holds that earlier line
    And runtime.log also holds the replacement runtime's own startup line

  # BL-1225 sync-initiated-restart-leaves-a-readable-trail-02
  Scenario: a sync-initiated handoff daemon restart names itself in the start audit
    When a build-freshness sync restarts the handoff daemon
    Then the daemon start audit line names caller "build_freshness_cli"

  # BL-1225 sync-initiated-restart-leaves-a-readable-trail-03
  Scenario: a start that no sync initiated is not attributed to one
    When the handoff daemon is started directly rather than by a sync
    Then the daemon start audit line does not name caller "build_freshness_cli"
