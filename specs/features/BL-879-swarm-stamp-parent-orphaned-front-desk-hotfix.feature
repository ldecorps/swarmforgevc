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
