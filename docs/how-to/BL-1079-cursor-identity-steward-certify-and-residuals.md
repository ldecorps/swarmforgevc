# Certifying a Cursor identity, and the residuals that stay after the gate

BL-1079 (BL-712 slice C). The Model Steward now knows a committed
`cursor/auto` **candidate**, and `certify` refuses without a compliance-battery
scorecard. This how-to is the operator path for that gate, plus the three
Cursor-specific residuals the ticket called out: bootstrap limits,
remote-control differences versus Claude `/rc`, and cost attribution.

Not in this doc: the launcher allow-list itself (BL-1078), pack window-line
how-tos (BL-1080), or the one-shot spike CLI (BL-713).

## Certify `cursor/auto` on evidence

The identity is already in the committed seed
(`swarmforge/model-steward/seed/models.seed.json`) as provider `cursor`, model
`auto`, status `candidate`. It is reachable for role-matrix rows (documenter,
coder) and has a capability + adapter entry. It is **not** production-routable
until certify succeeds (or an explicit escape / `--override-uncertified` is
used — those are spikes, not certification).

### 1. Confirm the seed identity

```bash
bb swarmforge/scripts/model_steward_cli.bb status
bb swarmforge/scripts/model_steward_cli.bb show cursor/auto
```

Expect `cursor/auto candidate`. Anthropic / openai / cerebras rows must be
unchanged.

### 2. Certify without a scorecard must refuse

```bash
bb swarmforge/scripts/model_steward_cli.bb certify cursor/auto
```

Expect a non-zero exit and:

```text
certify refused: missing compliance-battery scorecard at scorecards/cursor__auto.json
```

Status stays `candidate`. No file under
`.swarmforge/model-steward/certification-reports/` for this identity.

### 3. Plant a compliance-battery scorecard, then certify

Produce a scorecard with the real battery CLI (or any JSON with the same
shape: `model`, `entries`, `overall`), and place it at the well-known path
under the steward state dir:

```bash
STATE="${MODEL_STEWARD_STATE_DIR:-.swarmforge/model-steward}"
mkdir -p "$STATE/scorecards"

# Example: aggregate entries you already collected into a scorecard artifact.
bb swarmforge/scripts/compliance_battery.bb scorecard auto /path/to/entries.json \
  > "$STATE/scorecards/cursor__auto.json"

bb swarmforge/scripts/model_steward_cli.bb certify cursor/auto
bb swarmforge/scripts/model_steward_cli.bb show cursor/auto
```

Expect status `certified`, and both stdout and the certification report JSON
to name `scorecards/cursor__auto.json`.

### 4. Routing after certify

```bash
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality --role documenter
```

With no override, a certified Cursor that ranks for the role may be assigned;
the `agent` field is the token `cursor` (launcher allow-list, BL-1078). Before
certify, the same assign must not pick Cursor unless `--override-uncertified`
is passed (rationale then names the override).

Pack admission mirrors that gate: an uncertified Cursor seat is refused unless
`SWARMFORGE_CURSOR_SEAT_SPIKE=1` (exact value) is set — same escape the BL-713
spike and BL-1078 seat guard share.

### 5. Decertify when it regresses

```bash
bb swarmforge/scripts/model_steward_cli.bb decertify cursor/auto \
  --reason "compliance battery regressed on <check>"
```

Routing reverts to refusing Cursor without override / spike.

---

## Residual: bootstrap limits

A Cursor **pack seat** is an ordinary tmux-resident pane agent, same family as
`vibe` / `gemini` / `grok` — not an ACP-hosted seat.

| Concern | Cursor behaviour |
|---|---|
| Agent token vs binary | Token `cursor`; binary `cursor-agent`. Dependency checks and launch argv use the binary; allow-list and ModelFactory use the token. |
| Prompt bootstrap | `:bootstrap-style :embedded`, `:bootstrap-text-style :generic` — constitution / pipeline / role ride the first chat message (same generic path as Claude/codex/vibe). |
| Startup delay | `:startup-delay-ms 3000` — three seconds before the wake message, so the CLI is up before chat. |
| Worktree flag | Launch uses `--workspace <role-worktree>`, never `-w` / `--worktree`. `cursor-agent`'s `--worktree` creates its **own** git worktree under `~/.cursor/worktrees/…` and fights the worktree SwarmForge already provisioned (same trap vibe had with `--worktree` vs `--workdir`). |
| Auth | `CURSOR_API_KEY` arrives via tmux `-e` (BL-130). It is never written into the launch script. |
| ACP | Not an ACP client. `prompt_engine_lib.bb`'s cursor capabilities entry is unmarked for `:acp`. |

