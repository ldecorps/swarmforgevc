# mutation-stamp: sha256=d36972149a40b6d7d0e2fdf48db12cbbad6e51aad0b54ab4b3ce7a68c7b4c3d1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T19:37:22.423986Z","feature_name":"swarmforge/scripts temp-root creators stay guarded","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-872-tempdir-trap-guard-standing.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"an unguarded temp-root creator is flagged until it gains a cleanup mechanism","scenario_hash":"ea65c9e2df33bf8da67a9a03969af21761dd5aae3b2d0307ff470e185a319f4f","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-10T19:37:22.423986Z"},{"index":2,"name":"a remediated harness leaves no temp root behind","scenario_hash":"d0fa1578c6215ea93880eb0dc28b17c30af56874f412d0769d2d8bf6799f2146","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-10T19:37:22.423986Z"}]}
# acceptance-mutation-manifest-end

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
