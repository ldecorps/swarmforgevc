# INTAKE — A pair of verbs to add or remove the local LLM from the running swarm

**Source:** human via Cursor, 2026-10-01 ~08:45 BST, verbatim (Article 5.3):

> other local llm ticket: introduce a pair of verbs to easily add / remove the local llm from the running swarm. Reason is that GPU memory is tight and we might want to dedicate the local llm to another task, outside the swarm.

**Epic / track:** child of BL-1125 (`epic: local-llm-swarm`). The 2026-09-30 standing directive still says every new child of that epic mints `direction: queue-jump`. This intake does not retire that directive and does not rank itself ahead of it.

**Priority:** one pair of verbs the human can run while the swarm is already up. Do not make the easy path a pack-conf edit plus a full `./swarm` kill and relaunch.

## What is wrong / why this is open

The full-forge pack keeps a local-model coder seat beside the Claude seats. On committed main that seat is `window coder@iq3 local-model coder-iq3 --model qwen2.5-coder-14b-q5km:latest`. The 2026-09-30 bake-off measured that model at about 13.1 GB of a 16.3 GB GPU. While the seat is generating, that memory is not available for anything else.

The human wants to take the local LLM out of the live swarm, use it (or the GPU it occupies) for a task that is not a swarm seat, then put it back. Both moves have to be easy, and neither may stop the Claude seats.

What exists today does not do that pair:

- `retire_seat.sh` (BL-1720) drops one named seat from the running swarm: it rewrites every `roles.tsv` / `sessions.tsv` copy, then kills that seat's tmux session, and leaves the worktree and mailbox in place. The how-to says the inverse is not built: bringing a retired seat back is the next full launch, after the `window` line is in the pack again (`docs/how-to/BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md`).
- Killing the pane by hand is not enough. `babysitterd` resurrects a session whose roster row is still there, and the next request loads the weights again.
- The ollama stop paths (BL-1704, `ollama_ancillary_stop_swarm_owned`) run when the swarm itself is stopping. They stop a swarm-owned `ollama serve`. They leave an external server running. They are not a mid-shift "free the GPU, keep the swarm" verb.
- Unloading is a separate step from stopping the pane. Ollama's keep-alive holds the weights until `ollama stop <model>` or the TTL. A dead pane with a live runner still occupies the GPU.

## What is wanted

Two verbs, each one command, usable against the swarm that is already running:

1. **Remove.** Every local-model seat of the running pack stops taking work and stops requesting. The model those seats had loaded leaves GPU memory, so the human can dedicate that local LLM to a task outside the swarm. Claude seats, handoffd, and the rest of the pack stay up.
2. **Add.** Those same local-model seats come back into the running swarm and may load the model again. No full relaunch.

The specifier names the verbs and chooses whether the backend is a shell pair (the shape of `retire_seat.sh`) and whether the same pair is also an operator verb on the BL-698 Telegram / Cursor surface. The human asked for verbs that are easy; a script the operator must remember the path of is the floor, not the ceiling.

## Firm constraints

- The rest of the swarm keeps running. `/stop`, `/restart`, and `kill_all_swarm.sh` are not this pair.
- Remove must free the GPU, not only kill the pane. A babysitter repair, a wake, or a leftover keep-alive must not load the weights back while the local LLM is removed.
- Add must not require editing the pack conf and relaunching. The "not built yet" inverse of `retire_seat.sh` is the gap this intake is for, plus the GPU unload `retire_seat.sh` does not do.
- Target is every `local-model` seat of the running pack, not a hardcoded window name. The operator has been swapping which local coder seat is live (`coder@iq3` on main; an uncommitted pack edit also names `coder@2`). The verbs follow the seats the running roster actually has.
- Prefer unloading the swarm's model (`ollama stop <model>`) over killing `ollama serve`. The outside task is another use of the local LLM; an external server should still be there for it. Stopping a swarm-owned server is the BL-1704 shutdown contract, not this verb. If the specifier chooses otherwise, say why.
- Do not delete the seat's worktree, branch, or mailbox. Remove reports any parcel still in that seat's `inbox/new/` and `inbox/in_process/`. The specifier rules what happens to an in-process parcel (it must not be deleted; the Claude coder seat keeps working either way).
- Idempotent. Remove while already removed, and add while already added, succeed and say so.
- Add should say when the GPU is still held by the outside task, rather than silently contending for the one slot. The specifier rules whether that is a refusal or a warning.
- Preserve the human's sentence above in the minted ticket's `source:` (Article 5.3).

## Evidence / pointers

- Live local seat on main: `swarmforge/packs/full-forge.conf` (`coder@iq3`, `qwen2.5-coder-14b-q5km:latest`, ~13.1/16.3 GB in the bake-off comment)
- One-way mid-shift drop, inverse explicitly not built: `swarmforge/scripts/retire_seat.sh`, `docs/how-to/BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md`
- Shutdown-only ollama stop, external server left running: `swarmforge/scripts/ollama_ancillary_lib.sh` `ollama_ancillary_stop_swarm_owned`
- Operator verb surface, if the pair lands there: `docs/reference/specs/BL-698-telegram-cursor-operator-command-surface.md`, `extension/src/tools/telegramCursorOperatorCore.ts`
- Epic: `backlog/paused/BL-1125-epic-local-ollama-swarm-readiness.yaml`; queue-jump rule in `backlog/STEERING.md` (2026-09-30, "Auto-jump any ticket that has to do with local llm")
