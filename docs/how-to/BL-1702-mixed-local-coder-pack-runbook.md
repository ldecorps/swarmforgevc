# BL-1702 — the mixed-local-coder pack runbook

**Last Updated:** 2026-09-27

The first local pack to touch real tickets: `full-forge.conf`'s own shape,
plus a second coder seat, `coder@2`, staffed by a local model driven by the
BL-1697 local parcel driver. Every other seat (cleaner, architect,
hardender, documenter, QA, art-director, specifier) is Claude, unchanged.
This is a separate pack the operator launches by name — `full-forge.conf`
itself is never touched.

## What the local seat takes

`coder@2` runs at `--seat-tier easy`, so BL-1001's live claim filter gives
it only `mutation_cost: low` tickets, and only while it is idle. The
unchanged `coder` seat (Claude, `--seat-tier hard`) still takes every other
ticket, plus every parcel `coder@2` gives up (BL-1715, below). Check the
active set's `mutation_cost` fields before launching if you want a sense of
what `coder@2` will actually see.

## Prerequisites

- `ollama serve` running, with the probed model pulled.
- `aider` on `PATH`.
- An OpenAI-compat endpoint reachable at the URL the pack's `coder@2`
  window line names (default `http://127.0.0.1:11434/v1`; override with
  `SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL`).
- A **passing** steward probe summary for that same model (see next
  section) — the launch refuses without one, and nothing in this pack
  bypasses that check.

## The probe gate (FIRM invariant)

Before staffing `coder@2` with a model, certify it:

```sh
bb swarmforge/scripts/model_steward_cli.bb probe <model> --all \
  --endpoint-url http://127.0.0.1:11434/v1
```

— see [BL-1700 model steward coder probe](BL-1700-model-steward-coder-probe.md)
for what this measures. `swarmforge.sh` calls
`local_coder_probe_gate_cli.bb` once per launch, for the whole pack: it
reads the pack conf for any **driver seat** (agent capability + role
`coder`, `@N` suffix stripped — BL-1697's own definition), finds the
newest steward summary for that seat's declared `--model` under
`backlog/evidence/`, and refuses the launch — naming the model and the
reason (`no probe summary` / `probe verdict fail`) — unless that summary
records at least 4 of 5 coder fixtures handed off and no breached hazard.

**`PACK_STAFFING_SKIP_GATE=1` does not skip this gate.** That variable
only clears the older, separate `pack_staffing_gate` (BL-1318) that every
local/loopback aider seat needs regardless; the probe gate above reads no
override env var at all, by design — there is no code path in it that
could skip it. To point the pack at a different model, edit its `coder@2`
window line's `--model` after that model's own probe has passed; there is
no other way to launch with an uncertified model.

## Start

```sh
SWARMFORGE_TERMINAL=none ./swarm <target> --pack mixed-local-coder
```

`coder@2` then runs beside every other seat exactly like an ordinary aider
seat, except its parcels are driven — see
[BL-1697 the local parcel driver](BL-1697-local-parcel-driver.md) for the
per-parcel serve/merge/red-check/instruct/gate sequence it runs
automatically, with no human typing into that pane.

## Watch

- **`.swarmforge/local-driver/coder@2.json`** — the seat's live driver
  state (which parcel it holds, what phase it's in).
- **`.swarmforge/local-driver/outcomes.jsonl`** — one row per parcel the
  driver ends: seat id, model, ticket, outcome
  (`handed-off` | `given-up` | `escalated`), failed condition, fix turns
  used, wall time. This is the canary's own evidence — read it after a
  session, not a ticket gate.
- **The seat's `--llm-history-file`** (named on the aider launch line) —
  the model's own turn-by-turn transcript, useful when an outcome row's
  `handed-off: false` needs explaining.
- **handoffd's escalations** — an `escalated` outcome (turn limit hit with
  no non-driver sibling to fall back to) leaves the parcel `in_process`
  with a `seat ask` raised; it surfaces the same way any other role's
  stuck ask does.

## Stop criteria

Stop the canary and fall back to full-forge if any of:

- an `escalated` row appears (the seat is stuck with no give-up path —
  should not happen for `coder@2` in this pack, since the Claude `coder`
  seat is always its sibling, but check),
- a `given-up` rate that leaves the Claude coder seat carrying most of the
  low-cost queue anyway (no throughput gained),
- any hazard-fixture-shaped behavior live (a commit touching a file
  outside the ticket's editable scope, or the spec itself changing) —
  the driver's own gate should catch and revert this (BL-1697's terminal
  paths), but a live sighting is stop-and-investigate, not "the gate will
  handle it."

## Rollback

1. Relaunch the pack you came from:
   ```sh
   SWARMFORGE_TERMINAL=none ./swarm <target> --pack full-forge
   ```
   (name the pack you actually ran before the canary if it was not
   `full-forge`).
2. A parcel `coder@2` still holds when you stop:
   - if the driver already gave it up (BL-1715) — nothing to do, it is
     already back in the coder queue for Claude to claim;
   - if it is still mid-attempt, or the driver itself is down (crashed,
     host stopped) and its state file still claims the parcel — release
     it by hand:
     ```sh
     bb swarmforge/scripts/local_parcel_driver_cli.bb release <project-root> <checkout> coder coder@2 complete
     ```
     (`complete` restores spec write permission and clears the driver
     record with **no** `git_handoff`, so you can reroute the ticket by
     hand — see BL-1698's release verbs; this is the same command whether
     the attempt is stuck or the driver process itself is gone, since
     both leave the same stale driver-state claim behind). Its own
     `git_handoff`, if the seat already sent one before stopping, is
     unaffected — it is already queued in `coder`'s shared inbox.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1697 local parcel driver](BL-1697-local-parcel-driver.md) | the per-parcel serve/merge/gate/give-up sequence `coder@2` runs under |
| [BL-1700 model steward coder probe](BL-1700-model-steward-coder-probe.md) | how a model earns the passing summary this pack's launch gate requires |
| [BL-1052 local model seat launch](BL-1052-local-model-seat-launch.md) | staffing a seat with a local model in the first place |
| `docs/diagrams/swarm-flow.mmd` | the driver-seat coder@2 lane, alongside the ordinary pipeline chain |

Acceptance:
`specs/features/BL-1702-the-first-local-pack-canaries-one-real-ticket-on-a-probe-certified-local-coder.feature`.
