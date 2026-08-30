Feature: Stamp-off review of Cursor hotfix 2ec06b6ef1 - a dead front-desk feeder must not leave the bridge in queue mode

  Operator/Cursor hotfix 2ec06b6ef1 is live on main with the trailer
  Hotfix-Certification: pending. Shared-token queue mode drained an empty
  file while the bridge heartbeat still looked healthy, so /pilot sat
  unanswered in Telegram with the host silent.

  This is a BL-848 stamp-off. It CONFIRMS OR REFUTES the landed commit; it
  never reimplements or redesigns it. Green scenarios alone never certify -
  only a recorded human decision writes certified or waived into
  backlog/hotfix-ledger.yaml.

  Background:
    Given the landed sources at commit 2ec06b6ef1

  # BL-1253 dead-feeder-owns-getupdates-stamp-01
  Scenario Outline: Queue mode is gated on front-desk feeder liveness
    Given the front-desk poll heartbeat is <heartbeat>
    When the bridge decides how to take inbound updates
    Then the bridge <behaviour>

    Examples:
      | heartbeat | behaviour                |
      | fresh     | consumes the queue       |
      | stale     | owns getUpdates itself   |
      | absent    | owns getUpdates itself   |

  # BL-1253 dead-feeder-owns-getupdates-stamp-02
  Scenario: The liveness decision is re-evaluated on every poll
    Given the bridge started while the front-desk poll heartbeat was fresh
    When the heartbeat goes stale during the run
    Then the bridge owns getUpdates without being restarted

  # BL-1253 dead-feeder-owns-getupdates-stamp-06
  # Carried from retired BL-1260 scenario 03. Scenario 02 above covers
  # fresh -> stale mid-run; this is the mirror, and it is the dangerous
  # direction: a bridge that takes the token and never returns it leaves the
  # front desk permanently dead while every liveness signal reads green.
  Scenario: A recovered feeder gets the token back
    Given the bridge owns getUpdates because the heartbeat was stale
    When the front-desk poll heartbeat becomes fresh again during the run
    Then the bridge returns to consuming the queue without being restarted

  # BL-1253 dead-feeder-owns-getupdates-stamp-03
  Scenario: A malformed heartbeat file is treated as no heartbeat
    Given the front-desk poll heartbeat file cannot be parsed as a heartbeat
    When the bridge decides how to take inbound updates
    Then the bridge owns getUpdates itself

  # BL-1253 dead-feeder-owns-getupdates-stamp-04
  Scenario: The start script does not default to queue mode against a dead feeder
    Given the front-desk inbound feeder is not live at start
    When the bridge start script resolves its inbound queue setting
    Then inbound queue mode is off

  # BL-1253 dead-feeder-owns-getupdates-stamp-05
  Scenario: The ledger row stays pending until a human decides
    Given the review scenarios above are green
    When the stamp-off completes without a recorded human decision
    Then the hotfix ledger row for 2ec06b6ef1 is neither certified nor waived
