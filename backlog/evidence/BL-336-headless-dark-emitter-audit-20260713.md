# BL-336 headless-dark-emitter audit — 20260713 (coder)

SCOPE PER THE TICKET: this is a LIST, not a refactor. Nothing is fixed here.
Every "dark when headless" finding is a candidate for its OWN follow-up
ticket, raised below, not built.

METHOD: candidates enumerated from the code (every emitter writing to a
human-visible surface: briefing email, PWA data, phone/holistic-UI cards,
Telegram, status.json). Verdicts come from REAL headless observation - this
entire investigation was itself run headless (a terminal-only coding agent
session, no VS Code extension host with the SwarmForge VC extension loaded
driving it), against the REAL live main checkout
(`/home/carillon/swarmforgevc`), which has a real, currently-running swarm.
Live process list, live systemd unit list, and live on-disk artifacts were
inspected directly - not reasoned about from source alone.

## Enumeration + verdicts

### Runs headless (confirmed live, real daemon/workflow-driven, no vscode.* in the path)

| Emitter | Trigger | Headless caller |
|---|---|---|
| Handoff delivery/wake, canary, chase/nudge/respawn, dispatch-gap auto-route, context-clear injections | `handoffd.bb -main` poll loop | `handoffd.bb` itself (confirmed live: pid running, started 2026-07-13T10:15 per `ps aux`) |
| Daily briefing email (BL-214) | `handoffd.bb:briefing-email-sweep!` | same loop. VERIFIED LIVE in BL-335's own investigation this same session: real command run (`node extension/out/tools/render-briefing-diagrams.js`), real log evidence of real sends |
| Briefing generation/banked compose (BL-258) | `handoffd.bb:briefing-generation-sweep!` | same loop |
| Cost-health sidecar `docs/briefings/<date>.json` (BL-272) | `handoffd.bb:emit-cost-health-sidecar!` | same loop. VERIFIED LIVE just now: `docs/briefings/2026-07-13.json` exists, real content, real `generatedAtIso` from today - **but see Finding H1 below, one of ITS OWN fields is silently dark** |
| Operator status.json, idle-nudge/linked-ticket-status/awaiting-answer, BL-topic approval consumption, auto-hibernate/relaunch, front-desk starvation alarm (BL-345), tunnel keep-alive | `operator_runtime.bb tick!` loop | `operator_runtime.bb` itself (confirmed live: pid running, started 2026-07-13T10:15) |
| Bridge (`/pipeline /agents /backlog /metrics /holistic /events(SSE) /gate-answer /telegram-inbound ...`) - the phone-card/holistic-UI surface | `front_desk_supervisor.bb:spawn-bridge!` | CONFIRMED LIVE via real `ps aux`: `node .../start-bridge-headless.js` running, pid started 2026-07-13T10:15 - **but see Finding G1, nothing auto-starts this on boot** |
| Telegram Front Desk Bot / Concierge topic messages | `front_desk_supervisor.bb:spawn-bot!` | CONFIRMED LIVE: `node .../telegram-front-desk-bot.js` running - same G1 caveat |
| Daemon-death alarm+halt email, handoffd status | `handoffd_supervisor.bb -main` loop | CONFIRMED LIVE: pid running |
| `backlog.json`/`docs-tree.json`/`recert-batch.json` (PWA data) | `.github/workflows/backlog-dashboard.yml`, push-triggered | CONFIRMED LIVE (BL-335 investigation this session): real `curl` fetch of `https://ldecorps.github.io/swarmforgevc/backlog.json` returned real, current `suiteDurationTrend` data, `generatedAtIso` from today |
| Recert inbound webhook -> repo commit | `api/recert-webhook.js` (Vercel serverless) | Independent infra, no VS Code, no swarm daemon needed |

### Table B - dark when headless (host-only, verified by real absence of data, not by reading code)

**H1 - Resource-anomaly sampling (feeds the ALREADY-headless cost-health sidecar).**
- Emitter: `extension/src/metrics/resourceTelemetry.ts:startResourceSampler`, appends to
  `.swarmforge/telemetry/chaser-<month>.jsonl`.
- Trigger: ONLY `extension.ts:startOrRestartResourceSampler`, called from `activate()`/bounce/
  target-switch - `vscode.*`-gated.
- Headless caller: none found anywhere in `swarmforge/scripts/*.bb` or `.github/workflows/*.yml`
  (grepped for `resource_sample`/`resourceTelemetry`/`ResourceSampler` - zero hits).
