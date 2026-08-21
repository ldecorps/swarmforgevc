# Non-Pipeline Agents — Reference Table

Every path below was resolved against the repo at the commit that ships this
table, not recalled from memory or from an older ticket — see
[the class explanation](../explanation/BL-643-non-pipeline-agents-as-a-class.md)
for what makes an agent "non-pipeline" and why the categories below exist.
`— none —` marks a genuine absence, not an omission.

| Agent | Category | Launcher | Stop path | Role prompt | Log location | Supervising service |
|---|---|---|---|---|---|---|
| Operator | supervisory | [`swarmforge/scripts/launch_operator.sh`](../../swarmforge/scripts/launch_operator.sh) (per-event LLM turn); standing runtime via [`swarmforge/scripts/start_operator_runtime.sh`](../../swarmforge/scripts/start_operator_runtime.sh) | [`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)'s `stop_operator_runtime()` | [`swarmforge/roles/operator.prompt`](../../swarmforge/roles/operator.prompt) | `.swarmforge/operator/runtime.log` | `start_ancillary_services.sh` (first) |
| Babysitter | supervisory | [`swarmforge/scripts/start_babysitterd.sh`](../../swarmforge/scripts/start_babysitterd.sh) — irregular naming, see below | [`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)'s `stop_babysitterd()` | — none — (behaviour described from code) | `.swarmforge/babysitterd/babysitterd.log` | `start_ancillary_services.sh` |
| Onboarder | conversational | [`swarmforge/scripts/launch_onboarder.sh`](../../swarmforge/scripts/launch_onboarder.sh) | [`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)'s `stop_onboarder()` | — none — (behaviour described from code; see the [class doc](../explanation/BL-643-non-pipeline-agents-as-a-class.md#the-onboarder-what-shipped)) | `.swarmforge/operator/onboarder-supervisor.log` | `start_ancillary_services.sh` (Telegram-env gated) |
| Support | conversational | [`swarmforge/scripts/launch_support.sh`](../../swarmforge/scripts/launch_support.sh) (disposable per-event LLM) | — none — for the disposable turn (self-exits); its always-alive runtime (`support_runtime.bb`) has **no discovered start path** anywhere in the repo's lifecycle scripts — see below | [`swarmforge/roles/support.prompt`](../../swarmforge/roles/support.prompt) | `.swarmforge/support/runtime.log` | none found — irregular, see below |
| Front Desk Operator (Concierge) | conversational | [`swarmforge/scripts/launch_front_desk_operator.sh`](../../swarmforge/scripts/launch_front_desk_operator.sh) — invoked on-demand by the Operator's own runtime, not on a schedule | — none — (reaped as a one-shot disposable turn by `operator_runtime.bb`, not signalled by a stop script) | — none — (its prompt is generated at runtime by `operator_runtime.bb`, not an authored `.prompt` file) | `.swarmforge/operator/front-desk-operator.pid` (no dedicated log file) | Operator's own runtime |
| Front Desk | transport | [`swarmforge/scripts/launch_front_desk.sh`](../../swarmforge/scripts/launch_front_desk.sh) | [`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)'s `stop_front_desk()` | — none — see the naming-collision note below | `.swarmforge/operator/front-desk-supervisor.log` | `start_ancillary_services.sh` (Telegram-env gated) |
| Negotiation Relay | transport | [`swarmforge/scripts/launch_negotiation_relay.sh`](../../swarmforge/scripts/launch_negotiation_relay.sh) — one instance per provisioned target | — none — (**no stop path exists anywhere in the repo**, a genuine operational gap, not an omission — see below) | — none — | `<target-repo>/.swarmforge/operator/negotiation-relay-supervisor.log` (lives under the **target's** tree, not the swarm repo's) | not started by `start_ancillary_services.sh` — invoked on-demand, once, from the negotiation flow |
| Resident Spy Tunnel | transport | [`swarmforge/scripts/launch_resident_spy_tunnel.sh`](../../swarmforge/scripts/launch_resident_spy_tunnel.sh) | [`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)'s `stop_tunnels()` | — none — | `.swarmforge/operator/resident-spy-cloudflared.log` (+ `resident-spy-caffeinate.log`) | `start_ancillary_services.sh` |
| Cursor Bridge | transport | [`swarmforge/scripts/launch_cursor_bridge.sh`](../../swarmforge/scripts/launch_cursor_bridge.sh) — a deprecated alias for [`swarmforge/scripts/start_cursor_bridge.sh`](../../swarmforge/scripts/start_cursor_bridge.sh), the real entry point | [`swarmforge/scripts/stop_cursor_bridge.sh`](../../swarmforge/scripts/stop_cursor_bridge.sh) — its own dedicated script, deliberately kept out of `stop_ancillary_services.sh` so it survives an ancillary stop (BL-763); only an explicit `stop_cursor_bridge.sh` or `./swarm-kill` tears it down | — none — | `.swarmforge/operator/cursor-bridge-supervisor.log` | `start_ancillary_services.sh` (BL-763, credential-gated on the same token/chat/principal-id shape `start_cursor_bridge.sh` itself requires; `SWARMFORGE_SKIP_CURSOR_BRIDGE=1` opts out) — plus two self-repair paths the same ticket added: `swarm_ensure.bb`'s `ensure-cursor-bridge!` (on-demand, via `./swarm ensure`, the same way it repairs the front desk) and `operator_runtime.bb`'s `cursor-bridge-watchdog-sweep!` (continuous liveness/heartbeat-freshness repair, 120s stall window matching `cursor_bridge_supervisor.bb`'s own) |
| Model Steward | registry/CLI — not yet a live standing agent | — none — (irregular: has a role prompt with no launcher at all; see below) | — none — (n/a — nothing runs standing) | [`swarmforge/roles/model-steward.prompt`](../../swarmforge/roles/model-steward.prompt) | `.swarmforge/model-steward/` (gitignored runtime state) | none — invoked synchronously as `bb swarmforge/scripts/model_steward_cli.bb <subcommand>` by whichever caller needs it |
| Expeditor | driver — wears the pipeline's own hats with the swarm stopped, not a launched process | — none — (irregular: a driver, not a launched daemon; see below) | its own run *is* bounded — [`swarmforge/scripts/expedite.sh`](../../swarmforge/scripts/expedite.sh) `<BL-id>` exits when the ticket is done | — none — (see [the Expeditor's own docs](#the-expeditor-linked-not-restated), which this table links rather than restates) | `backlog/evidence/<BL-id>-*.md` (same evidence trail any pipeline role leaves) | none — it stops the standing swarm rather than running under it |

## Irregular cases, explained

The table above has no silently-omitted row: every launched or driven process
this measurement found gets one, and every irregularity below is a stated
fact about that row, not smoothed over.

### Model Steward — a role prompt with no launcher

`swarmforge/roles/model-steward.prompt` exists and is a real, authored
description — but the file's own text says plainly: *"Slice 1 stub — not yet
a live pipeline role... do not assign this file to a pane, do not respawn a
session as 'model-steward', and do not route handoffs to it."* There is no
`launch_model_steward.sh`, no `start_model_steward*.sh`, and no daemon script
anywhere in the repo that starts it as a standing process. Every access today
goes through the synchronous `model_steward_cli.bb` CLI, invoked directly by
whichever caller (ModelFactory, PromptEngine, or a human) needs it. Wiring it
into a standing mailbox loop is BL-557 (still `paused/`), not shipped. See
[the Model Steward how-to](BL-547-model-steward-overview.md) for the CLI
itself.

### Front Desk — no prompt of its own, and a naming collision worth flagging

`swarmforge/roles/front_desk.prompt` does not exist. The only role prompt
in the repo that uses the words "front desk" is
[`swarmforge/roles/support.prompt`](../../swarmforge/roles/support.prompt),
whose own opening line calls **Support** itself "the human-facing front desk
of the SwarmForge swarm." That is Support's self-description, not an
authored description of the agent literally named Front Desk (the Telegram
bridge + bot launched by `launch_front_desk.sh`, BL-292) — the two are
different processes that happen to share a phrase. This row exists
specifically so a reader who goes looking for Front Desk's authored
description in `support.prompt` finds this note instead of a false lead:
Front Desk's behaviour here is derived from its code
(`front_desk_supervisor.bb`, `telegram-front-desk-bot.ts`), not from an
authored prompt.

### Negotiation Relay — no stop path anywhere

`negotiation` and `negotiation_relay` appear nowhere in
[`stop_ancillary_services.sh`](../../swarmforge/scripts/stop_ancillary_services.sh)
or [`kill_all_swarm.sh`](../../swarmforge/scripts/kill_all_swarm.sh). The
relay's own `.stop` sentinel
(`.swarmforge/operator/negotiation-relay-supervisor.stop` under the target
repo) is referenced by exactly one file in the whole scripts tree — its own
launcher, which only ever *clears* it before launching. Nothing ever sets
it. A launched relay supervisor (bounded-restart-forever, polling the real
Telegram API) is therefore not torn down by `stop-swarm.sh` or
`finish-shift` — it must be killed by hand. `extension/src/tools/relay-onboarding-negotiation-telegram.ts`
carries a code comment describing a real incident where several of these
supervisor processes leaked during test runs from exactly this gap. This is
a genuine operational gap, not a documentation nicety — worth its own
ticket if it hasn't already been filed.

### Support's standing runtime — no discovered start path

`swarmforge/scripts/support_runtime.bb` self-labels in its own header as a
*"SKELETON (slice 1 of the Support role epic, BL-274)."* Repo-wide search
(excluding its own test) finds no script anywhere — not
`start_ancillary_services.sh`, not `swarm_ensure.bb`, not any
`start-swarm*.sh`/`stop-swarm.sh`/`finish-shift` script — that starts it as
a standing process. Only `launch_support.sh` (which launches the disposable
per-event LLM turn, not the always-alive runtime), `support_lib.bb`, and its
own test reference it. Unlike Operator, Front Desk, Onboarder, and
Babysitter — which all have an explicit standing-start call in
`start_ancillary_services.sh` — Support has an authored role prompt and a
working per-event launcher, but as wired today, nothing starts the runtime
that would decide *when* to call that launcher in production.

### Expeditor — linked, not restated

The Expeditor is not a launched or supervised process at all — it is a
driver script, `swarmforge/scripts/expedite.sh`, that walks one ticket
through every pipeline gate with the entire standing swarm stopped, using
the same role hats and the same gates, replacing the transport/liveness
layer with plain control flow. Its full behaviour is already documented at
length and is linked here rather than restated, so the two descriptions
never drift apart:

- [How to drive one ticket through every gate with the swarm stopped](BL-567-expedite-one-ticket-with-the-swarm-stopped.md)
- [Why the expeditor commands the stack but never depends on it](../explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md)
- [Expeditor — complete reference](BL-567-expeditor-manual.md)

## What this table intentionally excludes

The coordinator and specifier are not listed here — they are pipeline
*roles* (Article 1 of the constitution), with their own worktree and their
own place in the parcel chain, even though the specifier and coordinator
sit outside the strict forward chain. This table is scoped to agents that
are not roles at all: launched daemons, disposable per-event LLMs, and the
one driver script, none of which hold a `BL-###` ticket or a pipeline gate.
