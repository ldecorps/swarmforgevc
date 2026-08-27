# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T14:29:37.981419090Z","feature_name":"Master-checkout drift mute covers cwd-scoped git add/commit","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.feature","background_hash":"51931620413d7fe21626fa905fe2475514b3f76c512dff8fe3029f07f806a43d","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: Master-checkout drift mute covers cwd-scoped git add/commit
  BL-1134 mutes MASTER CHECKOUT DRIFT WARN while `.git/index.lock` is
  held or a live argv looks like `git add`/`git commit` and literally
  contains the project-root string. Agent commits on main almost always
  run as cwd-scoped `git add` / `git commit` (no `-C`, root absent from
  argv). Those never mute — Alerts still floods false
  "STAGED (index) … handoffd.bb / push_sweep_lib.bb" WARNs (observed
  2026-08-25 15:03 and 15:08) while `check-master-checkout-drift!`
  reports no-drift seconds later. Make in-flight detection cwd-aware for
  this project root. Durable staged reversion with no in-flight signal
  must still alarm (BL-839). Prefer process/lock observation over
  guessing forward vs reversion from blob ancestry.
  Source: human Cursor 2026-08-25 Telegram Alerts + argv classifier probe.

  Background:
    Given the daemons execute scripts from the master checkout's working tree

  # BL-1137 drift-mute-cwd-01
  Scenario: agreement is still silent
    Given every daemon-executed script in the master checkout matches main
    And no commit is in flight on the master checkout
    When the drift check runs
    Then it reports no drift
    And it raises no alarm

  # BL-1137 drift-mute-cwd-02
  Scenario: durable staged reversion with no in-flight signal still alarms
    Given a daemon-executed script is staged for reversion out of main
    And no git add or git commit is in flight on the master checkout
    And no index.lock is present
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1137 drift-mute-cwd-03
  Scenario: staged-vs-main during cwd-scoped git commit is silent
    Given a daemon-executed script's index content differs from main
    And a git commit process is in flight with cwd at the master checkout
    And that process argv does not contain the project-root string
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1137 drift-mute-cwd-04
  Scenario: staged-vs-main during cwd-scoped git add with no index.lock is silent
    Given a daemon-executed script is staged and differs from main
    And index.lock is absent
    And a git add is observably in flight with cwd at this project root
    And that process argv does not contain the project-root string
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1137 drift-mute-cwd-05
  Scenario: git -C this-root still mutes
    Given a daemon-executed script's index content differs from main
    And a git commit process is in flight via git -C this project root
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1137 drift-mute-cwd-06
  Scenario: foreign-cwd git does not mute this root
    Given a daemon-executed script is staged for reversion out of main
    And a git commit is in flight with cwd at a different project
    And no index.lock is present on the master checkout
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1137 drift-mute-cwd-07
  Scenario: mute clears when the in-flight signal is gone
    Given a daemon-executed script is staged for reversion out of main
    And the in-flight git signal has cleared
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1137 drift-mute-cwd-08
  Scenario: the check never writes while deciding the mute
    Given a cwd-scoped git commit is in flight on the master checkout
    When the drift check runs
    Then the master checkout's index and worktree are unmodified by the check
