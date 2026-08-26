Feature: A standing Recert topic is where the human recertifies Gherkin scenarios in-chat

  # BL-450 (feature, human-requested via Operator/Telegram 2026-07-16, restated twice):
  # move Gherkin recertification FULLY out of the PWA into its own standing "Recert"
  # Telegram topic, where the human validates / amends / deletes recert scenarios in-chat.
  # This is the FULL-MOVE shape and is DISTINCT from BL-339 (notify + PWA deep-link, already
  # shipped) - the human does NOT want the deep-link-only option. Sibling in intent to BL-434
  # (Approvals standing topic); reuse its standing-topic + id-bound-reply-routing scaffolding.
  #
  # WHY THIS IS "CLOSE THE LOOP", NOT JUST "MOVE THE UI" (grounded in code 2026-07-16): the
  # entire recert verdict loop is DARK today. recert-state.json has NO production writer
  # (writeRecertStore / confirmScenario / applyAcceptedProposal have zero live callers); the
  # PWA's Confirm/Update/Delete verbs are mailto-only; bridge-recert-proposals.ts is an
  # unwired manual CLI; recert_proposals/<month>.jsonl is a write-only audit trail with no
  # consumer. So the queue never advances - it re-presents the same oldest-first batch until
  # docs change. The front-desk bot runs ON-HOST with direct .swarmforge/ access, so this
  # feature becomes the FIRST end-to-end writer of recert-state.json (validate) and the first
  # live producer of the recert_proposals queue (amend/delete) - no email/webhook hop needed.
  # This is the runtime-wiring slice the epic-wiring rule requires for those dark modules.
  #
  # HUMAN-CHOSEN SHAPE (AskUserQuestion, 2026-07-16):
  #   - PWA fate: RETIRE the PWA recert view (tracked separately as BL-451, which also retires
  #     BL-339's now-dead deep-link notify; sequence BL-451 AFTER this loop is proven live).
  #   - Flow: ONE SCENARIO AT A TIME, conversationally - post the oldest-unreviewed scenario;
  #     after the human acts, the queue advances and the next-oldest is posted. This mirrors the
  #     PWA's single-scenario view and avoids the per-scenario spam BL-339 warned about (a
  #     17-scenario batch must NOT produce 17 messages). Edge-triggered: never re-post the same
  #     scenario every tick.
  #   - Amend/delete gate: validate APPLIES DIRECTLY (a last-reviewed timestamp bump, low risk);
  #     amend/delete become a PROPOSAL the specifier reviews before the durable .feature contract
  #     changes. This finally wires up the existing recert_proposals queue and keeps a human gate
  #     on editing the acceptance contract from a chat reply.
  #
  # VERB MAPPING to existing outcomes: validate = confirm (recertification.ts confirmScenario);
  # amend = update proposal (RecertProposal outcome "update", newText from the reply); delete =
  # delete proposal (outcome "delete", confirmation-gated per BL-150 recert-04). Reuse
  # confirmScenario + writeRecertStore + appendRecertProposal; do NOT invent a second recording
  # path. When an accepted amend is later APPLIED into a .feature file (specifier review, out of
  # this ticket's scope), that write sanitizes the external text per the engineering
  # external-text-into-structured-files rule (BL-409); the JSONL append here is JSON-escaped and
  # safe.
  #
  # Scope (verify at build time): the standing Recert topic is created once alongside the
  # Operator topic (telegram-front-desk-bot.ts ensureOperatorTopic / core
  # decideEnsureOperatorTopicAction) and registered for icon sync
  # (conciergeTick.ts standingTopicTargets, BL-418). Posting the current oldest scenario one at
  # a time, edge-triggered off a durable posted-scenario marker, is driven off computeRecertBatch
  # (recertificationStore.ts) the way BL-434 posts asks into a standing topic from conciergeTick.
  # Reply recognition + verb routing is a new Recert-topic branch in
  # telegramFrontDeskBotCore.ts decideUpdateAction plus a recert verb classifier (sibling of
  # classifyApprovalReplyAction); binding the Recert topic id so a reply is NOT mistaken for a
  # throwaway SUP support thread. Exact reply grammar, the posted-scenario message shape, and the
  # delete-confirmation mechanism (follow-up reply vs inline button, BL-410) are resolved at
  # build time; the scenarios below fix the behavior, not the wording.

  Background:
    Given a standing Recert topic exists

  # BL-450 recert-telegram-01
  Scenario: The oldest un-reviewed scenario is posted into the Recert topic, one at a time
    Given scenarios need recertification
    When the recert posting runs
    Then the oldest un-reviewed scenario is posted in the Recert topic
    And no other scenario is posted at the same time

  # BL-450 recert-telegram-02
  Scenario: An already-posted scenario is not re-posted on the next tick
    Given the oldest un-reviewed scenario has already been posted in the Recert topic
    When the recert posting runs again with that scenario still the oldest
    Then the scenario is not posted again

  # BL-450 recert-telegram-03
  Scenario: Validating a scenario advances its last-reviewed timestamp and leaves the queue
    Given scenario "BL-207-thing-01" is posted in the Recert topic for recertification
    When the human replies "validate BL-207-thing-01" in the Recert topic
    Then scenario "BL-207-thing-01"'s last-reviewed timestamp is advanced to now
    And scenario "BL-207-thing-01" leaves the recertification queue

  # BL-450 recert-telegram-04
  Scenario: Amending a scenario queues an update proposal for specifier review, not a direct edit
    Given scenario "BL-207-thing-01" is posted in the Recert topic for recertification
    When the human replies to amend "BL-207-thing-01" with new scenario text in the Recert topic
    Then an update proposal for "BL-207-thing-01" carrying the new text is queued for specifier review
    And the scenario's feature file is not edited directly

  # BL-450 recert-telegram-05
  Scenario: Deleting a scenario requires an explicit in-chat confirmation before anything is queued
    Given scenario "BL-207-thing-01" is posted in the Recert topic for recertification
    When the human replies "delete BL-207-thing-01" in the Recert topic
    Then no delete proposal is queued yet
    And an explicit confirmation of the deletion is requested

  # BL-450 recert-telegram-06
  Scenario: A confirmed delete queues a delete proposal for specifier review
    Given the human has been asked to confirm deleting scenario "BL-207-thing-01"
    When the human confirms the deletion in the Recert topic
    Then a delete proposal for "BL-207-thing-01" is queued for specifier review

  # BL-450 recert-telegram-07
  Scenario: A reply naming a scenario not currently up for recertification is surfaced, not applied
    Given no scenario "BL-999-ghost-01" is awaiting recertification
    When the human replies "validate BL-999-ghost-01" in the Recert topic
    Then no recertification verdict is recorded for "BL-999-ghost-01"
    And the reply is surfaced back as not acted on

  # BL-450 recert-telegram-08
  Scenario: Nothing is posted when no scenario needs recertification
    Given no scenario needs recertification
    When the recert posting runs
    Then nothing is posted in the Recert topic
