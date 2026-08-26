Feature: A topic can be recreated from scratch by replaying its serialised record (RETIRED)

# BL-332 RETIRED 2026-07-17 — the whole "recreate a PER-TICKET topic by replaying its own
# serialised message record" behaviour this feature specified is superseded by BL-495 (the
# topic-consolidation epic's repair-path slice), human-approved. Post-BL-493 there is no
# per-ticket topic anymore - a ticket's topic is its FOLD TARGET (its epic's topic, or the
# standing Backlog topic) - so the repair path this feature described (decideTopicRestore
# keyed on a ticket id, recreateTopicFromRecord replaying a per-ticket blTopicStore record)
# no longer exists; BL-495's own decideTopicRestore/recreateFoldTopic replace it, keyed on
# the fold target instead. Do NOT re-word these into the new behaviour - that would duplicate
# BL-495's own contract (one-scenario-per-behaviour / IR-DRY). This file is kept as a
# tombstone so BL-332's historical acceptance pointer stays valid and the retirement is
# traceable.
#
# Successor scenarios (where each retired BL-332 scenario's behaviour now lives):
#   - BL-332 recreate-topic-01 (round trip: delete, recreate, content matches the record) ->
#     the "reopen when mapped, else recreate" HALF now lives in BL-495 topic-recreation-
#     epic-aware-01 (specs/features/BL-495-topic-recreation-epic-aware.feature); the "content
#     matches the serialised record" half has NO successor - a fold topic aggregates MANY
#     tickets' status lines, so there is no single per-topic message record to replay from
#     anymore (see topicRecreation.ts's own HONEST LIMIT comment).
#   - BL-332 recreate-topic-02 (the recreated topic is labelled a reconstruction) -> the
#     labelling itself is UNCHANGED behaviour (recreateFoldTopic still posts
#     reconstructionHeaderText), now covered at the unit level only
#     (extension/test/topicRecreation.test.js), not a Gherkin scenario of its own.
#   - BL-332 recreate-topic-03 (each replayed message preserves its original author/timestamp)
#     -> RETIRED with no successor - there is no per-message replay at all in the fold model.
#   - BL-332 recreate-topic-04 (the recreated topic becomes the ticket's live topic) -> the
#     "the new topic id is recorded" behaviour now lives in BL-495 topic-recreation-epic-
#     aware-01/-02 (reopened/recreated fold topic becomes the live one for every ticket
#     sharing that fold target, not just one).
#   - BL-332 recreate-topic-05 (recreating reads the record without consuming it, can
#     recreate again) -> RETIRED with no successor - recreateFoldTopic reads no per-ticket
#     record at all, so there is nothing to consume or leave intact; it is naturally
#     repeatable by construction (a fresh create each call).
#
# The now-dead step handlers (specs/pipeline/steps/topicRecreationSteps.js + its index.js
# entry) drove the retired recreateTopicFromRecord/decideTopicRestore(topicMap, ticketId)
# API directly - removed in the SAME parcel as the retirement (BL-495's own instruction:
# "update or retire recreate-bl-topic.ts... its scenarios' step handlers land in the same
# parcel"), not deferred to the specifier.
