# Article 3: Backlog Management

## 3.1 Backlog Structure
- `backlog/paused/` – Items awaiting promotion.
- `backlog/active/` – Items currently in the pipeline.
- `backlog/done/` – Completed items.

## 3.2 Promotion Rules
1. **Max Active Depth** – The coordinator must enforce `active_backlog_max_depth` (from `swarmforge.conf`).
2. **Eligibility** – Items are promoted in priority order (highest first).
3. **Orthogonality** – Avoid promoting items that conflict with active work.

## 3.3 Coordinator Duties
1. **Intake Control** – New specs land in `backlog/paused/` (written by specifier).
2. **Promotion** – Move items to `backlog/active/` when slots are available.
3. **QA integration** – After QA approval: merge to `main`, close active ticket
   to `backlog/done/`, push `main`.
4. **Recheck on Close** – After closing a ticket, recheck `active_backlog_max_depth`
   and promote the next paused item if possible.

## 3.4 Mutation-Heavy Scheduling
- Prefer promoting **light** tickets (docs, config) during office hours.
- Defer **mutation-heavy** tickets (large code changes) to overnight.

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
