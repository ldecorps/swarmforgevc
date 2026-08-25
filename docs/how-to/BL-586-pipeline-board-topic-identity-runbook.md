# Recovering From a Crossed Pipeline Board Topic, and Cleaning Up Zombie Topics

The Telegram "Pipeline Board" topic has, twice, ended up posting into a
different topic instead — once into a human support thread (SUP-7 on
2026-07-23, SUP-5 on 2026-08-21). BL-586 fixed the root cause: the board now
validates its stored topic id against `telegram-topic-map.json` on **every**
resolve, not just at mint time, and re-establishes its identity by
reuse-or-create against a durable `PIPELINE_BOARD` standing-topic record
instead of blind-creating a new topic. This page covers the two manual
situations that can still come up.

## Diagnosing a crossed identity (post-BL-586)

If the board looks like it is posting into the wrong topic, check the
Operator topic first — a crossed identity now alarms there automatically,
naming both the stored topic id and the subject `telegram-topic-map.json`
actually attributes it to (`Pipeline Board identity refused: stored topic id
<id> is mapped to <subject>, not PIPELINE_BOARD. Re-ensuring the board topic
from the durable standing record; no post was made into <id>.`).

No file edit or restart is required: the board re-ensures against the
durable `PIPELINE_BOARD` key in `.swarmforge/operator/telegram-standing-topic-ids.json`
on the very next tick and self-corrects. If that key is also missing or
itself points at a topic the map has since reassigned, the board falls
through to minting a fresh topic and records it in both files before its
first post — so a crash between create and post cannot orphan it either.

## The 2026-07-23 stack-down repair procedure — now legacy

Before BL-586, the only way to recover from a crossed identity was to stop
the whole swarm and repair the state file by hand, because a live bridge
process holds the crossed id in memory and will overwrite a file-only fix:

1. Stop the swarm (stack down) so nothing is holding the crossed id in memory.
2. Clear `TickState.pipelineBoard.topicId` in the target's tick-state file.
3. Bring the swarm back up. The board would mint a brand-new topic on its
   next tick (with no reuse-lookup, which is the zombie-topic half of this
   same defect — see below) and start posting/pinning there instead.
4. Manually delete any stray board posts left behind in the crossed topic.

**Do not use this procedure anymore.** Acceptance scenario 04
(`specs/features/BL-586-pipeline-board-topic-identity-crossed.feature`)
gates exactly the claim that made it unnecessary: a crossed in-memory
identity now self-corrects on the very next tick with no operator file edit
and no restart, because the trust branch validates before every post rather
than only when the field is empty. It is documented here only so a stack-down
repair is never reached for again — if you find yourself about to stop the
swarm to fix this, stop and check the Operator topic for the crossed-topic
alert instead; the fix should already be in flight.

## Cleaning up existing zombie "Pipeline Board" topics

Every crossed-identity incident before BL-586 could also mint an untracked
extra "Pipeline Board" topic (BL-497's topic-gone self-heal clears the tick
state's `topicId`, and the old `ensureBoardTopicAdapter` was a bare
`createForumTopic` call with no reuse-lookup and no durable record). Those
zombie topics' ids were never recorded anywhere, and **the Telegram Bot API
has no call that enumerates a chat's forum topics** — there is no
programmatic way to find or delete them.

To remove one:

1. Open the group chat in the Telegram client (not the Bot API) and look at
   the topic sidebar for topics named "Pipeline Board" other than the one the
   board is currently posting into.
2. Confirm which topic is current by checking the `PIPELINE_BOARD` entry in
   `.swarmforge/operator/telegram-standing-topic-ids.json` — that id is the
   live one; every other "Pipeline Board"-named topic in the sidebar is a
   zombie.
3. Delete the zombie topic(s) by hand from the Telegram client. There is no
   swarm-side command for this step.

This cleanup is manual because it must be — BL-586's fix is the record-before-use
change (the standing id is written durably *before* the board's first post
into a newly minted topic), which stops new zombies from being minted going
forward. It does not retroactively enumerate or remove ones that already
exist.

## See also

- [`specs/features/BL-586-pipeline-board-topic-identity-crossed.feature`](../../specs/features/BL-586-pipeline-board-topic-identity-crossed.feature) — the four scenarios this fix is gated on.
- [`docs/how-to/BL-611-babysitterd-runbook.md`](BL-611-babysitterd-runbook.md) — the topic-gone self-heal (BL-497) this fix's reuse-or-create path now backstops.
