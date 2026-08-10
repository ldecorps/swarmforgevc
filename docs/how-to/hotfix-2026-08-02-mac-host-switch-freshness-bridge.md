# Hotfix record: 2026-08-02 Mac host-switch (freshness + bridge)

After the Linux (`carillon`) → Mac host switch, overnight operations showed
three false or misleading failure modes while the mono-router pack was
otherwise advancing tickets. The operator fixed all three by hand on
2026-08-02; the fixes were ticket-less and unreviewed until adopted under
BL-789 (BL-506 adopt-and-review posture — this is that pass, not a revert).

## The three faults

1. **handoffd reported DOWN forever.** The BL-675 freshness cron tried to
   restart it every cool-off window, but cron's own PATH is `/usr/bin:/bin`,
   so the start script's `nohup bb ...` failed with `bb: No such file or
   directory` and handoffd never claimed its pidfile.
2. **babysitterd restart spam.** `.swarmforge/swarm.env` sets
   `SWARMFORGE_SKIP_BABYSITTERD=1`, which `start_ancillary_services.sh`
   honours but the freshness checker did not. Cron restarted a deliberately
   disabled daemon on every cool-off pass and warned each time.
3. **Bridge EADDRINUSE crash loop.** An orphan `start-bridge-headless`
   process held `127.0.0.1:8765` while the front-desk supervisor's own
   tracked pid was dead, producing a spawn → EADDRINUSE → give-up → re-arm
   cycle. The bridge usually stayed up via the orphan, so the log looked
   catastrophic while the system was actually fine.

Telegram announces from the checker also reported `TELEGRAM_* unset`,
because cron never loaded `swarm.env` or the fleet credentials.

## What BL-789 adopted, with corrections

The exact hand-edited files from 2026-08-02 no longer existed cleanly in the
tree by the time this was reviewed (partly superseded by later, properly
ticketed work — BL-769, BL-797 — partly stashed during an intervening
merge); BL-789 re-derived and hardened the same behaviour from the fault
descriptions above, rather than replaying a stale diff:

- **`swarmforge/scripts/daemon_log_freshness_check.sh`** — self-establishes
  its own PATH (`FRESHNESS_EXTRA_PATH_DIRS`, a curated fallback list,
  prepended to whatever PATH it inherited); honours
  `SWARMFORGE_SKIP_BABYSITTERD` directly (a launch-time policy predicate,
  deliberately separate from BL-785's `freshness_is_stopped` runtime-stop
  marker — see [the BL-675 how-to](BL-675-daemon-log-freshness-watchdog.md#cron-path-and-skip_babysitterd-bl-789-mac-host-switch-hotfix));
  loads `.swarmforge/swarm.env` alongside the telegram env files.
- **`swarmforge/scripts/install_freshness_cron.sh`** — bakes a `PATH=`
  (the interpreter's own resolved directory plus the same curated fallback
  list) directly into the installed crontab line, so a freshly-cut cron
  environment is correct without depending on the checker's own PATH-fixing
  code running in time.
- **`swarmforge/scripts/front_desk_supervisor.bb`** (+
  `front_desk_supervisor_lib.bb`'s new pure `decide-bridge-port-action`) —
  before the bridge is (re)spawned, checks who (if anyone) holds the bridge
  port. A healthy process of our own (`start-bridge-headless` in its
  cmdline, for THIS project root, answering the `/lets-talk` health route —
  the same convention `start_bridge_headless.sh` already used) is
  **adopted** (its pid is used, nothing new spawned). Anything else — an
  unrelated process, another swarm's own bridge on a port collision, or an
  unhealthy/hung bridge — has the port **freed** (`kill -TERM` then
  `-KILL` via the real `kill` binary — **not** `java.lang.ProcessHandle`,
  which on this JVM only reliably signals a process that is bb's own
  child; confirmed empirically while hardening this ticket's acceptance
  tests) before a fresh spawn.
- **`swarmforge/scripts/handoffd.bb`** — emits the BL-675 heartbeat at
  cycle **START** as well as end. Mac cycles have been observed at
  140-232s; a start-of-cycle pulse is what keeps a merely-slow cycle from
  looking identical to a wedged one (silence past the 120s threshold) until
  the whole cycle finishes.

## Corrections the review did not wave through

1. **One predicate per moment, not per call site.** `SWARMFORGE_SKIP_BABYSITTERD`
   (launch-time policy) and `freshness_is_stopped` (explicit runtime stop)
   are deliberately two separate checks, not merged into one — see the
   BL-675 how-to link above for why.
2. **Adoption verifies health, not just a listening socket.** cmdline match
   AND a live `/lets-talk` response are both required before adopting;
   either one alone free+respawns instead.
3. **Stryker concurrency.** The hand-hotfix also dropped Stryker concurrency
   8→1 (12→1 for the two Let's Talk configs) because this Mac is slower than
   the previous Linux host. Applied under BL-789, but this is a **provisional**
   change, not a confirmed steady state — no host-performance data was
   available to confirm it, only the original hotfix's own narrative. QA/the
   operator should confirm whether concurrency 1 is permanent for this host
   or should carry an expiry note; the review may split this out if it
   disagrees (it is entirely independent of the freshness/bridge fixes
   above).

## Verify

```bash
bash swarmforge/scripts/test/test_daemon_log_freshness.sh
bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-789-mac-host-switch-freshness-bridge-adopt.feature
npm run test:properties -- test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js
```

Acceptance feature:
`specs/features/BL-789-mac-host-switch-freshness-bridge-adopt.feature`.
