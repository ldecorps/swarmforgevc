Feature: BL-1689 the pipeline kill and the start owner reap every supervisor for their root

  The pipeline kill signals the supervisor named in the pid file and its
  stray reaper excludes supervisors on purpose; the start owner stops
  pid-file owners only. A supervisor that lost its pid file survived both
  on 2026-09-21 and ran a second BL-1492 ladder on the same root for 44
  minutes. Both now reap every supervisor and daemon process whose command
  line names their root, tracked or not, and never a sibling root's.

  Background:
    Given a fixture project root under a temporary directory with a daemon directory
    And two fake supervisor processes for the fixture root, one named by the pid file and one absent from every pid file
    And a fake supervisor process for a sibling root under the same parent directory

  # BL-1689 reap-every-supervisor-for-root-01
  Scenario: the pipeline kill reaps the tracked and the untracked supervisor and spares the sibling root's
    When the pipeline kill's daemon reaper runs for the fixture root
    Then both fixture-root supervisor processes are gone
    And the sibling root's supervisor process is still alive
    And the kill audit names each reaped pid once

  # BL-1689 reap-every-supervisor-for-root-02
  Scenario: the start owner reaps an untracked supervisor before launching a new pair
    Given the start owner's daemon command is replaced by a recorded fake that never launches a daemon
    When the start owner is invoked with the caller "swarmforge.sh"
    Then the untracked fixture-root supervisor process is gone before the recorded fake is launched
    And the sibling root's supervisor process is still alive
