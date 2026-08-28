Feature: BL-1207 the abandoned-lock verdict never depends on which pids the host happens to be running

  isAbandonedAgentLock decides whether a cursor-bridge agent lock may be
  broken. Its malformed-pid case table carries a row whose contents are the
  digits four and two wrapped in spaces, filed under "rejects invalid pid
  values". That value is not invalid: readLockHolderPid trims before parsing,
  so it is a well-formed pid and the verdict falls through to a liveness check
  on whatever process holds it. On any systemd host that pid belongs to a
  root-owned journal daemon, signalling it raises a permission error, the
  holder reads as alive, and the row asserts the opposite of what the host
  reports.

  The row was therefore never testing rejection. On the hosts where it passed
  it passed because that pid happened to be free - an environment fact wearing
  a behaviour assertion's name. This feature separates the two: malformed
  contents are rejected without any process ever being consulted, and a
  well-formed padded pid is judged by liveness alone, against pids the suite
  either owns or has asserted unreachable for itself.

  Background:
    Given the cursor bridge agent lock file at ".swarmforge/operator/cursor-bridge-agent.lock"

  # BL-1207 abandoned-lock-verdict-is-host-independent-01
  Scenario Outline: malformed lock contents are abandoned whatever the host is running
    Given a lock file whose contents are <contents>
    When the abandonment verdict is read for that lock file
    Then the verdict is abandoned
    And no host process was consulted to reach it

    Examples:
      | contents                   |
      | the single digit zero      |
      | the letters abc            |
      | nothing but a newline      |
      | a NUL byte then nine nines |

  # BL-1207 abandoned-lock-verdict-is-host-independent-02
  Scenario Outline: a padded pid is judged by liveness, never by its padding
    Given a lock file whose contents are <pid source> padded with spaces
    When the abandonment verdict is read for that lock file
    Then the verdict is <verdict>

    Examples:
      | pid source                   | verdict       |
      | the running suite's own pid  | not abandoned |
      | the declared unreachable pid | abandoned     |

  # BL-1207 abandoned-lock-verdict-is-host-independent-03
  Scenario: the declared unreachable pid is unreachable on the host running the suite
    When the suite signals the declared unreachable pid with signal zero
    Then the signal reports no such process
    And it neither succeeds nor reports operation not permitted

  # BL-1207 abandoned-lock-verdict-is-host-independent-04
  Scenario: no malformed case names a value the host could be running
    Given the malformed-pid cases as the structured list the verdict test iterates
    When each case's contents are trimmed and parsed as a base ten integer
    Then no case yields a positive integer
