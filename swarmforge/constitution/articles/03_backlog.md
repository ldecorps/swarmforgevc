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
     while any still carry that type. `bug` is retired for new tickets —
     always write `type: defect`. Drop `bug` from the predicate only once no
     ticket carries it. See **expedite-defects-amendment-2026-07-25.md** §3.1
     for the legacy-count evidence.
   - **Missing `severity:` fails CLOSED**: a defect with no `severity:` field
     is NOT expedited — absence must never buy priority. The coordinator
     surfaces such tickets for triage rather than guessing a severity.
   - **Ordering only**: expedite reorders the queue only — never an extra
     active slot (rule 1), never overrides orthogonality (rule 3), the
     mutation-heavy window (3.4), or the circuit breaker (3.5); under a
     throttled cap of `1`/`0`, expedited tickets fit the reduced capacity or wait.
   - **Two `priority:` scales — never conflate**: this rule concerns the
     ticket YAML `priority:` (promotion order) only. Expediting a ticket
     never bumps its handoff `priority:` to `00` — that lane is reserved for
     genuinely blocking decisions. See **expedite-defects-amendment-2026-07-25.md**.

## 3.3 Coordinator Duties
1. **Intake Control** – New specs land in `backlog/paused/` (written by specifier).
2. **Promotion** – Move items to `backlog/active/` when slots are available.
3. **Post-QA bookkeeping** – after QA approval, move the ticket from
   `backlog/active/` to `backlog/done/`. Run no git merge or push: QA lands the
   approved commit on `main` and pushes origin itself (BL-247, Article 1.1).
4. **Recheck on Close** – After closing a ticket, recheck `active_backlog_max_depth`
   and promote the next paused item if possible.

## 3.4 Mutation-Heavy Scheduling
- Prefer promoting **light** tickets (docs, config) during office hours.
- Defer **mutation-heavy** tickets (large code changes) to overnight.

## 3.5 Health-Based Intake Throttling (Circuit Breaker)
- When swarm health signals spike (QA-bounce rate, BL-098 chase/nudge
  telemetry, daemon errors, degraded transport BL-121) meaningfully above
  trend baseline, the coordinator lowers `active_backlog_max_depth`: drop to
  `1` if **degraded** (signals elevated, pipeline moving), `0` if **severe**
  (stalled/transport down). Restore the prior cap once signals normalize —
  never leave the throttle engaged after recovery. See
  **03-backlog-detailed.md** for the full pre-trim wording (operator
  directive 2026-07-09).
