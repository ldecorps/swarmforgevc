Feature: Every current-roster role's context is cleared at its own safe idle boundary

  # BL-316 context-clear-all-roles-01
  Scenario: a non-coordinator role is cleared after finishing a task while idle
    Given a current-roster role just completed a task and is idle
    When the runtime evaluates the context-clear sweep
    Then a clear is injected into that role's pane followed by the startup re-read instruction

  # BL-316 context-clear-all-roles-02
  Scenario: a role holding an in-process task is never cleared
    Given a current-roster role holds an in-process task
    When the runtime evaluates the context-clear sweep
    Then no clear is injected for that role

  # BL-316 context-clear-all-roles-03
  Scenario: a role with a pending inbox item is never cleared
    Given a current-roster role has a pending item in its inbox
    When the runtime evaluates the context-clear sweep
    Then no clear is injected for that role

  # BL-316 context-clear-all-roles-04
  Scenario: a batch role's trigger is its whole batch completing
    Given a batch role's whole batch just landed in inbox/completed/ and the role is idle
    When the runtime evaluates the context-clear sweep
    Then a clear is injected into that role's pane

  # BL-316 context-clear-all-roles-05
  Scenario: a role absent from the current roster is never watched
    Given a role is absent from the current roster
    When the runtime evaluates the context-clear sweep
    Then that role is never cleared

  # BL-316 context-clear-all-roles-06
  Scenario: a clear already issued for a role's completion is not repeated
    Given a clear was already issued for a role's most recent completion
    When the runtime evaluates the context-clear sweep again with no new completion
    Then no second clear is injected for that role
