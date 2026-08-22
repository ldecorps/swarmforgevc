Feature: a basename match at a non-stage backlog path is proven, not asserted

  BL-694's residual-word allowlist excuses a grandfathered ticket file when it
  moves between stage directories. isAllowlisted decides this with
  BACKLOG_STAGE_RE, which requires ^backlog/(active|paused|hold)/, and falls
  through to an exact-path check otherwise. So a file sharing a grandfathered
  basename but living somewhere else under backlog/ — backlog/topics/, say —
  should NOT be excused: the stage regex does not match it and its exact path
  is not on the list.

  bl694ResidualAllowlistSteps.js:75 registers a handler for exactly that claim,
  "a different file with the same basename at a non-stage path under the
  backlog". No scenario ever produces that step text. Outline 04 has two
  Examples rows, "outside the backlog" and "elsewhere in the tree", and neither
  renders to the registered pattern. The handler is dead: registered, never
  matched, never executed.

  The runner throws only on a step with no handler, never on a handler with no
  step, so nothing catches this — the file reads as if the case were covered.
  Neither BL-694's own suite nor the BL-684 rename guard tests it anywhere
  else. The regex looks correct by inspection, and inspection is currently the
  whole of the evidence.

  The narrow fix is to make the claim executable and keep it that way. A
  general "no unreachable step handler in the repo" gate is a real and separate
  piece of work, deliberately not scoped here.

  Background:
    Given a grandfathered ticket file on the residual-word allowlist

  # BL-752 residual-allowlist-nonstage-01
  Scenario: a same-basename file at a non-stage backlog path is reported
    Given a different file with the same basename under backlog/topics
    When the residual-word scan runs
    Then the scan reports the different file as an unexpected match

  # BL-752 residual-allowlist-nonstage-02
  Scenario: the grandfathered file itself is still excused
    Given the grandfathered file sits at a stage path under the backlog
    When the residual-word scan runs
    Then the scan reports no unexpected match

  # BL-752 residual-allowlist-nonstage-03
  Scenario: no residual-allowlist step handler is unreachable
    Given the residual-allowlist step handlers as registered
    When each registered handler is matched against every step the feature renders
    Then every registered handler matches at least one rendered step
