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

  Scenario: Stop & run confirm may stop then pilot
    Given the swarm is live
    When the principal confirms Stop & run for "/pilot BL-698"
    Then the swarm drain-stops first
    And only then the Cursor expedition for BL-698 starts

  Scenario: /hydrate refuses when a full-pack role is up
    Given a non-specifier pipeline role session is live
    When the principal sends "/hydrate INTAKE-example.md"
    Then the bridge refuses without starting the specifier-only wake

  # ── Guards ──────────────────────────────────────────────────────────

  Scenario: Unauthorised sender cannot run a hard-tier verb
    When an unauthorised user sends "/restart" in Cursor Remote
    Then the bridge refuses with no bounce sentinel written

  Scenario: Hard-tier verb outside Cursor Remote (or aligned Control) is ignored
    When the principal sends "/kill-all" in a non-ops topic
    Then no kill or drain runs

  Scenario: Hard-tier verb requires confirm before execute
    When the principal sends "/ensure" in Cursor Remote
    Then the bridge prompts for confirmation and does not run ensure yet
    When the principal confirms
    Then ensure runs single-flight and a summary is posted

  Scenario: /confirm-off clears a pending hard confirm
    Given a pending "/bounce" confirm
    When the principal sends "/confirm-off"
    Then the pending confirm is cleared and no bounce runs

  # ── Env reload ──────────────────────────────────────────────────────

  Scenario: /restart relaunches after re-reading swarm.env
    Given swarm.env defines a key that the current host process.env lacks
    When the principal confirms "/restart"
    Then the relaunch child environment includes that key from swarm.env

  Scenario: /bounce bridge reloads swarm.env like /redeploy
    When the principal confirms "/bounce bridge"
    Then the cursor bridge supervisor child is started with swarm.env merged

  Scenario: /syncenv reports key presence without values
    When the principal sends "/syncenv"
    Then the reply names required keys as present or missing
    And the reply body contains no secret values

  # ── Lifecycle verbs ─────────────────────────────────────────────────

  Scenario Outline: Soft lifecycle verbs need a light confirm before run
    When the principal sends "<verb>" in Cursor Remote
    Then the bridge prompts for a single Confirm tap and does not run yet
    When the principal confirms
    Then the verb runs and a short result is posted to the topic

    Examples:
      | verb     |
      | /compile |
      | /pull    |
      | /doctor  |
      | /tunnel  |

  Scenario: /drain-agents is distinct from /kill-all
    When the principal confirms "/drain-agents"
    Then roles drain gracefully and daemons remain up
    When the principal confirms "/kill-all"
    Then the hard kill path runs

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

  # ── Shifts & holidays ───────────────────────────────────────────────

  Scenario: Holiday quiet refuses pilot/expedite with Run anyway
    Given a holiday covering today is recorded
    When the principal sends "/pilot BL-698"
    Then the bridge refuses citing holiday quiet
    And the reply offers a Run anyway confirm
    When the principal confirms Run anyway
    Then the pilot path may proceed

  Scenario: Shift and holiday state round-trip under operator runtime
    When the principal sends "/holiday add 2099-01-01 2099-01-02 maintenance"
    And the principal sends "/holiday list"
    Then the list includes that range
    When the principal sends "/shift start evening"
    And the principal sends "/shift status"
    Then status reports the active shift
    And durable state is only under .swarmforge/operator/

  Scenario: /oncall me routes alerts to the principal
    When the principal sends "/oncall me"
    Then subsequent ambulance and ensure alerts target that oncall id

  # ── Prep pass: /hydrate and /mint ───────────────────────────────────

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

  # ── Batch delivery: /autopilot ──────────────────────────────────────

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

  # ── Clear the pipe: /land ───────────────────────────────────────────

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

  # ── Shared syntax alignment ─────────────────────────────────────────

  Scenario: Control topic accepts the same slash forms as Cursor Remote
    When the principal sends "/ambulance BL-698" in the Control topic
    Then ambulance engages with the same backend as Cursor Remote

  # ── Documenter deliverables ─────────────────────────────────────────

  Scenario: How-to and Cursor Remote diagrams exist
    Then docs/how-to/BL-698-telegram-cursor-operator-commands.md exists
    And docs/diagrams/cursor-remote-flow.mmd exists
    And docs/diagrams/operator-command-surface.mmd exists
    And the how-to links the diagrams and the danger-tier command map
