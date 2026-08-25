# BL-336 headless-dark-emitter audit — 20260825 (coder, BL-987 canary answer)

SCOPE PER THE TICKET: this is a LIST, not a refactor. Nothing is fixed here
beyond answering the BL-987 canary and correcting the live-artifact pointer.
Every remaining "dark when headless" finding is a candidate for its OWN
follow-up ticket, raised below, not built.

METHOD: candidates enumerated from the code (every emitter writing to a
human-visible surface: briefing email, PWA data, phone/holistic-UI cards,
Telegram, status.json). Verdicts come from REAL headless observation - this
entire investigation was itself run headless (a terminal-only coding agent
session, no VS Code extension host with the SwarmForge VC extension loaded
driving it), against the REAL live main checkout
(`/home/carillon/swarmforgevc`), which has a real, currently-running swarm.
Live process list and live on-disk artifacts were inspected directly - not
reasoned about from source alone.

BL-987 BRANCH ANSWERED: **a headless caller was added** (BL-350:
`handoffd.bb:resource-sample-sweep!` -> `sample-resources.js`). H1 is no
longer dark. The July archive `chaser-2026-07.jsonl` is NOT the live file;
the audit now resolves `chaser-<YYYY-MM>.jsonl` at run time.

## Enumeration + verdicts

### Runs headless (confirmed live, real daemon/workflow-driven, no vscode.* in the path)

| Emitter | Trigger | Headless caller |
|---|---|---|
| Handoff delivery/wake, canary, chase/nudge/respawn, dispatch-gap auto-route, context-clear injections | `handoffd.bb -main` poll loop | `handoffd.bb` itself (confirmed live: pid running, started 2026-07-13T10:15 per `ps aux`) |
| Daily briefing email (BL-214) | `handoffd.bb:briefing-email-sweep!` | same loop. VERIFIED LIVE in BL-335's own investigation this same session: real command run (`node extension/out/tools/render-briefing-diagrams.js`), real log evidence of real sends |
| Briefing generation/banked compose (BL-258) | `handoffd.bb:briefing-generation-sweep!` | same loop |
| Cost-health sidecar `docs/briefings/<date>.json` (BL-272) | `handoffd.bb:emit-cost-health-sidecar!` | same loop. VERIFIED LIVE 2026-08-25: `docs/briefings/2026-08-25.json` exists; `resourceAnomalies` length 8 (populated via BL-350 sampling) |
| Resource-anomaly sampling (H1 / BL-350) | `handoffd.bb:resource-sample-sweep!` -> `extension/out/tools/sample-resources.js` | CONFIRMED LIVE: current-month `chaser-*.jsonl` on the main checkout carries resource_sample rows written continuously while no VS Code SwarmForge host is driving this session |
| Operator status.json, idle-nudge/linked-ticket-status/awaiting-answer, BL-topic approval consumption, auto-hibernate/relaunch, front-desk starvation alarm (BL-345), tunnel keep-alive | `operator_runtime.bb tick!` loop | `operator_runtime.bb` itself (confirmed live: pid running, started 2026-07-13T10:15) |
| Bridge (`/pipeline /agents /backlog /metrics /holistic /events(SSE) /gate-answer /telegram-inbound ...`) - the phone-card/holistic-UI surface | `front_desk_supervisor.bb:spawn-bridge!` | CONFIRMED LIVE via real `ps aux`: `node .../start-bridge-headless.js` running, pid started 2026-07-13T10:15 - **but see Finding G1, nothing auto-starts this on boot** |
| Telegram Front Desk Bot / Concierge topic messages | `front_desk_supervisor.bb:spawn-bot!` | CONFIRMED LIVE: `node .../telegram-front-desk-bot.js` running - same G1 caveat |
| Daemon-death alarm+halt email, handoffd status | `handoffd_supervisor.bb -main` loop | CONFIRMED LIVE: pid running |
| `backlog.json`/`docs-tree.json`/`recert-batch.json` (PWA data) | `.github/workflows/backlog-dashboard.yml`, push-triggered | CONFIRMED LIVE (BL-335 investigation this session): real `curl` fetch of `https://ldecorps.github.io/swarmforgevc/backlog.json` returned real, current `suiteDurationTrend` data, `generatedAtIso` from today |
| Recert inbound webhook -> repo commit | `api/recert-webhook.js` (Vercel serverless) | Independent infra, no VS Code, no swarm daemon needed |

### Table B - dark when headless (host-only, verified by real absence of data, not by reading code)

### H1 correction (BL-987) — now runs headless

**H1 - Resource-anomaly sampling (feeds the cost-health sidecar).**
- Emitter: `extension/src/metrics/resourceTelemetry.ts` (`sampleRolesOnce` /
  `appendResourceSample`), writes `.swarmforge/telemetry/chaser-<YYYY-MM>.jsonl`.
- Trigger: host path still `extension.ts:startOrRestartResourceSampler`; **headless
  path** is `handoffd.bb:resource-sample-sweep!` (BL-350), which shells to
  `sample-resources.js` on the same cadence as other handoffd sweeps.
- Headless caller: **present** — `swarmforge/scripts/handoffd.bb` (BL-350). Grep
  today finds `resource-sample-sweep` wired into the main poll loop.
- VERDICT: RUNS HEADLESS (corrected 2026-08-25; prior 2026-07-13 verdict was
  DARK WHEN HEADLESS and is superseded).
- LIVE EVIDENCE (real, not a code reading): resolving the live monthly file the
  same way the writer does (`chaser-$(date -u +%Y-%m).jsonl` on the main
  checkout) shows thousands of `"type":"resource_sample"` rows with timestamps
  from this month through minutes before this audit. The cost-health sidecar's
  `resourceAnomalies` field is a non-empty array on today's briefing JSON.
  Re-checking the frozen July archive alone would still show the old 1022-row
  canary — that file is not live; BL-987 fixes the pointer so the audit cannot
  mistake an archive for the live system.

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

Disposition and remaining raises (NOT built here, per the ticket's own "fix nothing silently"):
1. **H1** - ALREADY SHIPPED as BL-350 (`handoffd.bb:resource-sample-sweep!`). The BL-987
   canary answer is "caller was added"; do not raise H1 again. BL-987 itself only fixes the
   audit's live-file pointer and records this corrected verdict.
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
commit can durably deliver a new raw-intake item into) - recommend the specifier spec each
remaining dark finding as its own ticket, in priority order H4 > G1/G2 > H5 > H2/H3 (H2/H3 last
because it needs a product decision before any engineering work is well-scoped).

## What was explicitly NOT done

Per the ticket's own "the output is a list, not a refactor": none of H1/H2/H3/H4/H5/G1/G2 was
fixed in this parcel. No headless caller was added, no systemd unit was written, no email path
was wired. This audit is the list; the fixes are separate, specced tickets.
