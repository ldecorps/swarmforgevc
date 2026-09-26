# Staff a role seat with a downloaded local model

Last Updated: 2026-09-26

Pull and serve the model first ([BL-1082](./BL-1082-pull-and-serve-a-named-model.md)).
This guide staffs every mono-router window with the **`local-model`** agent
against that loopback OpenAI-compatible endpoint. Routing work to the seat
is [BL-1053](./BL-1053-route-work-to-a-local-model-seat.md).

## What this is (and is not)

| | |
|---|---|
| **This pack** | `swarmforge/packs/local-model-mono-router.conf` — agent token `local-model`, shell-capable, model id on the window line |
| **Not this pack** | `qwen-mono-router.conf` — agent `aider`, file-editor shape, no autonomous shell. Keep both; pick by what the seat must **do**, not by the model catalog they may share. What an aider seat receives at launch: [BL-1697's how-to](./BL-1697-local-parcel-driver.md#what-an-aider-seat-receives-at-launch-bl-1699) |
| **First-quest binary** | `qwen` from `@qwen-code/qwen-code` (OpenAI-compat auth against loopback). The agent **token** stays `local-model`; babysitter/`./swarm ensure` look for argv needle `qwen` via `agent_process_marker_lib.bb` |
| **Not the old qwen-code seat** | The withdrawn `qwen-code-mono-router` / Token Plan cloud path was superseded; see `backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md` |

Invariants: a capability entry describes the **agent**, never the model;
swapping to a second downloaded model is a window-line `--model` change
only; secrets never land in the pack, generated launch script, or prompt.

## Prerequisites

1. BL-1082 pull + serve for the model id you will put on the window line
   (default first quest: `qwen2.5-coder:7b-instruct`). OpenAI-compat base
   URL ready at loopback (default `http://127.0.0.1:11434/v1`; override with
   `SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL`). The launcher forces
   `OPENAI_API_BASE` / `OPENAI_BASE_URL` to that URL in the pane — never a
   Token Plan cloud host.
2. `qwen` on `PATH` (`npm i -g @qwen-code/qwen-code`).
3. No cloud provider API key required. An optional local OpenAI-compat
   client token may sit in the launching environment and reaches the pane
   only via tmux `-e` (BL-130) — never written into pack or launch files.

## Launch

```sh
source ~/.zshenv   # or whatever exports optional local client token
SWARMFORGE_TERMINAL=none ./swarm <scratch-root> --pack local-model-mono-router
```

Every role window names agent `local-model` and a `--model <id>`. Launch is
**refused** when the local endpoint health check is not ready — the refusal
names the endpoint.

### Ollama is started by the swarm (BL-1703)

Before any seat starts, the launch path probes the local endpoint for any
pack whose seats use it — either a `local-model` agent window, or an
`aider` window naming the endpoint directly on its own line (e.g.
`--openai-api-base http://127.0.0.1:11434/v1`, the shape every
`ollama-*-mono-router.conf` pack uses):

- **Answers** — recorded `external` and the launch proceeds. Something
  else (for example the Local Agent, or a hand-started server) is already
  serving it, and the swarm leaves it alone.
- **Silent** — the swarm starts `ollama serve` detached, waits for it to
  answer (bounded wait, polled), and records `swarm-owned` with its pid
  and start time.
- **Never answers** — the swarm stops whatever it started, writes no
  record, and refuses the launch before any seat exists, naming the
  endpoint and the server log path.
- **No seat on the local endpoint** — no probe, no record, launch
  unchanged.

The record lives at `.swarmforge/ollama/serve.json` (`owner`: `external` or
`swarm-owned`, `pid`, `startedAt`, `endpoint`) — read by the stop path so a
server the swarm did not start is never stopped by the swarm (it may be
serving something else, like the Local Agent chat).

### Ollama is stopped by the swarm (BL-1704)

Both `stop_ancillary_services.sh` (the full-stack stop) and
`kill_all_swarm.sh` (the endless-loop hard stop and the closing
ceremony's sleep path both call this) source `ollama_ancillary_lib.sh`
and call `ollama_ancillary_stop_swarm_owned` once, reading the same
`serve.json` record the launch wrote:

- **`swarm-owned`, pid alive, still `ollama serve`.** Stops the server's
  runner children first (direct children whose command line reads like
  `ollama runner` or `llama-server` — `pgrep -P`, never a host-wide
  pattern sweep, BL-1385/1390), then the server itself: TERM, a bounded
  wait, then KILL if it hasn't gone. The record is removed. The invariant:
  a pid is signalled only after its **live** command line is confirmed
  still `ollama serve` (or a runner child of that pid) — never from the
  record alone, so a pid recycled by an unrelated process is never
  touched.
- **`external`.** Signals nothing; the stop log names the server by
  **endpoint only** — an external record carries no pid to name.
- **`swarm-owned`, but the pid is gone or no longer `ollama serve`.**
  Signals nothing; clears the stale record; the stop log says which.
  Two distinct cases share this outcome: the pid is gone, or it now
  belongs to a different command line.
- **No record.** Nothing, silently — a Claude-only pack never had one.

A stop-side failure (a runner or the server outliving TERM **and** KILL)
is logged and never fatal to the stop path itself — both call sites guard
the call with `|| true`, the same posture the launch-time probe already
had (BL-1727).

`swarm.env` keys (all optional; the defaults reproduce the previous
hand-run shape — bare `ollama serve`, native context length):

| Key | Meaning | Default |
|---|---|---|
| `SWARMFORGE_OLLAMA_BINARY` | the `ollama` binary to run | `ollama` |
| `SWARMFORGE_OLLAMA_MODELS_DIR` | `OLLAMA_MODELS` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_CONTEXT_LENGTH` | `OLLAMA_CONTEXT_LENGTH` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_WAIT_SECONDS` | bound on how long the launch waits for a newly started server to answer | `30` |
| `SWARMFORGE_OLLAMA_POLL_INTERVAL_SECONDS` | how often the wait re-probes | `1` |

### A crashed ollama server is restarted (BL-1711)

While `serve.json` exists (a local-endpoint pack is running), handoffd's
own poll loop runs an `ollama-crash-restart-sweep!` every cycle: it
resolves the same `swarm.env` keys the launch used and shells once to
`ollama_ancillary_restart_cli.sh` (`ollama_ancillary_lib.sh`'s
`ollama_ancillary_restart_if_crashed` — the same lib the launch and stop
paths use, so start/restart can never drift).

- **Establishing "process gone".** A `swarm-owned` record is checked by
  its own pid (`ollama_ancillary_pid_is_ollama_serve`). An `external`
  record carries no pid at all (BL-1703 writes `"pid": null` for one), so
  there is nothing to pin a pid check to — a bare TCP connect to the
  recorded endpoint's own host/port (`ollama_ancillary_any_ollama_serve_alive`,
  bash's own `/dev/tcp`, no curl round-trip, read-only, never a signal)
  substitutes for it: something listening on that port counts as alive,
  gone counts as not, scoped to the ONE process this record actually
  names. (QA D1, 2026-09-26: a first cut piped `ps -eo args=` to `grep`,
  which matched grep's own argv line and read "alive" on every host
  regardless of any real server; a fix scanning `ps` output for the
  pattern was still a host-wide sweep and a false positive for this
  record's own external process on any host already running an unrelated
  `ollama serve` — the port-scoped connect is what actually pins the
  check to this one record, matching what `ollama_ancillary_probe`
  already keys off of.) Without this, an external server that is merely
  alive-but-silent (loading a large model) would look permanently
  "crashed" and a second server would start alongside it.
- **Crash** = "process gone" by the check above **and** the endpoint has
  stayed silent for the whole confirmation window
  (`OLLAMA_ANCILLARY_CRASH_CONFIRM_SECONDS`, default `10`). On a
  confirmed crash: the dead server's orphaned runners are reaped first
  (BL-1705's `reapable-ollama-ghost?` classification — an 11 GB runner
  left behind would starve the new server of memory), then a new server
  is started the BL-1703 way (same binary, models directory, context
  length) and recorded `swarm-owned` with the new pid — even if the
  crashed one had been `external`, since a local pack still depends on
  it.
- **A live-but-silent server is never killed or restarted** — a large
  model can take minutes to load on a CPU host, for both a swarm-owned
  and an external record. One missed probe changes nothing; only a full
  silent confirmation window counts as a crash.
- **Restart bound.** At most `OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW`
  (default `3`) restarts in any `OLLAMA_ANCILLARY_RESTART_WINDOW_SECONDS`
  (default `1800`) — timestamps logged to `.swarmforge/ollama/restarts.log`
  so the bound survives a handoffd restart.
- **No record** (a Claude-only pack, or after a stop removed it): no
  probe, no restart.

**The alert** (Telegram + email, the same channel the endless-loop halt
uses) has one wording per outcome, parsed from the CLI's own token line
rather than echoed verbatim (a raw `ESCALATED 1 1800 …` line reads the
same for "one restart's new server never came up" as for "the bound is
exhausted" — the human could not tell them apart):

| CLI token | Alert says |
|---|---|
| `RESTARTED <old-pid> <new-pid> <log>` | ollama crashed and was restarted: pid `<old>` → `<new>`, server log: `<log>` |
| `RESTART_FAILED <old-pid> <new-pid> <log>` | ollama crashed (old pid `<old>`); the restart (new pid `<new>`) never answered — server log: `<log>` |
| `ESCALATED <count> <window> <log>` | ollama restarts exhausted (`<count>` in `<window>`s) — not restarting, server log: `<log>` |

Reaping ghost runners and detached run clients with no live server at all
(BL-1705, narrowed by BL-1726) is documented in
`docs/reference/Specification.MD`'s BL-1705/BL-1726 entries.

## Repair

```sh
SWARMFORGE_TERMINAL=none ./swarm ensure <scratch-root> --pack local-model-mono-router
```

Expect `agent:<role>` HEALTHY when the `qwen` child is present;
`rc:<role>: OFF` (remote control is off for this pack — heal via `agent:`,
not Claude `/rc`). A shell-only pane with no `qwen` descendant is repaired
by respawning the persisted role launch script.

## Swap the model (generic path)

Edit the window lines (and coordinator model) in
`local-model-mono-router.conf` — change only the model id. No second launch
branch, capability entry, or pack family. Serve the new id with BL-1082
before relaunch.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1082 pull and serve](./BL-1082-pull-and-serve-a-named-model.md) | Ollama store + loopback endpoint |
| [BL-514 remote-control / ensure](./BL-514-remote-control-health-and-ensure-wiring.md) | `rc:` OFF + `agent:` heal |
| [babysitterd runbook](./BL-611-babysitterd-runbook.md) | Process marker for `local-model` → `qwen` |
| [BL-1053 route to local-model seat](./BL-1053-route-work-to-a-local-model-seat.md) | Intelligence-layer routing (`local`→`local-model`) |

Acceptance: `specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature`.
