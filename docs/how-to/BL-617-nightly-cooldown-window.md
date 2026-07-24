# BL-617: Nightly Cooldown Window

The swarm can automatically pause itself overnight so it stops burning plan tokens while the human sleeps, then resume on its own in the morning. This runbook explains what the cooldown window is, how it differs from a manual pause, how it is configured, how to check its state, and how to troubleshoot it.

## What Is the Cooldown Window?

The cooldown window is a **scheduler**, not a new pause mechanism. It rides on top of the existing timed-pause machinery (BL-423): when the configured window opens (default `19:00` local), it applies the same timed pause a human would apply from the Telegram Control topic, with `untilMs` set to the window's close time (default `07:00` local next day). When that time arrives, the swarm's existing pause-auto-resume sweep clears the pause and posts the same "Resumed" announcement it always has.

Nothing is killed. An agent mid-turn simply finishes its current bit and is not woken again until the window closes.

### Cooldown vs. Manual Pause

| Aspect | Manual pause (Telegram) | Cooldown window |
|---|---|---|
| **Trigger** | Human taps a pause button | The configured window opens automatically |
| **Writer** | `telegram-front-desk-bot.ts`'s `applyPause` | `apply-cooldown-pause.js` (same `writeControlPauseState` writer) |
| **State file** | `.swarmforge/operator/control-pause.json` | Same file |
| **Frequency** | Whenever a human acts | At most once per configured window instance |
| **Resume** | Human taps "Resume now", or the timer expires | The window's own close time (via the existing auto-resume sweep) |

Because both write the *same* pause state file, every other part of the swarm that already understands a pause (promotion freeze, delivery freeze, chase suppression below) treats a cooldown pause exactly like a human one - there is only one pause concept, just two ways to trigger it.

## Configuration

Set in `swarmforge/swarmforge.conf` (read fresh on every sweep tick - no restart needed to pick up a change):

```
config cooldown_window_enabled true
config cooldown_start_local 19:00
config cooldown_end_local 07:00
```

- `cooldown_window_enabled` - `true` or `false`. Absent defaults to `false` (disabled).
- `cooldown_start_local` / `cooldown_end_local` - `HH:MM`, 24-hour, **local wall-clock time on the swarm host** (not UTC - unlike `briefing_morning_time_utc`). Absent defaults to `19:00` / `07:00`. The window may span midnight.
- A malformed time (e.g. `25:99`) disables the window for that sweep and logs a loud warning - it never crashes the sweep, and it never guesses a partial value.

## What Actually Happens

1. `handoffd.bb`'s poll loop runs a `cooldown-sweep!` on the same cadence as every other sweep (`chase-sweep-every-cycles`, ~10s), shelling to the compiled `extension/out/tools/apply-cooldown-pause.js` CLI.
2. That CLI reads the config, the current pause state, and a "which window instance was already handled" marker at `.swarmforge/operator/cooldown-window.json` (`{lastHandledWindowStartMs}`).
3. If the window is open, no pause is currently active, and this window instance hasn't been handled yet, it writes the timed pause (`writeControlPauseState`), stamps the marker, and posts an announcement to the Telegram Control topic naming the resume time (skipped gracefully if Telegram isn't configured - the pause still applies).
4. **At most one automatic pause per window.** If a human taps "Resume now" while inside an open window, that action also stamps the marker - the swarm stays resumed for the rest of that window rather than being immediately re-paused on the next sweep tick. The cooldown will apply again at the *next* window open.
5. While ANY pause is active (human or cooldown), `handoffd.bb` also freezes its own outbound wake activity: no parcel delivery into a recipient's inbox, no chase nudges, no dispatch-gap/unassigned-active/open-slot nudges to the coordinator, and no startup notify. A parcel handed to `swarm_handoff.sh` during the window is still accepted into the sender's outbox - it just sits there, undelivered, until the pause clears, then delivers on the very next poll cycle.
6. At the window's close time, the existing pause-auto-resume sweep (`resume-expired-pauses.js`, unchanged since BL-423) clears the pause and posts the "Resumed" announcement. Delivery and chase resume immediately.

## Checking Cooldown State

The pause state file is the one externally readable source of truth every process (human, this swarm, an operator-layer babysitter) should read - never infer "the swarm looks idle" from silence alone:

```bash
cat .swarmforge/operator/control-pause.json
```

- `{"active":false}` - not paused, normal operation.
- `{"active":true}` - paused with no timer (a human "pause until I resume").
- `{"active":true,"untilMs":1753382400000}` - paused until that epoch-ms (either a human timed pause or the cooldown window).

To see which window instance the cooldown has already handled:

```bash
cat .swarmforge/operator/cooldown-window.json
```

## Verifying Without Waiting for the Real Clock

The CLI takes an injected clock and a dry-run flag, so the decision can be proven any time of day without touching real state:

```bash
node extension/out/tools/apply-cooldown-pause.js --now <epoch-ms> --dry-run
```

This prints the decision (`{"decision":"none"}` or `{"decision":"apply-pause","untilMs":...}`) without writing the pause marker, the window-consumed marker, or posting any announcement. Drop `--dry-run` to actually apply it.

## Troubleshooting

### The swarm didn't pause at the configured time

- Confirm the three conf lines are present and correctly spelled in `swarmforge/swarmforge.conf` (a typo'd key name is silently absent, which degrades to disabled/defaults - it will not error).
- Check the daemon log for a `cooldown-sweep` line each cadence tick; a `cooldown-sweep-error` line names the CLI's exit code and stderr.
- Confirm `extension/out/tools/apply-cooldown-pause.js` exists (`npm run compile` in `extension/` after any pull that touched this ticket's TypeScript).
- If a human pause was already active when the window opened, the cooldown correctly does nothing - that pause is never overridden. It will apply on the *next* window that opens with no active pause.

### The swarm didn't resume in the morning

- This is the same auto-resume path BL-423 has always used - check `.swarmforge/operator/control-pause.json`'s `untilMs` against the current time, and look for a `pause-auto-resume-sweep-error` log line.
- A pause applied with no `untilMs` (an "until I resume" pause) never auto-expires - only a human "Resume now" or another cooldown-apply clears it. The cooldown window always applies its own pause WITH an `untilMs`, so this should not occur from the cooldown path itself.

### The cooldown re-paused the swarm right after a human resumed it mid-window

- This should not happen: a human "Resume now" tapped while a window is open also stamps the window-consumed marker, so the cooldown will not re-apply until the *next* window. If it does, check `.swarmforge/operator/cooldown-window.json`'s `lastHandledWindowStartMs` against the window's actual start time - a clock skew between the host and the marker's assumptions is the most likely cause.

### A parcel seems stuck overnight

- Check `.swarmforge/operator/control-pause.json` first. If a pause is active, this is expected - delivery and chase are both intentionally frozen. The parcel is still safely enqueued and will deliver on the first poll cycle after the pause clears; nothing is lost or killed.
