Feature: BL-698 Telegram / Cursor Remote operator command surface
  Cursor Remote is the principal phone ops console. Slash verbs share one
  semantic backend with Control/CLI aliases. Bounce/restart/start/redeploy
  re-read swarm.env. Shifts and holidays are operator-policy overlays.
  Documenter ships a how-to and Mermaid diagrams of the Cursor Remote flow.

  Background:
    Given a principal-only Cursor Remote Telegram topic
    And .swarmforge/swarm.env exists with operator keys
    And unauthorised senders and wrong topics never mutate swarm state

  # ── Swarm-up fail-early ─────────────────────────────────────────────

  Scenario: /pilot refuses while the swarm is live
    Given the swarm tmux session or handoffd is live
    When the principal sends "/pilot BL-698"
    Then the bridge refuses without starting a Cursor expedition
    And the reply names what is live

  Scenario: /hydrate refuses when a full-pack role is up
    Given a non-specifier pipeline role session is live
    When the principal sends "/hydrate INTAKE-example.md"
    Then the bridge refuses without starting the specifier-only wake

  # ── Lifecycle verbs ─────────────────────────────────────────────────

  Scenario Outline: Soft lifecycle verbs need a light confirm before run
    When the principal sends "<verb>" in Cursor Remote
    Then the bridge prompts for a single Confirm tap and does not run yet
    When the principal confirms
    Then the verb runs and a short result is posted to the topic

    Examples:
      | verb     |
      | /pull    |

  Scenario: /stop offers drain-stop and emergency-stop modes
    When the principal sends "/stop"
    Then the bridge prompts for stop mode selection
    And only the chosen mode executes after confirm

  # ── Ticket holds ────────────────────────────────────────────────────

  Scenario: /ambulance engages and releases exclusive hold
    When the principal confirms "/ambulance BL-698"
    Then ambulance mode is engaged for BL-698
    When the principal confirms "/ambulance off"
    Then ambulance mode is released

  Scenario: /hold parks to backlog/hold and /reinstate restores
    Given ticket BL-697 lives under backlog/paused/
    When the principal sends "/hold BL-697"
    Then BL-697 is filed under backlog/hold/
    When the principal sends "/reinstate BL-697"
    Then BL-697 is no longer under backlog/hold/

  # ── Batch delivery: /autopilot ──────────────────────────────────────

  Scenario: /autopilot dry lists high-priority specced tickets and defects
    Given live tickets include a high-severity approved item, a defect-typed approved item, and a pending-approval item
    When the principal sends "/autopilot dry"
    Then the reply lists the high-severity approved item
    And the reply lists the defect-typed approved item
    And the reply does not list the pending-approval item
    And no Cursor expedition starts

  # ── Clear the pipe: /land ───────────────────────────────────────────

  Scenario: /land dry lists in-flight tickets only
    Given one ticket in backlog/active/ and one only in backlog/paused/
    When the principal sends "/land dry"
    Then the reply lists the active ticket
    And the reply does not list the paused-only ticket
    And no Cursor expedition starts

  # ── Shared syntax alignment ─────────────────────────────────────────

  Scenario: Control topic accepts the same slash forms as Cursor Remote
    When the principal sends "/ambulance BL-698" in the Control topic
    Then ambulance engages with the same backend as Cursor Remote
