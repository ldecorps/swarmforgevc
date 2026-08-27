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

## 3.6 Deprecator Freshness Gate (operator directive 2026-08-27)
- Before EVERY promotion of a paused item into `backlog/active/` — the same
  sites as the onboarding contract gate (BL-262) — the coordinator MUST run
  a **deprecator freshness check** on the candidate ticket.
- **Fail-closed:** on `hold`, do NOT promote. Surface the reason to the
  specifier (note, priority `00`) — never silently skip or guess.
- **Stale premise signals** (any one is enough to hold):
  - `.swarmforge/superseded/<task>` exists for the ticket id.
  - Ticket notes or description claim `superseded-by` / `retired` / `obsolete`
    without a matching `backlog/done/` closure.
  - All `depends_on` tickets are in `backlog/done/` but the description or
    acceptance still references modules, verbs, conf keys, or behaviours
    marked RETIRED or superseded in living docs or code.
  - A repeated `spec-gap` bounce on the same ticket (see
    `.swarmforge/bounces/`) — the premise may be obsolete.
- **When the gate holds:** the specifier adjudicates — amend spec, retire
  ticket, split ticket, or confirm promote with recorded rationale. Dead logic
  is removed, not re-shipped; feature scenarios are **retired** (never
  reworded); affected docs move to `docs/deprecated/` (documenter).
- **CLI path (when shipped):** prefer
  `node extension/out/tools/deprecate-check.js <root> <BL-id>` over the manual
  checklist; until then the coordinator uses the checklist in
  `coordinator.prompt`. CLI failure fails closed — same posture as BL-262.
- **Ordering:** sits after the onboarding contract gate and before Article
  3.2.4 expedited-defect ordering. Expedite never bypasses freshness.
- **Model capability (must-have, operator 2026-08-27):** deprecator
  **execution** — freshness adjudication, `/deprecate` / `/deprecate dry`
  judgment passes, and any retirement decision — MUST run on a model that
  reasons well **across many documents at once** (tickets, specs, living
  docs, code surfaces). This is not optional polish.
  - On packs with `--seat-tier`: only a **hard** seat may claim or run the
    judgment; easy-tier and weak/local-only seats **refuse** and surface
    "needs hard-tier multi-document reasoner."
  - Tickets that build or run deprecator work carry `mutation_cost: high`
    so BL-1001 never spills them to easy seats.
  - A weak seat must not guess amend/retire/confirm — escalate to a hard
    seat or the human.
- Adoption record: **deprecator-freshness-gate-amendment-2026-08-27.md**.
  Intake: `backlog/archive/INTAKE-deprecator-stale-rules-dead-logic-docs.md`.
