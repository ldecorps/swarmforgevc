# BL-1052 architect pass

- Received: cleaner `e5f6f71b8a` (shared marker lib + coordinator `--model` DRY) atop coder `3f97f2137` local-model seat path; both are ancestors of this tip.
- Inventory: NONE
- Dependency-rule gate: no `extension/src` in this parcel — N/A. Full-repo scan still shows standing BL-759 `telegram-front-desk-bot` ↔ `telegramCursorOperator*` cycle only; not introduced here.
- Co-change: `swarmforge.sh` remains a historical hub; new local-model surfaces couple intentionally to prompt-engine capabilities, pack, marker lib, and ensure/babysitter. No surprise fan-out to bounce.
- Invariants (all three encoded in `bl1052_local_model_seat_property_runner.bb`, green via `vitest.properties`):
  1. Capability describes the AGENT — `local-model` chat-message/embedded ≠ `aider` shell-run-script.
  2. Model-generic — second model id only on the window line; same launch arm / capability / pack family.
  3. Secrets stay in launching env + `tmux -e` — pack and generated launch body carry no credential values.
- Architecture: integrate-not-fork on the maintained SwarmForge surface; loopback endpoint (never cloud host); health refuse before launch; first-quest `qwen` binary matches `agent_process_marker_lib` (`local-model` → `qwen`); existing `qwen-mono-router` aider pack untouched.

By architect.
