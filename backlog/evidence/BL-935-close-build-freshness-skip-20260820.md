# BL-935 close: BL-328 build-freshness sync SKIPPED, deliberately

Coordinator, 2026-08-20, closing BL-935 on QA's approval (`3dbf083ac1`, landed on main).

`build_freshness_cli.bb sync` REFUSED:

    REFUSED - uncommitted changes under the deployed code surface
      modified path(s): swarmforge/scripts/daemon_log_freshness.conf
      remedy: land the change through QA, or rerun with --override (logged, one-shot)

**I did not --override, for two independent reasons.**

1. **The blocking change is an operator mitigation I must not sweep or commit.** The
   diff raises handoffd's log-freshness threshold `120 -> 300` seconds. That is live:
   tonight's babysitter alert fired at "silent 314s (> 300s)". The 2026-08-05 outage
   record shows the 120s cron flapping the daemon was the cascade trigger, so this is
   almost certainly a deliberate human mitigation left uncommitted. Ticket-less changes
   I did not make are SURFACED, not swept.
2. **A sync would RESTART handoffd — the one action I ruled out an hour ago.** handoffd
   is currently in a confirmed silent-stall (evidence `9ad242541`); the playbook records
   that a restart does not fix it and that restarting under a freshness flap is what
   killed the swarm on 2026-08-05.

**Skipping is safe for THIS ticket.** BL-328 exists so merged code actually runs in
long-lived processes. BL-935's surface is `vitest.config.mjs` plus docs/specs — no
daemon or long-lived code (verified across its commits). Vitest is spawned fresh per
run, so the cap takes effect with no restart. Nothing merged here is left inert.

**Still owed to the human:** `daemon_log_freshness.conf` should be committed (through QA)
or reverted, on purpose. While it sits uncommitted it (a) silently gates every future
build-freshness sync and (b) is one `git checkout` from vanishing, taking the 300s
mitigation with it.

## Second skip, same reason — BL-957/BL-958/BL-960 close (2026-08-20 02:52Z)

`build_freshness_cli.bb sync` refused again, identically, on the still-uncommitted
`swarmforge/scripts/daemon_log_freshness.conf`. Not overridden, for the same two
reasons (operator mitigation I must not sweep; a sync restarts the stalled handoffd).

Ticket-specific check, since these are less clearly restart-irrelevant than BL-935:
- **BL-960** (tool_miss_heal hook registration) lands in the generated
  `.swarmforge/launch/<role>.sh`, which is written at LAUNCH time. It needs a relaunch
  or per-role respawn, not a daemon restart — a deployment note, exactly as its own
  constraints section says.
- **BL-957** (promotion gate) is invoked as a CLI per decision. The coordinator's own
  calls fork fresh and pick up new code immediately. handoffd also calls it for the
  open-slot nudge — and handoffd is currently FLAPPING (restarting every few minutes,
  see `adbe9a908`), so it re-execs the new code on its next cycle without any help.
- **BL-958** (control-plane recovery) is exercised by `swarm_ensure`, invoked fresh.

So nothing merged in this batch is left inert by the skip. The blocked sync remains a
standing debt against `daemon_log_freshness.conf`, not against these three tickets.
