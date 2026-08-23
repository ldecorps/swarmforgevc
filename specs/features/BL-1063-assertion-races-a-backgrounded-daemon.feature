Feature: BL-1063 an assertion about a backgrounded child waits for that child
  `start_handoff_daemon.sh` backgrounds the daemon and returns immediately. The
  property test reads a marker file that backgrounded child writes, with no wait
  and no poll, so the read races the child. The race is real on an idle host and
  widens under contention - this is the one file in the reported set where
  "flaky under worktree load" is the accurate diagnosis. A fixed sleep is not
  the fix: it trades a race for a slower race.

  The same property carries a second, independent defect. It is named "both bb
  and node RESOLVE, however minimal the caller PATH" - a claim about
  resolvability - but it asserts node resolved from the fake nvm tree, a claim
  about which branch answered. operator_path_lib.sh reaches nvm only as a
  fallback, and is required never to shadow a node the caller's PATH already
  resolves. So on any host carrying a system node the assertion is red exactly
  because the production code is correct, and it contradicts the no-shadow
  invariant the same lib is built to honour.

  The two are coupled: repairing the wait alone leaves the file red on the very
  next line, so the race fix by itself would ship looking failed.

  # BL-1063 backgrounded-child-wait-01
  Scenario: the assertion waits for the child's marker
    Given a launcher that backgrounds a daemon which writes a marker file
    When the test asserts on that marker
    Then it waits for the marker under a bounded deadline before asserting

  # BL-1063 backgrounded-child-wait-02
  Scenario: a child that never writes fails on the deadline, not on a race
    Given a backgrounded daemon that never writes its marker
    When the test asserts on that marker
    Then the test fails only after the bounded deadline elapses
    And the failure names the marker that never appeared

  # BL-1063 backgrounded-child-wait-03
  Scenario: the wait is bounded and returns early
    When the wait is inspected
    Then it polls under a declared maximum deadline
    And it returns as soon as the marker appears

  # BL-1063 resolvability-not-origin-04
  Scenario Outline: invariant 1 is satisfied wherever node legitimately resolves
    Given a caller PATH on which node "<caller_resolves>"
    When the launched daemon's PATH is checked against invariant 1
    Then node resolves for the daemon
    And the check is satisfied by "<origin>"

    Examples:
      | caller_resolves | origin              |
      | resolves        | the caller's node   |
      | does not resolve | the nvm fallback   |

  # BL-1063 never-asserts-a-forbidden-branch-05
  Scenario: the test never demands the branch the lib is forbidden to take
    Given a caller PATH that already resolves node
    When the launched daemon's PATH is checked against invariant 1
    Then the caller's own node is accepted
    And the nvm fallback is not required

  # BL-1063 host-independent-verdict-06
  Scenario Outline: the file's verdict does not depend on what the host happens to have installed
    Given a host that "<host>" a system node
    When the property file is run
    Then invariant 1 passes

    Examples:
      | host    |
      | carries |
      | lacks   |
