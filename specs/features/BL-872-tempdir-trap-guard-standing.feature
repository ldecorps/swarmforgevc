Feature: swarmforge/scripts temp-root creators stay guarded

  # BL-459 built a cleanup-trap regression guard for the shell and babashka
  # side (the sibling of BL-420's extension-side rawMkdtempGuard), but parked
  # its zero-violation assertion in specs/pipeline/test/ - a directory no
  # standing gate runs. Over the following three weeks 18 files under
  # swarmforge/scripts landed creating temp roots with no cleanup mechanism,
  # among them the PRODUCTION pre-QA gate lib, and nothing went red. Restore
  # the tree to zero violations and give the assertion the same standing home
  # its BL-420 sibling has, so the next unguarded harness fails inside the
  # parcel that introduces it.
  # (SIGKILL/OOM still defeats a trap by design - BL-413's periodic /tmp sweep
  # is the backstop for that, out of scope here, exactly as in BL-459.)

  # BL-872 tempdir-trap-guard-standing-01
  Scenario: the real swarmforge/scripts tree has no unguarded temp-root creator
    Given the scanned tree is the real swarmforge/scripts tree
    When the temp-dir cleanup guard scans that tree
    Then it reports zero violations

  # BL-872 tempdir-trap-guard-standing-02
  Scenario Outline: an unguarded temp-root creator is flagged until it gains a cleanup mechanism
    Given a scanned tree containing a "<file_kind>" file that creates a temp root with no cleanup mechanism
    When the temp-dir cleanup guard scans that tree
    Then it names that file as a violation
    And it reports zero violations once that file gains a cleanup mechanism

    Examples:
      | file_kind |
      | shell     |
      | babashka  |

  # BL-872 tempdir-trap-guard-standing-03
  Scenario Outline: a remediated harness leaves no temp root behind
    Given a remediated "<harness_kind>" harness under swarmforge/scripts
    When it runs to completion
    Then no temp root it created remains, whatever its exit status

    Examples:
      | harness_kind |
      | shell        |
      | babashka     |
