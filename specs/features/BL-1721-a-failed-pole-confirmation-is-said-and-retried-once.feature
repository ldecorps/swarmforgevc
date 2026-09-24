Feature: BL-1721 A failed pole confirmation is said and retried once

  The unit suite's per-file budget guard re-runs a would-be new pole alone
  before refusing it (BL-1633). A confirmation that cannot run returns
  nothing, which counts as over budget. The refusal line then prints only
  the in-suite duration. On 2026-09-24 QA's run at load 10 refused two
  files as new poles. Alone on main they measure 16 ms and 4.2 s, so
  nothing in the refusal told QA or anyone else whether the confirmation
  had measured them slow or had failed. This feature is that the refusal
  says which, that a failed confirmation is tried once more before it
  counts, and that a second failure still refuses.

  Background:
    Given a suite report in which file F ran 10.9 s against the 7.0 s per-file budget and has no pole register row

  # BL-1721 a-failed-confirmation-is-retried-once-01
  Scenario Outline: F's alone confirmation decides the verdict after at most one retry
    Given F's alone confirmations <confirmations>
    When the per-file budget guard judges the report
    Then F is judged <verdict>
    And the guard's line for F names <reported>

    Examples:
      | confirmations                          | verdict      | reported                                            |
      | fail once, then measure 4.2 s          | contention   | the in-suite 10.9 s and the alone 4.2 s             |
      | fail twice                             | a new pole   | the in-suite 10.9 s and both confirmation failures  |
      | measure 8.0 s                          | a new pole   | the in-suite 10.9 s and the alone 8.0 s             |
