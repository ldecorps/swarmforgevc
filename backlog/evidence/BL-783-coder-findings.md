# BL-783 — coder findings and judgment calls (2026-08-01)

Implementation is complete: `install_freshness_cron.sh` is now called from
`start_ancillary_services.sh` (best-effort, matching the operator/front-desk/
babysitterd pattern already there), the installer's root-clobber bug is fixed,
and behavioural (not textual) tests cover the ticket's five acceptance points
end to end. `test_daemon_log_freshness.sh` and the new
`test_start_ancillary_services_freshness_cron.sh` both pass in full.

## 1. Declared invariant has no `*.property.test.js` encoding — stated reason

The ticket declares: "The freshness cron is present on any host where the
swarm has been started — no operator step, no how-to instruction, and no
manual invocation stands between shipping the checker and it running."

This invariant quantifies over the shell lifecycle start process
(`start_ancillary_services.sh` invoking `install_freshness_cron.sh` against a
real or fake `crontab` binary), not a pure JS/TS module reachable by the
property-test harness (`extension/vitest.properties.config.mjs`,
`*.property.test.js`). Per the Engineering Rules' Babashka/Clojure note and
this codebase's existing convention, `.sh`/`.bb` swarm scripts are covered by
their own deterministic shell test suite (`swarmforge/scripts/test/`) only —
there is no seam to generate this property against.

Encoded instead as deterministic behavioural shell e2e tests
(`test_start_ancillary_services_freshness_cron.sh`, scenarios 01–05), which:
run the REAL `start_ancillary_services.sh` against fixture roots with a fake
`crontab` on PATH, read back the actual installed line (never grep the start
script's source for a substring — this is exactly what the ticket's own
"behavioural, not textual" note calls out), and prove the checker named in
that line actually runs by invoking it and watching its own cron log grow.
Verified non-vacuous: reverted the wiring locally, confirmed 8 of the new
e2e checks fail, restored it, confirmed all pass again.

## 2. Considered and rejected: an eager first checker run at install time

Acceptance criterion 5 ("the checker's own log path exists and grows — the
proof is the checker having run, not the crontab line being present") could
be read as asking production code to invoke the checker once immediately on
install, so the log exists right after a start instead of waiting up to 2
minutes for the first cron tick.

Rejected: the checker's default kill/restart path is unconditional on
staleness (`daemon_log_freshness_check.sh`'s `process_daemon` restarts
whenever a watched daemon's heartbeat log is older than its threshold,
regardless of *why*). If `start_ancillary_services.sh` ran the checker
synchronously right after starting babysitterd in the same script, babysitterd
might not have written its first heartbeat line yet — the checker would read
that as stale and immediately kill-and-restart a daemon that had just started,
on every single swarm launch. Read criterion 5 instead as describing what the
TEST must prove (the checker, invoked the same way cron would invoke it,
demonstrably runs and writes to its log) rather than a new production
auto-run path — the e2e test proves this with safe command overrides
(`FRESHNESS_ANNOUNCE_CMD`/`KILL_CMD`/`START_CMD` stubbed) so proving the
wiring never risks a real kill/restart against the fixture root.

## 3. Not addressed here, worth a follow-up ticket: swarm stop doesn't touch the cron

BL-675's checker is deliberately "share no fate" with the swarm's own process
tree — it restarts a watched daemon whenever its heartbeat log goes stale,
with no awareness of *why* (crash vs. an operator's intentional
`stop_ancillary_services.sh` / `kill_all_swarm.sh`). Wiring the installer into
the start path (this ticket) doesn't change that, but it does mean the cron
line now persists across a stop unless the human clears it by hand — a
stopped swarm's handoffd/babysitterd could keep getting resurrected every 2
minutes until the crontab line is removed manually.

Left alone deliberately: BL-783's `out_of_scope` explicitly protects "the
checker's own restart/announce behaviour, which BL-675 built and tested" and
says "do not relitigate" cron's independence. Flagging for the specifier in
case a stop-path uninstall (or a stop-aware sentinel the checker consults)
is worth its own ticket — it wasn't there before this ticket only because the
cron was never auto-installed at all, so the question never came up.

## 4. Doc note (not touched — documenter's domain)

`docs/how-to/BL-675-daemon-log-freshness-watchdog.md` still tells a human to
run `install_freshness_cron.sh` by hand. That instruction is now redundant
for any host that starts the swarm through the normal lifecycle path; still
useful for a bare manual install (e.g. `./swarm ensure`-style repair). Left
the doc untouched — flagging for the documenter pass rather than editing docs
from the coder stage.

## Handoff

Forwarding to cleaner. Full test evidence in this parcel's commit message.
