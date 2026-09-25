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


## 3.2 rule 4 "Expedited Defects" - full text (boot-inlined article, pre-2026-09-25 trim)

`03_backlog.md`'s rule 4, verbatim, before the specifier compressed it on
2026-09-25 to bring the boot prefix back under the BL-859 budget (44954
chars measured against 44000; nothing in the rule changed):

4. **Expedited Defects** – A ticket of `type: defect` whose `severity:` is
   `critical` or `high` is *expedited*: among the eligible candidates it is
   promoted ahead of every non-expedited ticket, regardless of its ticket
   `priority:` value. Within the expedited set, rule 2's priority ordering
   applies unchanged.
   - **Transition** (legacy `type: bug`): **expedite-defects-amendment-2026-07-25.md** §3.1.
   - **A standing red rides this lane** (2026-09-05): a test failing on
     `main` is `type: defect`, `severity: high` at first sighting; see
     **standing-red-register-amendment-2026-09-05.md**.
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
   - **Auto-approved at mint** (operator hotfix, 2026-09-17): a
     newly minted ticket that qualifies for this rule (`type: defect`,
     `severity: critical` or `high`) is minted `human_approval: approved`
     directly — no human tap gates it before promotion — UNLESS its
     `approval_context` poses a genuine choice, in which case it still
     declares `ruling_options` and mints `pending` like any other ruling; a
     real ruling is never auto-decided by severity alone. See
     **auto-approve-high-severity-defects-amendment-20260917.md**.
