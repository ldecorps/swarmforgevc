Feature: BL-965 heal wrapper temp-file cleanup on kill

  BL-960's composed wrapper captures command output into a mktemp file and
  removes it only on its tail path, so a kill mid-run leaks one
  ${TMPDIR}/sfh.* file per killed command. The wrapper must clean up its
  own temp file on every catchable termination without changing anything
  else observable.

  Background:
    Given a fixture TMPDIR and a composed heal wrapper for a long-running command

  # BL-965 wrapper-temp-cleanup-01
  Scenario Outline: a signalled wrapper removes its temp file
    Given the wrapped command is running and its capture file exists in the fixture TMPDIR
    When the wrapper process receives <signal>
    Then the fixture TMPDIR contains no sfh.* file afterward

    Examples:
      | signal  |
      | SIGTERM |
      | SIGINT  |
      | SIGHUP  |

  # BL-965 wrapper-temp-cleanup-02
  Scenario: normal completion stays byte-identical and residue-free
    Given the wrapped command runs to completion
    Then the wrapper's exit code and combined output are byte-identical to the unwrapped command's
    And the fixture TMPDIR contains no sfh.* file afterward
