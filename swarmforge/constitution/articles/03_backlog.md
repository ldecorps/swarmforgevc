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
4. **Expedited Defects** – A `type: defect` with `severity: critical` or
   `high` is promoted ahead of every non-expedited eligible ticket, whatever
   its ticket `priority:`; rule 2 orders within the expedited set. A standing
   red on `main` is `high` at first sighting
   (**standing-red-register-amendment-2026-09-05.md**). A missing
   `severity:` fails CLOSED: never expedited, surfaced for triage. Ordering
   only: never an extra slot, never past rules 1 and 3, 3.4 or 3.5. It never
   bumps the handoff `priority:` to `00` (two scales, never conflated). A
   qualifying defect mints `human_approval: approved` unless its
   `approval_context` poses a real choice (`ruling_options`,
   **auto-approve-high-severity-defects-amendment-20260917.md**). Full text
   and the legacy `type: bug` transition: **expedite-defects-amendment-2026-07-25.md**,
   **03-backlog-detailed.md** §"3.2 rule 4".

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
  telemetry, daemon errors, degraded transport BL-121, standing reds:
  register over 10, oldest over 7 days, or any unowned — BL-1429) above
  trend baseline, the coordinator lowers `active_backlog_max_depth`: drop to
  `1` if **degraded** (signals elevated, pipeline moving), `0` if **severe**
  (stalled/transport down). Restore the prior cap once signals normalize —
  never leave the throttle engaged after recovery (operator directive
  2026-07-09). See **03-backlog-detailed.md**.

## 3.6 Deprecator Freshness Gate (operator directive 2026-08-27)
- Before EVERY promotion of a paused item into `backlog/active/` — same
  sites as the onboarding contract gate (BL-262) — the coordinator MUST run
  a fail-closed **deprecator freshness check**: on `hold`, do NOT promote,
  surface the reason to the specifier (note, priority `00`). The specifier
  then adjudicates (amend, retire, split, or confirm); retirement removes
  dead logic, retires (never rewords) feature scenarios, and moves affected
  docs to `docs/deprecated/`.
- **Model must-have:** deprecator execution (freshness adjudication,
  `/deprecate` judgment, retirement decisions) runs only on a hard-tier
  model that reasons well across many documents; easy/weak seats refuse.
- Full stale-premise signal list, CLI path, gate ordering, and seat-tier
  mechanics: **03-backlog-detailed.md** §3.6 "Deprecator Freshness Gate —
  full text". Adoption record: **deprecator-freshness-gate-amendment-2026-08-27.md**.
  Intake: `backlog/archive/INTAKE-deprecator-stale-rules-dead-logic-docs.md`.
