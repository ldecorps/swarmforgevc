Feature: BL-1730 A property worker that dies on the heap cap names its file

  The property lane runs each file in a forked worker under a V8 heap cap.
  BL-1651 added a per-file heap ceiling, checked after each test, so a heavy
  file fails by name before it reaches the cap. A test that goes past the
  cap between two such checks never reaches the next one: V8 aborts the
  worker, and vitest reports only "Channel closed" and
  ERR_IPC_CHANNEL_CLOSED, with no file named. On 2026-09-25 that anonymity
  cost two hand bisections, 77 files run one at a time, to find the two
  files BL-1729 fixes. This feature is that the death names the file, both
  in the lane's output and in the property guard's refusal log.

  Background:
    Given two fixture property files that run together in the property lane under a small worker heap cap
    And one of them allocates past the cap inside a single test

  # BL-1730 the-lane-names-the-file-whose-worker-died-01
  Scenario: the lane output names the file whose worker died
    When the property lane runs the two fixture files
    Then the lane output names the file that allocated past the cap as the one whose worker died
    And the lane output does not name the other file as one whose worker died

  # BL-1730 the-refusal-log-names-the-file-whose-worker-died-02
  Scenario: the property guard's refusal log names the file whose worker died
    When the property suite guard runs the lane over the two fixture files and refuses the commit
    Then the refusal log names the file that allocated past the cap as the one whose worker died
