# INTAKE — Full forge on one 16 GB GPU: many busy seats, one (or few) iq3 decode slots

**Source:** human via Cursor, 2026-10-07 ~23:51 BST, verbatim (Article 5.3):

> Stay on 16 GB: keep single_inference_slot (what you have). You can still have 9 panes "busy" (shell/tests), but GPU inference stays 1-at-a-time — load balancing seats ≠ concurrent decode.
>
> Dig this further and mint something for specifier. That's gping to be intersting to do next.

**Epic / track:** `local-llm-swarm` (BL-1125). Sibling of BL-1142 (mono-stay on this host), BL-1752 (retired `single_inference_slot`), and the all-local mono-router intakes (`INTAKE-local-monorouter-on-demand-coordinator-20260930.md`, `INTAKE-mono-router-one-resident-questions-not-residents-20260925.md`). Tonight the live pack is `ollama-ista-local-model-claude-coord-mono-router` (one iq3 resident + Claude coordinator) on an RTX 5060 Ti 16 GB.

**Priority:** mull and spec next interesting local-llm slice. Do not buy a bigger GPU as the answer. Do not treat the inert pack line `config single_inference_slot 1` as a working mechanism.

## Dig — what is true today

### VRAM (measured, this host)

From `backlog/evidence/iq3-window-vram-census-20260930-specifier.md` and live `/api/ps` 2026-10-07:

- Weights of `ista-iq3s-coder:latest` (IQ3_S ~27B): about **11 GB**.
- KV cache with `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`: about **34 KiB/token** (~1.6 GB at 49k context).
- One loaded seat at ~49k–73k context: about **14.5 GB** fully on GPU, a few hundred MiB free on 16 GB.
- **Five concurrent full contexts do not fit** on this card (would need ~20–26 GB depending on window). One weight copy + one KV is the durable budget.

### `single_inference_slot` is not what you have

