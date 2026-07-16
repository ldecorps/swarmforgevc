# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-16T21:11:07.242974783Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Human directive on Telegram pinning (follow-up to the pinned-messages thread): "at the moment, I only want the pipeline board to be pinned." Desired end state = the pipeline board message is the ONLY pinned message in the Telegram group; nothing else should be pinned. Note current state (Operator-verified 21:01Z): the swarm's Telegram bridge has NO pin/unpin (pinChatMessage) call anywhere today, so this is new behavior to build — pin the pipeline board message and ensure other messages are not pinned (unpin stragglers as needed). Relates to the pipeline-board cluster (BL-462/464/465).
