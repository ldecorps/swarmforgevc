# BL-469-per-agent-steering-topic-icons — QA bounce 2026-07-17 (2nd handoff, same defect)

Same defect as `BL-469-per-agent-steering-topic-icons-bounce-20260717.md`;
recorded separately because this is a distinct queued task
(`BL-469-per-agent-steering-topic-icons`, documenter commit `201143deec`)
that arrived after the first bounce for this batch was already sent.

1. **Failing command**: same as the first BL-469 bounce evidence file —
   `ROLE_TOPIC_ICON.coordinator` (`🎬`) collides with
   `epicIcon.ts`'s fixed `KNOWN_EPIC_ICON['onboarding-target-repo']` (`🎬`),
   and `ROLE_TOPIC_ICON.documenter` (`📚`) collides with `EPIC_ICON_POOL`'s
   exhaustion-fallback icon (`📚`).

2. **Commit hash checked out and tested**: `29f0ceae44` (QA's merge of
   documenter commit `201143deec`, "Document BL-469 QA bounce: icon remap to
   live-verified Telegram stickers" — a 1-line docs tweak to
   `docs/reference/Specification.MD`, on top of the same combined batch tree
   already verified). Re-confirmed at this commit: the collision is
   unchanged; `extension/src/concierge/topicIcon.ts` was not touched by this
   commit.

3. **First error excerpt**: see the first BL-469 bounce evidence file for the
   full reproduction (`grep`/`node -e` collision check + `conciergeTick.ts`
   live-wiring citations). This commit only edits documentation prose; no
   new production code to re-verify.

4. **Failure class**: `behavior` — same ticket-contract violation as the
   first bounce: the FIRM "no collision with epic icons" clause in BL-469's
   own `human_approval:` block does not hold against the real
   `epicIcon.ts` icon set.

5. **Expected vs observed**: same as the first BL-469 bounce evidence file.

## Note
This is the same underlying defect as the first BL-469 bounce sent this
session (commit `dfa97bc15f`); recorded again only because a second,
later documenter forward for the same ticket queued separately. No new
`record-qa-bounce.js` call — its ticket|date|class dedup key already
covers today's BL-469/behavior bounce.
