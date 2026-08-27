Feature: unit-test temp dirs are cleaned up at the source, bounding /tmp growth

  # The /tmp leak's GENERATOR: ~147 extension test files call
  # fs.mkdtempSync(os.tmpdir(), 'sfvc-*'/'relay-*'/'negotiate-*') per test and
  # never remove them — ~42 dirs/sec while tests run, ~1M entries/day even after
  # a sweep. A shared temp-dir helper that auto-removes its own dir on teardown
  # bounds the flow at the source. (Assert the SPECIFIC created path, never a
  # /tmp listing — the shared-global-directory flake rule.)

  Background:
    Given a test that allocates a temp directory through the shared temp-dir helper

  # BL-420 test-helpers-clean-up-tmp-dirs-01
  Scenario: the helper removes the exact directory it created when teardown runs
    Given the helper created a temp directory for the test
    When the test's teardown runs
    Then that exact directory no longer exists

  # BL-420 test-helpers-clean-up-tmp-dirs-02
  Scenario: the temp directory is cleaned up even when the test body throws
    Given the test body throws after the helper created its temp directory
    When teardown runs
    Then that exact directory no longer exists

  # BL-420 test-helpers-clean-up-tmp-dirs-03
  Scenario: every suite temp-dir allocation routes through the helper
    Given a scan of the extension test suite for raw os.tmpdir mkdtemp calls
    When the scan runs
    Then no test allocates an os.tmpdir temp directory outside the shared helper
