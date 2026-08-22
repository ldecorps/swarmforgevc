# BL-619: Token-Burn Exhaustion Warning in the Morning Briefing

The morning briefing can lead with a warning when your projected weekly account
usage is on track to hit 100% before the next reset. This runbook explains how
to record the checkpoint the projection needs, what the warning looks like,
how it's configured, and how to troubleshoot it.

## Why a Manual Checkpoint?

Nothing in this repo can read your Anthropic account's weekly usage percentage
programmatically — no endpoint exists for it. The projection is instead
anchored on a number you read off the app on your phone and transcribe
yourself, once in a while, with one CLI line:

```bash
node extension/out/tools/usage-anchor.js record <pct> [scope] [--now <epoch-ms>]
```

- `<pct>` — the account usage percentage you see in the app, `0`–`100`
  inclusive. Anything else (a typo, out of range) is rejected with exit `1`
  and nothing is written.
- `[scope]` — optional, defaults to `all-models` (the binding limit shown in
  the app). Only pass this if you're tracking a per-model limit separately.
- `--now <epoch-ms>` — for testing only; defaults to the real clock.

Each recorded anchor appends `{atMs, pct, scope}` to
`.swarmforge/operator/usage-anchors.jsonl` (machine-local, gitignored — this
is your own account data, not something that belongs in git).

**There is no Telegram command for this yet** (out of scope for this slice,
by design) — recording an anchor is a manual CLI step you run when you happen
to check the app.

## How the Projection Works

`extension/src/metrics/burnProjection.ts`'s `composeBurnSection` derives the
warning from your anchors:

1. **Rate.** With two or more anchors recorded in the current weekly window,
   the rate uses only the *latest pair* (how fast you're burning right now,
   not dragged down by a stale early anchor). With exactly one anchor, it
   falls back to the average since the window opened (the window always
   starts at 0%).
2. **Projected exhaustion.** At that rate, when would the percentage reach
   100%?
3. **Decision.** Warn if and only if that projected instant falls *before*
   the next weekly reset. A rate at or below zero never triggers a warning.

Local transcript-derived token burn (tokens/hr, from the swarm's own usage —
`extension/src/metrics/burnRate.ts`) is reported alongside as corroborating
context, but it is never what decides whether the warning fires — only your
recorded anchors are.

## What You'll See

- **A projection exists and warns:** the warning is prepended *above* the
  rest of the briefing body (the one section that leads rather than being
  appended), and the email subject is prefixed `[TOKEN BURN WARNING] `. The
  text names the projected run-out time and the real levers you have: pause
  usage yourself, let the nightly cooldown window ([BL-617](BL-617-nightly-cooldown-window.md))
  do it for you, or lower `active_backlog_max_depth` (the Article 3.5 circuit
  breaker) to slow the swarm down. Nothing pulls any of these levers
  automatically — the section only names them.
- **A projection exists and doesn't warn:** one short status line, appended
  among the briefing's other optional sections like usual — no subject
  change.
- **No anchor recorded in the current window:** the section reports your
  local tokens/hr only, states plainly that the account-level projection is
  unavailable, and names the `usage-anchor.js record` command — it never
  guesses or fabricates a percentage.

## Configuration

Set in `swarmforge/swarmforge.conf` (both optional; shown values are the
defaults, matching the original incident's own schedule):

```
config usage_week_reset_day thu
config usage_week_reset_local 07:00
```

- `usage_week_reset_day` — the weekday your account's weekly usage resets,
  a case-insensitive weekday name or 3+ letter prefix (`thu`, `Thursday`).
- `usage_week_reset_local` — `HH:MM`, 24-hour, local wall-clock time on the
  swarm host (same posture as the cooldown window's own local-time config).
- A malformed value (typo, out-of-range) degrades the section to
  local-burn-only with a loud daemon log line — it never crashes the
  briefing send.

## Verifying End-to-End

1. Record an anchor: `node extension/out/tools/usage-anchor.js record 23`.
2. Force a projection that exhausts before the next reset — either record a
   second, higher anchor a short time later, or temporarily set
   `usage_week_reset_local` closer to now — then delete today's briefing
   `.sent` entry so the email sweep re-sends it.
3. The received email should show the warning section above the
   coordinator-authored body, the subject should carry the
   `[TOKEN BURN WARNING] ` marker, and the run-out time plus the three
   levers should be named.
4. Re-run with a low/no-growth rate: no subject marker, one status line
   among the appended sections.
5. Remove all anchors (or wait for the window to roll past them) and re-run:
   the section should report local tokens/hr only and name the anchor
   command, never a fabricated percentage.

## Troubleshooting

### The warning never appears, even with anchors recorded

- Confirm `.swarmforge/operator/usage-anchors.jsonl` actually has entries in
  the *current* weekly window — an anchor from a prior window is filtered
  out by design (each window starts fresh).
- Confirm `extension/out/tools/token-burn-section.js` and
  `extension/out/tools/usage-anchor.js` exist (`npm run compile` in
  `extension/` after a pull that touched this ticket).
- Check the daemon log for a `token-burn-section-malformed-config` line — a
  typo in either `usage_week_reset_*` conf key silently falls back to
  local-burn-only.

### The subject marker shows up but the levers/run-out time look wrong

- The run-out time is derived purely from your two most recent anchors in
  the window; a bad manual transcription (fat-fingered percentage) produces
  a bad projection. Record a fresh, accurate anchor.

### A warning fired even though you weren't actually close to the limit

- Check the anchor history — a large jump between two anchors close together
  in time (e.g. two closely-spaced anchors during a burst of manual testing)
  can produce a rate that isn't representative of steady-state usage. The
  projection always uses the latest pair, so a single unrepresentative jump
  can dominate until a following anchor updates it.
