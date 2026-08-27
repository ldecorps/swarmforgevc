# mutation-stamp: sha256=d150ef3b46914a596f26f9ad92bbc7b44f42662f06ddab87d74e72410115342d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-19T02:05:05.980426Z","feature_name":"subprocess-heavy property tests carry the shared heavy timeout, declared once","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-932-subprocess-heavy-property-tests-share-one-declared-timeout.feature","background_hash":"ad7f9c565269396fa204e80a462534245fe53994aa98bf877ae9e7e87e66fa61","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the two timeout knobs stay distinct","scenario_hash":"a3634bea5815947164fa28aff170e8f61ed722cc82856b01042341bdee0d641b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-19T02:05:05.980426Z"}]}
# acceptance-mutation-manifest-end

Feature: subprocess-heavy property tests carry the shared heavy timeout, declared once

  # BL-932 (swarm-reliability). The property lane runs under its own config
  # (extension/vitest.properties.config.mjs) with its own testTimeout of
  # 20000ms. A property test that spawns a real subprocess inside fc.assert
  # multiplies that cost by numRuns, so BL-871 established the treatment:
  # pass an explicit per-test timeout as test()'s third argument, named
  # SUBPROCESS_HEAVY_TIMEOUT_MS.
  #
  # Two distinct knobs are involved and must not be confused. The INNER
  # spawnSync({ timeout }) bounds one child process. The OUTER test() third
  # argument bounds the whole property - all numRuns of it. Only the outer one
  # is Vitest's; a test can carry a generous inner timeout and still have no
  # outer override at all, which is exactly the reported case.
  #
  # onboarderLauncherPidGuard.property.test.js never received the outer
  # override: 15 runs, each spawning the real launch_onboarder.sh with an
  # inner allowance of 15000ms, all inside the lane's 20000ms default. The
  # single-run inner allowance alone is 75% of the whole test's budget.
  #
  # The constant is currently hand-copied into each adopting file, so the fix
  # must not add a fourth copy.
  #
  # Step handlers: specs/pipeline/steps/bl932SharedHeavyTimeoutSteps.js,
  # parsing the real property-lane test files and config. The <knob> column is
  # validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given the property lane config declares its own suite-wide default timeout

  # BL-932 shared-heavy-timeout-01
  Scenario: the reported test declares an outer per-test timeout
    Given the property test that drives the real launcher once per generated run
    When its test declaration is inspected
    Then it declares an outer per-test timeout as the third argument to test
    And that timeout is the shared heavy-subprocess value

  # BL-932 shared-heavy-timeout-02
  Scenario: the shared value is declared in exactly one place
    When the property lane is searched for the shared heavy-subprocess constant
    Then exactly one declaration of its value exists
    And every test file that uses it imports that single declaration

  # BL-932 shared-heavy-timeout-03
  Scenario Outline: the two timeout knobs stay distinct
    Given the property test that drives the real launcher once per generated run
    When the "<knob>" is inspected
    Then it is still declared explicitly

    Examples:
      | knob                          |
      | inner subprocess timeout      |
      | outer per-test timeout        |

  # BL-932 shared-heavy-timeout-04
  Scenario: the lane-wide default is left alone
    When the property lane config is inspected
    Then its suite-wide default timeout is still 20000 milliseconds
