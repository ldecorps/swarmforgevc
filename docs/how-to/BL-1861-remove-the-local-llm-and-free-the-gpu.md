# Take the local LLM out of the running swarm and free its GPU (BL-1861)

Last Updated: 2026-10-03

GPU memory is tight, and sometimes you want to give it — or the local
model itself — to a task outside the swarm without stopping the swarm.
Nothing else does that: `retire_seat.sh` drops a seat's roster rows and
session but leaves its model loaded; killing the pane by hand is undone
by the babysitter (it reads `roles.tsv`, not the pane); Ollama's own
stop paths only run when the whole swarm stops.

## Run it

```sh
swarmforge/scripts/local_llm.sh <project-root> remove
```

It finds every seat in the **live** `roles.tsv` whose agent column reads
`local-model` — never a hardcoded seat name — and takes all of them out
in one pass:

1. **Refuses, changing nothing,** if any of those seats is a **bare**
   seat (an id with no `@`, the coordinator included): `LOCAL_LLM_REFUSED:
   '<seat>' is a bare seat (no @) - stage addressing and the
   coordinator's pane need it; changing nothing`. Stage-addressed
   dispatch resolves the seat whose id *is* the stage name, and the
   coordinator's own pane exiting tears the whole swarm down (BL-107) —
   remove never risks either.
2. **Writes `.swarmforge/local-llm/removed.json` first**, before
   touching any roster — per removed seat, its `roles.tsv`/`sessions.tsv`
   row and line position; per model, its endpoint and the VRAM Ollama
   reported for it before the unload; and the removal time. This is the
   contract BL-1862 (the inverse add verb, not yet built), BL-1863 (the
   operator verbs) and BL-1864 (relaunch behaviour) read.
3. **Takes every seat out of every roster copy** (reusing
   `retire_seat_lib.bb`'s own row filtering — the same filter
   `retire_seat.sh` uses), in the same order: master `roles.tsv`, then
   `sessions.tsv`, then every worktree's own `roles.tsv` copy. Only then
   kills each seat's tmux session, so the babysitter's repair sweep never
   sees "missing session, roster still lists it" mid-operation.
4. **Unloads each removed seat's model** from the Ollama endpoint its own
   generated launch script names (`POST /api/generate` with
   `keep_alive: 0`, then polls `/api/ps` until it drops off, up to
   `SWARMFORGE_LOCAL_LLM_UNLOAD_WAIT_SECONDS` — default 30s). A model no
   removed seat names, and the Ollama server process itself, are left
   alone — another task can keep using the same server.
5. **Prints every parcel** a removed seat's own `inbox/new/` and
   `inbox/in_process/` hold (ticket and path) — it never moves or
   deletes one. A parcel a removed seat held stays exactly where it is
   and resumes once BL-1862 (the inverse add verb, not yet built) brings
   the seat back; moving it to the Claude coder risks a seat that
   never built the parcel reworking a tree without its own uncommitted
   work (the BL-1004 hazard). Fresh coder work still flows normally —
   the coder stage queue is shared, so the Claude coder claims new work
   once the local seats are gone.
6. **Prints the GPU memory in use** (`GPU_MEMORY_MIB: <n>`) when
   `nvidia-smi` answers within 2 seconds, or `unknown` otherwise.

## If the unload times out

If a model is still listed after the wait bound, remove exits non-zero
naming it: `LOCAL_LLM_MODEL_STILL_LOADED: <model> - run local_llm.sh
remove again to retry the unload`. The seats stay removed either way —
only the unload is retried. Run the same command again; with no
local-model seat left in the roster, remove reads `removed.json` and
retries that record's own models' unload first, which is also how a
leftover Ollama keep-alive gets cleared after the fact.

## What is untouched

- No Claude seat, `handoffd`, or other pack process stops.
- The Ollama server itself is never stopped — only the named models are
  unloaded from it.
- A removed seat's worktree, branch, and mailbox files are left in
  place, byte for byte.
- A seat that is not `local-model` keeps its roster row and its live
  tmux session.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1320: add or remove a seat](BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md) | `retire_seat.sh` — drop one named seat (any agent), roster surgery only, model stays loaded |
| [BL-1082: pull and serve a named model](BL-1082-pull-and-serve-a-named-model.md) | The Ollama store + loopback endpoint remove unloads against |

Acceptance: `specs/features/BL-1861-the-local-llm-leaves-the-running-swarm-and-frees-the-gpu.feature`.