- VERDICT: DARK WHEN HEADLESS.
- LIVE EVIDENCE (real, not a code reading): `.swarmforge/telemetry/chaser-2026-07.jsonl` on the
  main checkout has 1677 real lines accumulated this month - `grep -c "resource"` on it returns
  **0**. The file is the SAME one both the headless chase-sweep AND the host-only resource
  sampler are supposed to write to; only the headless side has ever written anything. Direct
  confirmation on the actual currently-emitted sidecar: `docs/briefings/2026-07-13.json`'s
  `resourceAnomalies` field is `[]` - present in the schema, emitted daily, always empty. This is
  the insidious variant the ticket warned about: the CONTAINER (BL-272's sidecar) already looks
  fixed and non-empty; only one of its own fields is silently dead.
- Missing headless caller would be: a periodic resource-sample sweep inside `handoffd.bb`'s or
  `operator_runtime.bb`'s own poll loop, shelling to a new (not yet built) sampling CLI - the
  same shape as the existing `emit-cost-health-sidecar!`/`suite-duration-briefing-line` callers.

**H2/H3 - Legacy single-chat Telegram narrator + inbound gate-answer relay.**
- Emitters: `extension/src/notify/telegramNarrator.ts:TelegramNarrator.sweep` (stage-transition/
  gate-needs-you/dead-letter/PR-link narration) and
  `extension/src/notify/telegramInboundRelay.ts:TelegramInboundRelay.handleUpdate` (a human's
  Telegram reply answering a role's blocking question).
- Trigger: ONLY `extension.ts:startOrRestartTelegramAdapter`, a `setInterval` started from
  `activate()` (confirmed still wired: `extension.ts:256,722,1142,1251,1289` all call it - this
  is live code, not dead/orphaned).
- Headless caller: none - confirmed by grepping every `.bb`/`.yml` for
  `telegramNarrator`/`diffNarrationEvents`/`buildNarrationSnapshot` (zero hits). Note this is a
  DIFFERENT, OLDER system than the Concierge/forum-topic Telegram Front Desk Bot (BL-274+/
  BL-295+, confirmed headless above, currently the real live one per `ps aux`).
- VERDICT: DARK WHEN HEADLESS (assuming it is still the intended UX and not fully superseded -
  see note below).
- LIVE EVIDENCE: this box's own code-server/extension-host process (pid 2994240/2996198,
  started 10:13-10:14 today) has no SwarmForge VC extension installed in its extensions
  directory (checked directly: `find .../vscode-cli -iname "*extensions*"` returned nothing
  beyond the built-in json-language-features server) - so `activate()` has not run on this box's
  own tunnel instance, and this narrator/relay pair has not fired at all today despite the swarm
  itself being fully live (handoffd/operator_runtime/front-desk all running). Whether it is still
  the INTENDED channel (vs. fully superseded by the Concierge system) needs a human/specifier
  call, not an engineering one - noted, not assumed.
- Missing headless caller: none proposed here - this may be a candidate for RETIREMENT rather
  than a headless port, since the Concierge system already covers the same need headlessly. That
  judgment call belongs to the follow-up ticket, not this audit.

**H4 - "Needs-human" stuck-escalation email.**
- Emitter: `extension/src/notify/needsHumanEmailNotifier.ts:NeedsHumanEmailNotifier`, two
  independent instances - `extension.ts:389` (tied to the chaser monitor, host-only but
  panel-independent) and `panel/swarmPanel.ts:312` (tied to the webview panel's own lifecycle,
  even more restrictive).
- Trigger: a role sitting stuck/gated past grace+cooldown.
- Headless caller: none. LIVE EVIDENCE (real code path, the actual running `handoffd.bb`, not a
  copy): `handoffd.bb:629`'s `:on-stuck-escalation!` adapter is wired to EXACTLY ONE action -
  `chase-sweep-lib/write-escalation!`, which only writes
  `.swarmforge/daemon/chase-escalations.json`. Grepped the entire real, live `handoffd.bb` for
  any "email"/"resend" call anywhere near "escalat" - none exists. The live
  `chase-escalations.json` on the main checkout is currently `{}` (no role presently escalated,
  which is fine - the point is the CODE PATH to email one has no headless leg at all, confirmed
  by reading the one and only real production script that would have to carry it).
- VERDICT: DARK WHEN HEADLESS. This is the closest structural twin to the BL-214/BL-335 pattern:
  a real alert channel (an email, same shape as the daily digest/daemon-death/starvation alarms,
  all three of which DO have headless senders) with zero headless sender for this specific
  signal.
- Missing headless caller: `handoffd.bb`'s `:on-stuck-escalation!` adapter needs a second action
  alongside `write-escalation!` - sending via the SAME `daemon-alarm-lib/send-configured-email!`
  path the daemon-death/starvation alarms already reuse (per this project's own "reuse the one
  email path" convention), gated on the same `escalated?` edge-trigger `write-escalation!`
  already computes.

**H5 - `runs.jsonl` run-history (feeds the bridge's `/runlog`, part of the phone-card run history).**
- Emitter: `extension/src/runs/runLog.ts:appendRun/updateLastRunForTarget`.
- Trigger: ONLY the `swarmforge.launchSwarm`/`stopSwarm`/`openPR`/`setRunMode` VS Code commands
  (`extension.ts:238,1339,1625,1713`).
- Headless caller: none - a swarm launched purely via `./swarm`/`swarmforge.sh` (the actual
  live launch mechanism for the swarm currently running on this box, confirmed by the running
  pids having no corresponding VS Code command invocation) never appends a run entry.
- VERDICT: DARK WHEN HEADLESS. Lower severity than H1/H4 - history/cosmetic (a phone UI's run-log
  list stays stale/empty), not a missed alert.
- Missing headless caller: `swarmforge.sh`'s own launch/stop path would need to append the same
  run-log entry shape `runLog.ts` already defines.

### Table C - process bring-up gaps (not a `vscode.*` code path, but the same silent shape)

**G1/G2 - `front_desk_supervisor.bb` (bridge + Telegram Front Desk Bot - the whole phone-card/
Concierge/Telegram-topic system) has no boot-persistent auto-launch.**
- LIVE EVIDENCE: `systemctl list-unit-files | grep -i swarmforge` returns NOTHING on this real
  box - there is no systemd unit installed for ANY swarmforge process here, despite
  `swarmforge/deploy/generate_systemd_units.sh` existing. That generator's own `case` statement
  (confirmed by reading the real, live script) only has branches for `--unit=swarm` (starts
  `handoffd`/`handoffd_supervisor` via `./swarm`) and `--unit=operator`
  (`operator_runtime.bb`, `Restart=always`) - no `--unit=front-desk` branch exists at all.
  `launch_front_desk.sh` is invoked only by itself, its own tests, and
  `build_freshness_cli.bb`'s coordinator-triggered `restart-front-desk-group!` - never
  autonomously on boot.
- The three front-desk processes ARE currently running live (confirmed via `ps aux`, started
  2026-07-13T10:15) - so on THIS box, right now, this is not currently dark. But nothing would
  bring it back if the box rebooted, unlike `handoffd`/`handoffd_supervisor`/`operator_runtime`,
  which all have `Restart=always` units per `generate_systemd_units.sh` (once installed) or
  `swarmforge.sh`'s own auto-start.
- VERDICT: PROCESS-LEVEL DARK-ON-RESTART GAP (a distinct class from H1-H5's `vscode.*`-gated
  code, but the identical silent-by-construction shape the ticket is auditing for).
- Missing piece: a `--unit=front-desk` branch in `generate_systemd_units.sh`, wired to
  `launch_front_desk.sh`.

### Noted, not treated as a formal finding

**G3 - PWA data regen (`backlog-dashboard.yml`) is push-triggered only, no `schedule:` cron.**
Not a `vscode.*`/host-presence gap (the actual pattern this ticket audits) - it is a CI trigger-
cadence question, unrelated to whether a VS Code host is running. Flagged for completeness, not
raised as its own "dark when headless" ticket.

**Mutation-progress reporter, VS Code tile panel itself, `panel/backlogWriter.ts`** - inherently
host-only BY DESIGN (the tile panel is the in-editor UI, its own sibling to the phone cards, not
itself required to work headless). Not findings.

**31 one-shot CLI tools under `extension/src/tools/**` never invoked by a daemon/workflow** (e.g.
`co-change-report`, `dependency-gate`, `recruiter-discover`, ...) - these are role-agent-invoked
manual tools (referenced from `swarmforge/roles/*.prompt`), not autonomous/scheduled emitters.
Out of this audit's pattern.

## Follow-up tickets to raise (NOT built here, per the ticket's own "fix nothing silently")

Recommended for the specifier to spec, each on its own merits:
1. **H1** - wire a headless resource-sample sweep into `handoffd.bb`/`operator_runtime.bb` so the
   cost-health sidecar's `resourceAnomalies` field is populated on a day nobody has VS Code open.
2. **H4** - wire `handoffd.bb`'s `:on-stuck-escalation!` adapter to also send an email via the
   existing `daemon-alarm-lib/send-configured-email!` path, alongside its existing
   `write-escalation!` call.
3. **H2/H3** - specifier/human call: retire the legacy single-chat Telegram narrator+inbound
   relay (superseded by the Concierge system) OR give it a headless caller. Needs a product
   decision, not an engineering default.
4. **H5** - append a `runs.jsonl` entry from `swarmforge.sh`'s own launch/stop path, mirroring
   `runLog.ts`'s existing shape.
5. **G1/G2** - add a `--unit=front-desk` case to `swarmforge/deploy/generate_systemd_units.sh`,
   wired to `launch_front_desk.sh`, so the phone-card/Telegram system survives a reboot the same
   way `handoffd`/`operator_runtime` already do.

RAISED SEPARATELY HERE (this evidence file is the git-tracked, specifier-visible channel;
`.swarmforge/` is gitignored per-checkout local runtime state, not a place a coder-worktree
commit can durably deliver a new raw-intake item into) - recommend the specifier spec each of
the five above as its own ticket, in priority order H4 > H1 > G1/G2 > H5 > H2/H3 (H2/H3 last
because it needs a product decision before any engineering work is well-scoped).

## What was explicitly NOT done

Per the ticket's own "the output is a list, not a refactor": none of H1/H2/H3/H4/H5/G1/G2 was
fixed in this parcel. No headless caller was added, no systemd unit was written, no email path
was wired. This audit is the list; the fixes are separate, specced tickets.
