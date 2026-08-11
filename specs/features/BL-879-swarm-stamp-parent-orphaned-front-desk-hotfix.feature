# mutation-stamp: sha256=25e286cfb9feca9cee7cf656910395aae67d796cae8e2e8449c2cb72021a7268
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-11T12:07:13.734265Z","feature_name":"A front-desk leftover that has lost its supervisor is reaped before it can steal the host bridge port","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-879-swarm-stamp-parent-orphaned-front-desk-hotfix.feature","background_hash":"f01265d8de1377d9f0c494faa3dc701981e8355874200272e1a4a04d9639c5d6","implementation_hash":"unknown","scenarios":[{"index":0,"name":"only a front-desk process whose supervisor is provably gone skips the age gate","scenario_hash":"afc44f7c08c54ab46e346243a69129978833ecf8ea9620704e841b529751d6e5","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-11T12:07:13.734265Z"},{"index":2,"name":"no other ancillary class takes the fast path","scenario_hash":"90e34066ae2622d0b7dd25da8e3da8445f90e6e284826d9aa4615c5c9c018839","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-11T12:07:13.734265Z"}]}
# acceptance-mutation-manifest-end

Feature: A front-desk leftover that has lost its supervisor is reaped before it can steal the host bridge port
  On 2026-08-10 the production front-desk bridge crash-looped on port 8765 and
  tripped two supervisor give-up emails while the orphan janitor was already
  enumerating the culprits: disposable-root `start-bridge-headless.js` /
  `telegram-front-desk-bot.js` leftovers reparented to launchd (PPID 1). They
  were candidates, but `reapable-tmp-ancillary?` required the multi-hour age
  gate, so every sweep logged `reaped 0`. The human-landed fix reaps a
  parent-orphaned front-desk bridge/bot immediately; everything else keeps the
  age gate. This ticket stamps that fix off.

  Background:
    Given a host running the orphan janitor sweep

  # BL-879 parent-orphaned-front-desk-01
  Scenario Outline: only a front-desk process whose supervisor is provably gone skips the age gate
    Given an ancillary process running under a disposable root
    And its command line names the front-desk bridge or bot
    And it is younger than the ancillary age gate
    And its parent process is <parent state>
    When the sweep runs
    Then the process is <outcome>

    Examples:
      | parent state      | outcome    |
      | gone              | reaped     |
      | alive             | not reaped |
      | not determinable  | not reaped |

  # BL-879 parent-orphaned-front-desk-02
  Scenario: a fast-path reap is audited with its reason
    Given an ancillary process running under a disposable root
    And its command line names the front-desk bridge or bot
    And it is younger than the ancillary age gate
    And its parent process is gone
    When the sweep runs
    Then the audit line for that reap carries the parent-orphaned front-desk reason

  # BL-879 parent-orphaned-front-desk-03
  Scenario Outline: no other ancillary class takes the fast path
    Given an ancillary process running under a disposable root
    And its command line names <ancillary>
    And it is younger than the ancillary age gate
    And its parent process is gone
    When the sweep runs
    Then the process is not reaped

    Examples:
      | ancillary           |
      | a babysitter daemon |
      | the tmux binary     |

  # BL-879 parent-orphaned-front-desk-04
  Scenario: a front-desk process with no disposable root is never reaped, orphaned or not
    Given a process with no extractable disposable root
    And its command line names the front-desk bridge or bot
    And its parent process is gone
    When the sweep runs
    Then the process is not reaped
    And no reap decision is taken against it

  # BL-879 parent-orphaned-front-desk-05
  Scenario: the live window set outranks the fast path
    Given an ancillary process running under a disposable root
    And its command line names the front-desk bridge or bot
    And its parent process is gone
    And the process is in the live window set
    When the sweep runs
    Then the process is not reaped
