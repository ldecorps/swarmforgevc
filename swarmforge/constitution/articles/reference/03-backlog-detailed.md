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

## 3.6 Deprecator Freshness Gate — full text

`03_backlog.md`'s own Article 3.6 text, verbatim (incorporated 2026-08-27):

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
