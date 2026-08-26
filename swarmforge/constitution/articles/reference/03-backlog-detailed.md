# Article 3 (Backlog Management) — detailed reference (BL-858 split)

On-demand elaboration for `03_backlog.md`. Not inlined at boot.

## 3.5 Health-Based Intake Throttling (Circuit Breaker) — full text

`03_backlog.md`'s own Article 3.5 text, verbatim, before BL-858 compressed it:

## 3.5 Health-Based Intake Throttling (Circuit Breaker)
- When swarm health signals spike — QA-bounce rate, BL-098 chase/nudge
  telemetry, daemon errors, or degraded transport (BL-121) rising meaningfully
  above their trend baseline — the coordinator lowers `active_backlog_max_depth`
  to throttle intake rather than keep feeding a malfunctioning pipeline:
  - **Degraded** (signals elevated, pipeline still moving): drop to `1` —
    stabilize one ticket at a time.
  - **Severe** (pipeline stalled or transport down): drop to `0` — freeze new
    promotion entirely until the fault is cleared.
- Restore the prior cap once the signals return to baseline; do not leave the
  throttle engaged after recovery.
- Rationale: piling tickets into a broken pipeline compounds recovery work.
  (Operator directive 2026-07-09.)
