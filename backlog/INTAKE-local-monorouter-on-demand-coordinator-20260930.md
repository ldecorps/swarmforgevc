# INTAKE — All-local mono-router: one resident, coordinator only when a parcel must move

**Source:** human via Cursor, 2026-09-30 ~19:05 BST, verbatim (Article 5.3):

> alternatively, we could try to have no coordinator at all, or just one deamon that would do the same job. Or a coordinator that starts only when needed. So basically we would have resident, and then it can either call up a ephemeral second role, or invoke the coordinator to pass the parcel. Can you mint an intake for specifier to mull a solution over ?

**Epic / track:** local mono-router on one GPU. Sibling of the one-resident tenet (archived `INTAKE-mono-router-one-resident-questions-not-residents-20260925.md`, BL-1752 / BL-1754) and of the live pack `swarmforge/packs/ollama-ista-local-model-mono-router.conf`.

**Priority:** mull and spec. Do not implement a second standing model seat. The human asked the specifier to choose among the shapes below.

## What is wrong / why this is open

The live all-local pack (`ollama-ista-local-model-mono-router`, started 2026-09-30) puts `local-model` / `qwen` on `ista-iq3s-coder:latest` for every role, including a standing coordinator. Observed on the host RTX 5060 Ti (16 GB):

- One model load is about 13 GB, context 49152, 100% GPU, about 1.6 GB free.
- Two `qwen` processes (resident and coordinator) share that one Ollama slot (`OLLAMA_NUM_PARALLEL` unset, so one generation at a time). They already contend: the documenter resident spent ~27 minutes on a single handoff write while the coordinator was also generating.
- A second copy of the weights does not fit. A second concurrent 49152 context needs another KV cache on the order of the remaining free memory.
- `consult_spawn_cli.bb` still opens a full extra session. `config single_inference_slot` is a retired knob and does not block that spawn (`test_chase_departing_mid_parcel_gate.sh`).
- `peer_question.bb` (BL-1754) answers one question and exits, and it refuses every non-Claude seat.
- `rotate_to_role.sh` refuses (exit 5) while the departing role's `inbox/in_process` still holds an unfinished parcel.
- After an empty mailbox, rotation follows the newest `git_handoff` recipient, otherwise home (`coder`) or the router's preferred next role. An answer `note` does not bring the resident back to the asker.

So a standing coordinator costs a second model client on the only slot, and the existing "ask now" helper cannot run on this pack.

## What is wanted

One resident at a time, on the one loaded model. When that resident must involve another role, it has exactly two moves:

1. **Call up an ephemeral second role** for a question (answer, then that seat exits; it does not become a second resident and does not drain the mailbox).
2. **Invoke the coordinator to pass the parcel** when the work has to move (route, hand off, rotate).

The coordinator itself must not be a standing model seat. The human named three shapes for the specifier to mull; pick one, or a hybrid, and say why the others lose:

- **No coordinator at all.** Routing and parcel passing live in the resident's own loop.
- **One daemon that does the coordinator's job.** No model. The mechanical bookkeeping the coordinator does today (what is waiting, what may be claimed, where a parcel goes next) runs without a `qwen` pane.
- **A coordinator that starts only when needed.** The resident invokes it to pass a parcel; it runs, then exits, so it never shares the GPU with the resident.

## Firm constraints

- One inference at a time on this host. Do not design a solution that loads a second copy of `ista-iq3s-coder:latest`, or that runs the resident and a coordinator model concurrently.
- Mono-router stays one resident. An ephemeral question seat answers and exits. It does not claim parcels, drain intakes, or outlive the question (the 2026-09-25 rule).
- Preserve the human's three shapes in the minted ticket. The specifier chooses; this intake does not.
- `peer_question.bb` staying Claude-only is fine. A local replacement has to be named explicitly if the ephemeral-question move needs one.
- The retired `single_inference_slot` line is not the mechanism. Do not revive it as the design.

## Evidence / pointers

- Live pack: `swarmforge/packs/ollama-ista-local-model-mono-router.conf`
- Question helper (Claude-only, one-shot): `docs/how-to/BL-1754-ask-another-role-a-question.md`, `swarmforge/scripts/peer_question.bb`
- Rotate refusal while `in_process` holds work: `handoff_lib.bb` `respawn-as!` (exit 5)
- Rotate-back follows `git_handoff` only: `handoff_lib.bb` `newest-own-git-handoff`, `mono_router_lib.bb` `forward-rotate-target`
- Ephemeral full-role spawn (the thing that must not become the question path): `swarmforge/scripts/consult_spawn_cli.bb`
- Prior ruling: `backlog/archive/INTAKE-mono-router-one-resident-questions-not-residents-20260925.md`