Limits that follow from that shape:

- Bootstrap is **one embedded prompt slurp**, not Claude's
  `--append-system-prompt-file` cacheable prefix path. Large role/pack prompts
  pay full first-message cost every respawn; there is no Anthropic-style
  prompt-cache hit on the stable constitution/PIPELINE prefix for a Cursor
  seat.
- **Operator hotfix 2026-08-23:** Cursor launch now passes a short "read and
  obey `$prompt_file`" wake (gemini-style path reference) instead of
  embedding `$(cat prompt)` in argv — cuts ARG_MAX risk on full-forge and
  avoids paying the prompt twice in the process command line. The seat still
  loads the prompt into context once by reading the file; there is still no
  Claude-style prompt cache.
- The seat must be woken by chatting into the pane (`:wake-style
  :chat-message`). There is no separate "paste prompt file" bootstrap like
  grok.
- A host without `cursor-agent` on `PATH` is refused at pack dependency check
  before any window opens.

## Residual: remote-control vs Claude `/rc`

Claude pipeline seats launch with `--remote-control <name>`. The pane footer
shows a live `/rc` (or `/rc failed`). `./swarm ensure`'s `rc:<role>` component
and `remote_control_health.bb` / `remote_control_respawn.bb` (BL-514) heal a
Claude seat that lost that flag or whose claude.ai/code session died.

**Cursor seats do not get that path.**

- `cursor-agent` has no SwarmForge-wired `--remote-control` equivalent to
  Claude Code's mobile / claude.ai/code session.
- The BL-514 health check and `rc:<role>` ensure repair are **Claude-process
  argv and `/rc` footer** signals. They do not supervise a Cursor pane.
- Phone/operator control of Cursor work is a **different** surface: the
  Telegram **Cursor Remote** bridge (BL-698) and Cursor's own product remote
  features — not `rc:coder` / `rc:documenter` on the swarm socket.

**Operator hotfix 2026-08-23 (Cursor heal path):**

- `rc:<role>` for seats whose launch script has no `--remote-control` reports
  **OFF** (with an action string), not a misleading HEALTHY.
- Half-launch heal (pane up, agent gone) is owned by **`agent:<role>`**:
  `./swarm ensure` treats the seat unhealthy unless the expected binary
  (`cursor-agent`, …) is a descendant of the pane, then respawns from the
  launch script — the same repair Claude `/rc` was never going to do for
  Cursor.
- Babysitter live-session check matches the roles.tsv agent token (not only
  `claude `), so Cursor panes no longer false-CRIT as half-launches.

## Residual: cost attribution

BL-1079's first invariant is not only routing — it is **honest billing**.

- The committed identity is `cursor/auto` under provider **`cursor`**, never a
  borrowed `anthropic/…` id that happens to be served by the Cursor CLI.
- ModelFactory's `provider->agent` map names `cursor → cursor` explicitly, so
  assignment overlays and pack agents stay keyed on that provider.
- Seed `cost_class` is `medium`. Cheap-mode assign treats it like any other
  medium candidate once certified.
- The LLM cost ledger's origin block carries `provider` and `model` (BL-551;
  records under `.swarmforge` cost JSONL). Spend from a Cursor-staffed seat
  must be attributed as provider `cursor` / model `auto` (or whatever
  `--model` the window line selected). Registering the same CLI under
  `anthropic/…` would fold Cursor spend into Anthropic totals and make
  compliance and cost-rank reports lie.

Until certify lands on a host, production packs still refuse the seat unless
`SWARMFORGE_CURSOR_SEAT_SPIKE=1` or ModelFactory `--override-uncertified` is
set. Those escapes do **not** change the provider key — they only admit an
uncertified identity. Cost attribution stays on `cursor/…` either way.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-547 Model Steward overview](./BL-547-model-steward-overview.md) | Generic register / certify / role-matrix CLI |
| [BL-525 ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md) | Assign, cold-apply, `--override-uncertified` |
| [BL-713 Cursor seat spike](./BL-713-cursor-seat-driver-spike.md) | One-shot `cursor-seat-spike.js` (not the pack launcher) |
| [BL-514 Remote-control health](./BL-514-remote-control-health-and-ensure-wiring.md) | Claude `/rc` ensure path Cursor seats do **not** use |
| BL-1078 | Launcher token + seat-admission guard |
| BL-1080 | Pack lines that name `cursor` (deferred how-to) |

Acceptance: `specs/features/BL-1079-a-cursor-identity-can-be-steward-certified.feature`.
