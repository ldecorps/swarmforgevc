# Article 3: Backlog Management

## 3.1 Backlog Structure
- `backlog/paused/` – Items awaiting promotion.
- `backlog/active/` – Items currently in the pipeline.
- `backlog/hold/` – Human-held items. Never auto-promote from here; they sit
  until a human moves them back to `paused/` or `active/`.
- `backlog/done/` – Completed items.

## 3.2 Promotion Rules
1. **Max Active Depth** – The coordinator must enforce `active_backlog_max_depth` (from `swarmforge.conf`).
2. **Eligibility** – Items are promoted in priority order (highest first).
3. **Orthogonality** – Avoid promoting items that conflict with active work.
4. **Expedited Defects** – A ticket of `type: defect` whose `severity:` is
   `critical` or `high` is *expedited*: among the eligible candidates it is
   promoted ahead of every non-expedited ticket, regardless of its ticket
   `priority:` value. Within the expedited set, rule 2's priority ordering
   applies unchanged.
   - **Transition**: the predicate also matches legacy `type: bug` tickets
     while any still carry that type (58 at incorporation, 2026-07-25 — all in
     `backlog/done/`, matched in case one is re-promoted). `bug` is retired
     for new tickets: always write `type: defect`. Drop `bug` from the
     predicate only once no ticket carries it.
   - **Missing `severity:` fails CLOSED**: a defect with no `severity:` field
     is NOT expedited — absence must never buy priority. The coordinator
     surfaces such tickets for triage rather than guessing a severity.
   - **Ordering only**: expedite reorders the queue; it never creates an extra
     active slot (rule 1), never overrides orthogonality (rule 3 — an
     expedited ticket that overlaps in-flight work is skipped like any other),
     never changes the mutation-heavy scheduling window (3.4), and never
     bypasses the circuit breaker (3.5) — under a throttled cap of `1`/`0`,
     expedited tickets fit in the reduced capacity or wait.
   - **Two `priority:` scales — never conflate**: this rule concerns the
     ticket YAML `priority:` (promotion order out of `paused/`) only.
     Expediting a ticket never bumps its handoff `priority:` to `00` — handoff
     priority (HANDOFF-PROTOCOL.md) reflects message routing, not work
     urgency, and the `00` lane is reserved for genuinely blocking decisions.
   - Adoption record and rationale:
     `articles/reference/expedite-defects-amendment-2026-07-25.md`
     (operator directive 2026-07-25).

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
