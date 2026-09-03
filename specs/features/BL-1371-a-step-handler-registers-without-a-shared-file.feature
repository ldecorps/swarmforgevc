Feature: A step handler registers without a shared file

  Every acceptance step handler in this project is registered by appending a
  `require('./blNNNSteps')` line to one hand-maintained array in
  `specs/pipeline/steps/index.js`. That array is now 936 entries long, and every
  ticket that adds a scenario edits it.

  One shared file touched by every ticket couples them at every gate. Three
  distinct incident classes have come out of it, all observed:

  - The Article 4.2 sweep charges every merge-up with this path, because it is
    the file both sides of a merge always touched (BL-1359).
  - A land-replay leaked an unlanded sibling's require line into it and blocked
    every commit to main until it was found (BL-1324).
  - A land escalates because two BLOCKED tickets' require lines sit in the same
    file as the approved one trying to land (BL-1356, 2026-09-03).

  None of those is a bug in the gates. Each gate is correctly reporting that a
  shared file carries another ticket's work. The coupling is the cause.

  A handler discovered from its own file needs no shared edit at all.

  Background:
    Given the acceptance runner loads this project's step handlers

  # BL-1371 a-step-handler-registers-without-a-shared-file-01
  Scenario: a new handler is loaded without editing a shared file
    Given a new step handler file is added to the steps directory
    When the runner loads the handlers
    Then that handler's steps are available
    And no file another ticket also edits was changed to achieve it

  # BL-1371 a-step-handler-registers-without-a-shared-file-02
  Scenario: every handler loaded today is still loaded
    When the runner loads the handlers
    Then every handler the registry loads today is present

  # BL-1371 a-step-handler-registers-without-a-shared-file-03
  Scenario: a file that is not a step handler is not loaded
    Given a file in the steps directory that exports no steps
    When the runner loads the handlers
    Then that file contributes no steps

  # BL-1371 a-step-handler-registers-without-a-shared-file-04
  Scenario: a handler that cannot be loaded fails the run
    Given a step handler file that throws when required
    When the runner loads the handlers
    Then the run fails naming that file
    And no scenario is reported as passing

  # BL-1371 a-step-handler-registers-without-a-shared-file-05
  Scenario: both runners find handlers the same way
    Given a new step handler file is added to the steps directory
    When each runner resolves its handlers
    Then the acceptance runner and the Gherkin mutation runner load the same handler set
