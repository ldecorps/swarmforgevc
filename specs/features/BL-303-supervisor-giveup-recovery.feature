# mutation-stamp: sha256=e95cf18cad5f1ca5fc893950d30c20dbc73da19c560f631a8d3845bcc99289f8
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T22:35:07.707720384Z","feature_name":"The front-desk supervisor recovers a given-up child instead of leaving it down for good","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-303-supervisor-giveup-recovery.feature","background_hash":"0de55aeb10987ba10255630897c337ba8739e81d05c05ae7da2ef96a52797e8a","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a given-up child is re-armed only once the cooldown has passed","scenario_hash":"2718b92a453ca6032443795b2f240bfc61f633b46d7af8a5db23c9cf3bbece6b","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-11T22:35:07.707720384Z"}]}
# acceptance-mutation-manifest-end

Feature: The front-desk supervisor recovers a given-up child instead of leaving it down for good

  Background:
    Given the front-desk supervisor is deciding what to do with a supervised child process

  # BL-303 supervisor-recovery-01
  Scenario: a child that stays healthy long enough has its restart count reset
    Given a child that has run without crashing past the healthy-uptime window
    When the supervisor next checks it
    Then its restart-attempt count is reset to zero

  # BL-303 supervisor-recovery-02
  Scenario Outline: a given-up child is re-armed only once the cooldown has passed
    Given a child the supervisor has given up on
    When the give-up cooldown <elapsed>
    Then the supervisor <action>

    Examples:
      | elapsed | action |
      | has elapsed | resets its attempt count and starts the child again |
      | has not elapsed yet | leaves the child down without restarting it |
