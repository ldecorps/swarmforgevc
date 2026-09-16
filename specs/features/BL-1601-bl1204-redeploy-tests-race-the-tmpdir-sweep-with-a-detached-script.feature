Feature: BL-1601 The redeploy tests wait for their detached script and the tmpDir sweep survives a racing writer

  The two BL-1204 redeploy tests spawn the real redeploy script detached
  and return before it writes its marker into the fixture root, so the
  afterEach tmpDir sweep's recursive removal races the write and fails
  ENOTEMPTY - sighted five times since 2026-09-05 and never owned. This
  feature is that a test which spawns a detached writer waits for its
  marker before returning and asserts it, that the sweep retries a removal
  a writer races and still rethrows when the root never empties, and that
  exactly the two spawning tests carry the wait.

  # BL-1601 redeploy-tests-await-the-marker-01
  Scenario: a test that spawns a detached writer sees the marker before its teardown
    Given a fixture root and a stub script that sleeps 300 ms and then writes a marker into that root
    When the script is spawned detached the way the redeploy modules spawn it and the test waits for the marker with a 2000 ms bound
    Then the marker exists before the wait returns
    And the pending tmpDir sweep removes the root without error

  # BL-1601 redeploy-tests-await-the-marker-02
  Scenario Outline: the tmpDir sweep retries a removal a writer races and fails closed when the root never empties
    Given a pending tmpDir root whose removal <behaviour>
    When the pending tmpDir sweep runs
    Then <outcome>

    Examples:
      | behaviour                                                        | outcome                                                          |
      | fails ENOTEMPTY twice and then succeeds                          | the sweep returns the root removed, after 3 attempts             |
      | fails ENOTEMPTY on every attempt                                 | the sweep rethrows ENOTEMPTY after its bounded attempts           |
      | succeeds on the first attempt                                    | the sweep returns the root removed, after 1 attempt              |

  # BL-1601 redeploy-tests-await-the-marker-03
  Scenario: exactly the two BL-1204 spawning tests assert their marker after the dispatch
    When the source of extension/test/telegramCursorOperatorExec.test.js is read
    Then exactly 2 tests in it spawn a redeploy script through executeOperatorVerb
    And each of those 2 tests waits for its marker and asserts it exists before the test returns