BL-1752 **retired** the knob. Its only reader was `consult-eligible?` on mono-router chase; the parser and the refuse-spawn path went with the consult spawn. Pack confs may still carry `config single_inference_slot 1` (including tonight's live pack), but `swarmforge.sh` treats unknown `config` keys as fall-through — **the line does nothing**. Tests pin that a conf still carrying it launches. Do not revive that string as the design; if a decode budget exists, give it a real name, a real reader, and a real gate.

### What actually serializes inference today

Three different things get conflated:

1. **Topology (mono-router).** `config rotation router` + one resident session. Only one role's `qwen` loop runs the pipeline at a time; other roles are dormant rotate targets. That is **one busy agent**, not nine panes with one shared GPU.
2. **Ollama / llama-server.** Often only one active generation (`OLLAMA_NUM_PARALLEL` unset, and some `qwen35` Ollama builds have forced Parallel=1). Seats that both call `/v1/chat/completions` while one model is loaded **queue at the server**, but nothing in SwarmForge *decides* which seat may call, or that a seat mid-`npm test` is not "using the slot".
3. **KV / VRAM.** Even if the server accepted five parallel generations, five 49k KV caches do not fit in 16 GB. Serialization is required for memory, not only for fairness.

BL-1142 already decided **mono-router stay** for local Ollama on this host (depth 1), and refused uncapped forge shapes that "would wedge Ollama under concurrent seats". That decision treated **standing multi-seat** as the hazard. The human's new ask is the interesting middle: **standing full forge (≈9 panes) is wanted**, if and only if **GPU decode** stays capped while **CPU work** (shell, tests, mutation, git) can overlap.

### Load balancing seats ≠ concurrent decode

A seat can be "busy" in babysitter / Bubble sense while:

- waiting on a long `npm test` / vitest / acceptance / Stryker run,
- running git, bb, or file tools,
- blocked on a human / lander / another seat's mail,

without holding a decode. Today nothing distinguishes **decode-busy** from **tool-busy**. A naive "max 5 running" cap on panes would still let five seats hit Ollama at once (KV blow-up or server queue thrash), and would wrongly idle seats that are only in shell.

What is wanted is roughly:

| Layer | Cap on 16 GB | May overlap? |
|---|---|---|
| Standing panes (full forge) | ~9 (roles.tsv / pack windows) | yes — all up |
| Seats with in-flight parcels / shell / tests | human suggested ~5 as a soft ceiling | yes among themselves |
| Concurrent iq3 **chat completions** (decode / prefill) | **1** (or a named small N if VRAM math allows) | no |

The interesting design work is the **decode gate**, not another mono-router.

## What is wanted

Specifier: mull and mint (or refuse with reason) a path to run a **full-forge-shaped** all-local (or mostly-local) pack on this **16 GB** host where:

1. **About nine seats stand** (specifier, coder, cleaner, architect, hardender, documenter, QA, coordinator as decided, plus any numbered seat the pack names) — not mono-router one-resident rotation as the only way to share the GPU.
2. **At most one iq3 model generation runs at a time** by default (configurable small N later if measured safe). Other seats that need the model **wait on a SwarmForge-owned slot**, not by hoping Ollama serializes and not by unloading/reloading weights per seat.
3. Seats that are only in **shell / tests / non-model work** are not treated as holding the decode slot; they may proceed while another seat generates (subject to host CPU/RAM, which is a separate ceiling).
4. Optional soft cap (~5) on how many seats may be parcel-active at once is in scope to discuss, but must not be confused with the decode cap.
5. VRAM stays one weight load; no second copy of `ista-iq3s-coder:latest`. Context policy (32k vs 49k vs today's live ~73k) is named so the KV budget for N=1 is explicit.

The human's quoted framing is the acceptance north star: *9 panes can look busy; GPU inference stays 1-at-a-time; load balancing seats ≠ concurrent decode.*

## Shapes for the specifier to choose among (or hybrid)

Preserve these; pick one (or a hybrid) and say why the others lose:

- **A. Decode lock in the tool-call shim** (`local_model_tool_call_shim.py`, already on the path to Ollama). Chat completions take a host-wide lock/queue; health shows who holds the slot and who waits. Shell never goes through the shim, so tests overlap naturally.
- **B. Seat-level "may call model" lease** from handoffd / a small daemon. A seat acquires a lease before any generation; releases on turn end / idle / tool-only stretches. Stronger control, more moving parts.
- **C. Stay mono-router** and reject full forge on 16 GB. Honest if A/B cannot be made safe; then update BL-1142 how-to that "busy panes ≠ decode" was considered and mono remains the durable answer.
- **D. Capped forge without a decode gate** (depth/rotation only, BL-1142's old "capped-forge" idea). Likely loses: depth caps tickets, not concurrent `/v1` calls from standing seats.

Also say how this relates to:

- BL-1142 mono-stay (amend vs new decision artifact),
- retired `single_inference_slot` (do not revive the inert line),
- BL-1846/BL-1847 deterministic coordinator (standing Claude vs seatless bookkeeping when every pipeline seat is local),
- Ollama `qwen35` Parallel=1 quirks (server may serialize anyway; SwarmForge still needs a **named** policy and wait visibility).

## Firm constraints

- Stay on **16 GB**. Do not make the ticket "buy 32 GB".
- **One weight load.** No design that needs two full iq3 resident contexts in VRAM.
- Do not pretend `config single_inference_slot 1` already implements this.
- Do not make "max 5 busy panes" the only control if those five can all decode at once.
- Article 5.3: human sentences above stay verbatim in minted ticket `source:` / notes.
- Prefer measuring: who holds the slot, wait time, and that a seat in `npm test` does not block another's decode falsely — over speculative pack conf churn.

## Evidence / pointers

- VRAM census: `backlog/evidence/iq3-window-vram-census-20260930-specifier.md`
- Live model tag / Modelfile: `swarmforge/packs/ista-iq3s-coder.Modelfile`
- Live pack (mono + inert knob): `swarmforge/packs/ollama-ista-local-model-claude-coord-mono-router.conf`
- Pack-shape gate (mono vs capped/uncapped forge): `swarmforge/scripts/local_ollama_pack_shape_lib.sh`, `docs/how-to/BL-1142-local-ollama-mono-vs-forge-cpu.md`
- Knob retirement: `backlog/done/BL-1752-the-chase-never-starts-a-second-session-on-a-mono-router-pack.yaml`
- Shim on every local-model chat path: `swarmforge/scripts/local_model_tool_call_shim.py`
- Epic tracker: `backlog/paused/BL-1125-epic-local-ollama-swarm-readiness.yaml`

## Out of scope for this intake

- Buying or recommending a specific SKU (already answered in chat: 32 GB if you want true multi-decode).
- Making iq3 "as fast as Claude".
- Changing lander / QA land path (separate; local-model QA card lander_queue fix is elsewhere).

## Disposition (specifier, 2026-10-08)

Split 1:3, every human sentence above verbatim in each ticket's `source:`:

- **BL-2076** - the tool-call shim names the seat behind every chat
  completion (seat in each seat's URL; log line with seat, duration,
  prompt tokens, switch). The measurement half: "who holds the slot".
- **BL-2077** - one decode slot in the shim, held by a seat across its
  burst (idle grace, hold quantum, waiting seats kept alive, health shows
  holder and waiters). Wanted items 2, 3 and 5 (one weight load, one
  context: KV budget named at 73728 tokens, 14.5 GB on the card).
- **BL-2078** - a standing all-local forge pack (the live pack's seven
  iq3 seats plus its Claude coordinator) launched through the local
  pack-shape gate, allowed only behind the slot. Wanted items 1 and 4: the
  soft cap is `active_backlog_max_depth`, posed to the human as a ruling
  (3 recommended, 5, 2).

Shape: A (in the shim) with B's lease semantics. iq3's cache cannot
rewind to a shared prefix (BL-1978), so every change of seat is a full
re-prefill (23-38 s at 20-30k tokens, 66 s at 50k, serve.log 2026-10-08);
a per-request lock - Ollama's own order - would pay that on nearly every
request. B as a separate daemon has no hook into qwen; C leaves the GPU
idle about half of each active hour on the mono pack; D caps tickets, not
concurrent /v1 calls. Measurements: BL-2077 `notes:`. BL-1142 is amended
for router packs, not superseded. The retired `single_inference_slot`
line is not revived.
