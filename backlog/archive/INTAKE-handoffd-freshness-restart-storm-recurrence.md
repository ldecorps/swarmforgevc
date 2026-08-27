# INTAKE 2026-08-20 — handoffd freshness restart-storm recurrence (300s threshold)

**Raised by:** human via Cursor, 2026-08-20 ~00:34 CEST, from an Operator-topic
Telegram screenshot showing five consecutive `FRESHNESS_VIOLATION restart
daemon=handoffd` alerts (~every 6 minutes).

**Related prior work:** `.swarmforge/operator/archive/INTAKE-handoffd-freshness-restart-storm.md`
(2026-08-16) → BL-902/903/904 (all in `backlog/done/M8/`). BL-902 shipped the
briefing-email "compose-before-key-check" fix. This recurrence is **not** the
same stall signature — see below.

## Symptom

The Operator Telegram `# Operator` topic shows a repeated stream of:

    FRESHNESS_VIOLATION restart daemon=handoffd age_secs=320–362 threshold=300

Sample host-local times from the screenshot: 00:08, 00:14, 00:20, 00:26, 00:32.
Each alert is a kill+restart by `daemon_log_freshness_check.sh` (BL-675), not
an escalate/cool-off (those appear only when a second violation lands inside
the 300s cool-off window).

The watchdog is doing its job. The daemon process is alive but its poll cycle
goes silent longer than 300s, cron kills/restarts it, and the loop repeats.

## Live state at filing time (2026-08-19 ~23:42 UTC)

- `handoffd` pid alive (bb process, ~4 min old at check time).
- `.swarmforge/daemon/handoffd.log` — 12 lines only, last entry:
  `2026-08-19T23:38:51.507755Z chase-respawn QA …/launch/QA.sh`
- Last heartbeat log line: `heartbeat cycle=0-start` at 23:38:37 — no
  end-of-cycle heartbeat yet.
- Restart cadence tonight: ~every 6 minutes (cron check interval), 30+
  handoffd restarts since ~20:38 UTC alone (`freshness-incidents.log`).
- Threshold in `swarmforge/scripts/daemon_log_freshness.conf`: **300s** for
  handoffd (was 120s when the Aug-16 intake was filed).

## Observed stall signature (different from BL-902)

Aug-16 intake / BL-902: silent gap between `lifecycle-snapshot-ensured` and
`email-misconfigured` (~96s briefing-email compose before key check).

**Tonight:** cycle 0 reaches chase-sweep (multiple `chase-wake-skip-busy` for
coder/architect/hardender, then `chase-respawn QA`), then goes silent. No
`lifecycle-snapshot-ensured`, no `email-misconfigured`, no `push-sweep` lines
in the current log file at all — the stall is **after chase-sweep starts, before
any later sweep logs**.

Process sampler at check time: main thread blocked in `read`/`open` syscalls
(likely a subprocess or file I/O inside one of the cycle-0 sweeps that run
after `chase-sweep!` — dispatch-gap, flow-watchdog, briefing-generation,
push-sweep, master-main-reconcile, etc.).

## Human directive

> Let specifier deal with that.

Direction (not mandate): mint a defect. Identify which sweep blocks cycle 0
past 300s and fix the real wait — do **not** "fix" by raising the threshold
alone (BL-789 documented Mac cycles near 120–232s for slow-but-healthy work;
this is silence with no end-of-cycle heartbeat). Consider whether BL-902's fix
is incomplete, whether a new sweep regressed, or whether cycle-0's sweep bundle
is simply too heavy for a 300s budget on this host.

This is **not** currently a swarm-down emergency: cool-off/restart keeps it
self-healing, at the cost of handoff latency, chase freshness, and Telegram
noise every ~6 minutes.

## Evidence paths

- `.swarmforge/daemon/handoffd.log` — current-cycle stall point
- `.swarmforge/daemon/freshness-incidents.log` — restart history + ages
- `.swarmforge/daemon/freshness-check.cron.log` — cron-side restart audit
- `swarmforge/scripts/daemon_log_freshness.conf` — threshold=300 for handoffd
- Prior intake archive: `.swarmforge/operator/archive/INTAKE-handoffd-freshness-restart-storm.md`

---
DISPOSITIONED by specifier 2026-08-20 (~00:15Z): minted 1:1 as backlog/paused/BL-967-handoffd-cycle-stall-bounded-waits-and-sweep-boundaries.yaml (defect/high, expedited). Operator directives quoted verbatim in the ticket description per Article 5.3. Specifier probe added a fresh stall capture (skip-busy coordinator after a 7-in-2.5s QA skip-busy burst) pinning the block to the chase loop tail / silent post-chase sweeps.
