Feature: BL-703 operator hydrate, autopilot, and land
  Slice 2 of BL-698. Specifier-only wake, batch pilot, and clear-the-pipe.

  Background:
    Given BL-702 confirm and env-reload foundations are in place
    And a principal-only Cursor Remote Telegram topic

  Scenario: /pilot refuses while the swarm is live
    Given the swarm tmux session or handoffd is live
    When the principal sends "/pilot BL-698"
    Then the bridge refuses without starting a Cursor expedition
    And the reply names what is live

  Scenario: Stop and run confirm may stop then pilot
    Given the swarm is live
    When the principal confirms Stop and run for "/pilot BL-698"
    Then the swarm drain-stops first
    And only then the Cursor expedition for BL-698 starts

  Scenario: /hydrate refuses when a full-pack role is up
    Given a non-specifier pipeline role session is live
    When the principal sends "/hydrate INTAKE-example.md"
    Then the bridge refuses without starting the specifier-only wake

  Scenario: /hydrate wakes specifier only and stops on handoff to coder
    Given the swarm is stopped
    And a pending intake INTAKE-example.md exists
    When the principal confirms "/hydrate INTAKE-example.md"
    Then only the specifier role is started for pipeline work
    And when the specifier sends git_handoff to coder
    Then the swarm drain-stops
    And the coder session is never started

  Scenario: /mint is an alias of /hydrate for intake minting
    When the principal confirms "/mint INTAKE-example.md"
    Then the same specifier-only wake and stop-on-coder-handoff path runs as /hydrate

  Scenario: /autopilot dry lists high-priority specced tickets and defects
    Given live tickets include a high-severity approved item, a defect-typed approved item, and a pending-approval item
    When the principal sends "/autopilot dry"
    Then the reply lists the high-severity approved item
    And the reply lists the defect-typed approved item
    And the reply does not list the pending-approval item
    And no Cursor expedition starts

  Scenario: /autopilot pilots the queue sequentially as Cursor /pilot
    Given two already-specced high-severity tickets ordered by priority
    When the principal confirms "/autopilot"
    Then the Cursor agent pilots the first ticket to completion
    And then pilots the second ticket
    And epics are never selected
    And a concurrent /pilot or /expedite is refused while autopilot is in flight

  Scenario: /land dry lists in-flight tickets only
    Given one ticket in backlog/active/ and one only in backlog/paused/
    When the principal sends "/land dry"
    Then the reply lists the active ticket
    And the reply does not list the paused-only ticket
    And no Cursor expedition starts

  Scenario: /land pilots in-flight tickets out then asks about sleep
    Given two in-flight tickets with parcels in the pipeline
    When the principal confirms "/land"
    Then the Cursor agent pilots each in-flight ticket to done sequentially
    And paused-only tickets are not selected
    And when the in-flight set is empty the bridge asks whether to drain-stop
    And only after that confirm does the swarm drain-stop
    And a concurrent /autopilot /pilot or /expedite is refused while land is in flight
