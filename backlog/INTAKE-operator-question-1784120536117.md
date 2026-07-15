# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-15T13:02:16.117913522Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Feature request (human, via Operator Telegram thread): drive swarm stop/start from the phone. Add guarded control commands — /stop and /restart — in a dedicated Telegram control topic, so the human can cleanly stop then relaunch the full swarm from Telegram without needing the VS Code extension/master context. Guard: only the authorised human can trigger; a /stop must do a clean teardown (no orphaned tmux windows or vitest workers) and /restart a full relaunch that actually bootstraps all agents into their windows (the 12:05Z incident showed windows-without-bootstrap is a real failure mode to avoid). Pairs with the queued topic/verb work (BL-408/409/410 one-tap approve, Approvals topic, recert topic). Context: today restarts must come from the extension because the tmux session/windows already exist and a blind outside relaunch risks colliding or being reaped — the feature needs to run the restart from the master/owning context, not a naive external respawn.
