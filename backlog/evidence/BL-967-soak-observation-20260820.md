# BL-967 live soak observation — captured before a deliberate daemon restart

Coordinator, 2026-08-20 ~06:45Z. Recorded so a planned restart does not erase the
evidence. **This is an observation for BL-975, not a verdict — QA owns that gate.**

## Measured, daemon running the BL-967 fix
    handoffd pid 57343, uptime 43m54s
    completed heartbeat cycles: 341 -> 481 across ~8 minutes of observation
    handoffd.log growth: +77 bytes over a 4s resample (actively writing)
    freshness-incidents.log: 662 lines (baseline 661 at 05:57Z -> ONE new entry)

## Before the fix, for contrast
State `U`, log frozen for 300s+, and **one** `heartbeat cycle` line in the entire log,
with each fresh daemon re-stalling ~20 seconds after restart.

481 completed cycles against 1 is the behavioural change BL-967 promised.

## Two cautions for whoever closes BL-975
1. **`freshness-incidents.log` gained one line** (661 -> 662). Step 3 requires ZERO new
   handoffd restart entries in the window. That entry must be read and dated: it may
   predate the daemon loading the fix, since the 661 baseline was taken while the
   PRE-fix daemon was still running. If so the clean window starts later than the
   baseline and the soak needs re-basing, not failing.
2. **State `U` alone does NOT mean stalled.** This coordinator nearly misread a healthy
   daemon that way: three consecutive `ps` samples showed `U` while the log was growing
   and cycles were climbing. The reliable signals are log growth and cycle count, not
   process state. During the real stall, `U` came WITH a frozen log and 1 cycle.

## Restart notice
handoffd is being restarted deliberately at operator request to inject `RESEND_API_KEY`
into its process environment (the briefing email sweep logs
`briefing-skip-missing-key 2026-08-20.md` every cycle without it). Any
freshness-incidents entry from this restart is an ATTRIBUTABLE OPERATOR ACTION, not a
stall recurrence, and the soak window restarts from it.
