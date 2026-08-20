# mutation-stamp: sha256=6284ee89b66f04392e659440650fbddb11f7b11afdafd8bc1b0ea047c8e6b9e5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T07:54:04.106628Z","feature_name":"BL-965 heal wrapper temp-file cleanup on kill","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-965-heal-wrapper-temp-file-cleanup-on-kill.feature","background_hash":"d6c2db093821f5921e8c1bec4ad78b91b9251e24457f66658d5df1ed25eef0c8","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a signalled wrapper removes its temp file","scenario_hash":"26ed2297a097a001f7ff3b7d85eaba0c97fb21c3e709c42b3a65c7afe9524b2b","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-20T07:54:04.106628Z"}]}
# acceptance-mutation-manifest-end

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
