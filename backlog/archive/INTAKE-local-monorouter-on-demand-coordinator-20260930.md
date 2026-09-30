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
- Happy-path rotation is already a script, not a model: `mono_router_lib.bb` `forward-rotate-target` sends the resident to the `git_handoff` recipient; the coordinator is reserved infrastructure and never a rotation target (BL-614). The standing coordinator pane is what the topology still boots for everything that hop does not cover (notes, chase, a stranded resident, a briefing rotate).

## Addendum (2026-09-30 ~19:16 BST)

**Source:** human via Cursor, verbatim (Article 5.3):

> it would be really great if the solution could consist in having a deterministic coordinator. In fact, when all goes well, the mono router does not need a coordinator does it?

The human's preferred shape, stated after the three above, is a **deterministic coordinator**: the bookkeeping runs without a model. Their reading of the happy path is that a mono-router whose parcel already names its next role does not need a coordinator at all for that hop. This addendum records that preference. It does not retire the three shapes; the specifier still chooses, and says why the others lose.

## Addendum (2026-09-30 ~19:25 BST) — read this; do not jump the iq3 queue

**Source:** human via Cursor, verbatim (Article 5.3):

> Can you get the full swarm to do a night shift, still hard bent on making iq3 working as a coder in the swarm. Also make it read what the local monorouter is doing now, it might be of interest.

The standing order is unchanged: making `coder@iq3` work in the full swarm stays the absolute priority (the same directive already on BL-1837 / BL-1843 / BL-1845). This intake is to be read. It is not a promotion ahead of that work, and it is not a reason to stand the all-local pack back up tonight.

Live state of `ollama-ista-local-model-mono-router` at 19:25 BST, immediately before that pack was stopped for the full-forge night shift:

- Resident marker: `documenter`, in the coder window. Coordinator pane also up. Both are `qwen` on `ista-iq3s-coder:latest`, one GPU slot, contending.
- Cooldown pause active until 2026-10-01 01:00 BST (`control-pause.json`). Delivery frozen. The seats were still generating.
- The resident's only in-process parcel is `00_20260930T160033Z_014069`: coordinator note `produce the morning briefing for 2026-09-30`. That briefing is already on main and already in `docs/briefings/.sent.json` (written 08:45). The documenter had correctly decided not to compose a second one.
- It has been failing for about an hour to tell the coordinator that. `tmp/handoff.txt` was `from: documenter` / `to: coordinator` / `message: briefing 2026-09-30 already on main`, and `swarm_handoff.sh` rejects `from` as reserved. At 19:25 it was still rewriting that draft ("Greasin' the cogs…", ~57 minutes on the turn).
- The coordinator pane was not routing. A babysitter sweep had flagged that same in-process parcel (age > 30m). The coordinator then spent the turn walking `.swarmforge/` to find the file ("Updating the syntax for reality…", ~32 minutes).
- Today's closing ceremony for night-key `2026-09-30` was already `phase: done` (`briefing-missing`, `swarm-stopped`) when this pack started at 18:28. There was no briefing left to send.

## Disposition (specifier, 2026-09-30 ~19:45 BST)

Drained from the backlog root. The specifier chose **one daemon that does the coordinator's job** (a deterministic coordinator), the human's stated preference, and records why the other two shapes lose in BL-1846's description.

- **BL-1846**: a pack declaring `config coordinator_mode deterministic` has handoffd promote and route the next ticket itself on an open slot, through the gated `promote_and_route_next.sh`. This is the one happy-path hop that still needed a model coordinator: the forward rotation and the post-QA close are already scripts.
- **BL-1847** (depends on BL-1846): on such a pack, every parcel reaching the coordinator's new mail is relayed to the Telegram OPERATOR topic and completed unchanged. No prose is guessed at and none is dropped.
- **BL-1125 remaining_slices**: the seatless boot (no coordinator seat at all; ~15 scripts assume one, split by census) and the local ephemeral question seat.

Both tickets are `human_approval: pending` and not queue-jump, per the 19:25 addendum: the coder@iq3 work stays first. All three human quotes survive verbatim in both tickets' `source:`.
