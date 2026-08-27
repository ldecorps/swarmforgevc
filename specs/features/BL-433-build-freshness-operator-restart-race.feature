Feature: A build-freshness sync settles operator_runtime in a single pass

# BL-433 (bug): build_freshness_cli.bb `sync` restarts operator_runtime asynchronously and returns
# before the new process publishes a fresh status.json, and it reports the pre-restart snapshot — so
# operator_runtime keeps reading stale and a second sync pass is always needed. The coordinator has been
# re-syncing on every bookkeeping cycle to work around it. One sync must leave it fresh.
#
# Scenario 04 is the bounded-wait guard: a new process that never comes up must make sync FAIL, not hang
# and not falsely report fresh. Scenario 05 pins that the general fix does not regress the other groups,
# which do not have this race.

Background:
  Given operator_runtime is running on a stale build and main has advanced

# BL-433 build-freshness-operator-restart-race-01
Scenario: A single sync that restarts operator_runtime returns it reading fresh
  When a build-freshness sync runs once
  Then the sync restarts operator_runtime
  And the returned report shows operator_runtime is not stale

# BL-433 build-freshness-operator-restart-race-02
Scenario: The sync report reflects the settled post-restart state
  When a build-freshness sync runs once
  Then the returned report reflects operator_runtime's state after the restart settled
  And not the state captured before the restart

# BL-433 build-freshness-operator-restart-race-03
Scenario: No second sync pass is needed to clear the staleness
  Given a build-freshness sync has run once and restarted operator_runtime
  When a build-freshness report runs immediately afterwards
  Then that separate report also finds operator_runtime fresh

# BL-433 build-freshness-operator-restart-race-04
Scenario: A restarted process that never publishes fresh status fails the sync within a bounded timeout
  Given the restarted operator_runtime never publishes a fresh status
  When a build-freshness sync runs once
  Then the sync exits non-zero within a bounded timeout
  And it does not report operator_runtime as fresh

# BL-433 build-freshness-operator-restart-race-05
Scenario: The sync behaviour of the other process groups is unchanged
  Given the front-desk group and the handoffd group are running on a stale build
  When a build-freshness sync runs once
  Then each of those groups is restarted as it was before
