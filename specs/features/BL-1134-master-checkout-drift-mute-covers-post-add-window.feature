# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T13:39:34.692355147Z","feature_name":"Master-checkout drift mute covers the post-add staged window","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1134-master-checkout-drift-mute-covers-post-add-window.feature","background_hash":"51931620413d7fe21626fa905fe2475514b3f76c512dff8fe3029f07f806a43d","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: Master-checkout drift mute covers the post-add staged window
  BL-1122 mutes MASTER CHECKOUT DRIFT WARN only while `.git/index.lock`
  exists. After `git add` the lock is gone but the index still differs from
  `main` until `git commit` finishes — Alerts still gets false
  "STAGED (index) … handoffd.bb / push_sweep_lib.bb" WARNs (observed
  2026-08-25 14:07 and 14:12) while `master_checkout_drift_cli` reports
  no-drift seconds later. Widen the in-flight detector beyond index.lock
  (live `git add`/`git commit` against this repo, and/or equivalent
  read-only observation) so the whole add→commit window is silent for
  `:staged-for-reversion`. Durable staged reversion with no in-flight
  signal must still alarm (BL-839). Prefer process/lock observation over
  guessing forward vs reversion from blob ancestry (BL-1122 notes).
  Source: human Cursor 2026-08-25 Telegram Alerts screenshot + live CLI.

  Background:
    Given the daemons execute scripts from the master checkout's working tree

  # BL-1134 drift-mute-post-add-01
  Scenario: agreement is still silent
    Given every daemon-executed script in the master checkout matches main
    And no commit is in flight on the master checkout
    When the drift check runs
    Then it reports no drift
    And it raises no alarm

  # BL-1134 drift-mute-post-add-02
  Scenario: durable staged reversion with no in-flight signal still alarms
    Given a daemon-executed script is staged for reversion out of main
    And no git add or git commit is in flight on the master checkout
    And no index.lock is present
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1134 drift-mute-post-add-03
  Scenario: staged-vs-main during a live git commit is silent
    Given a daemon-executed script's index content differs from main
    And a git commit process is in flight against the master checkout
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1134 drift-mute-post-add-04
  Scenario: staged-vs-main after git add with no index.lock is silent while add/commit is observable
    Given a daemon-executed script is staged and differs from main
    And index.lock is absent
    And a git add or git commit is observably in flight against this repo
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1134 drift-mute-post-add-05
  Scenario: mute clears when the in-flight signal is gone
    Given a daemon-executed script is staged for reversion out of main
    And the in-flight git signal has cleared
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1134 drift-mute-post-add-06
  Scenario: the check never writes while deciding the mute
    Given a git commit is in flight on the master checkout
    When the drift check runs
    Then the master checkout's index and worktree are unmodified by the check
