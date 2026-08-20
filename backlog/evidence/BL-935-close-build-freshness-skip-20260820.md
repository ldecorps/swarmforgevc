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
