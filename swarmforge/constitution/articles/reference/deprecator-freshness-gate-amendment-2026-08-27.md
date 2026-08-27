# AMENDMENT (INCORPORATED): Deprecator freshness gate at promotion

> **Status: INCORPORATED, 2026-08-27** (Article 5.1 step 2, by the specifier).
> The binding form now lives in **Article 3.6** (constitution
> `articles/03_backlog.md`), **`coordinator.prompt`** ("Deprecator Freshness
> Gate At Promotion Time"), **`specifier.prompt`** ("Deprecator duty"),
> **`documenter.prompt`** (`docs/deprecated/` contract), and
> **`workflow.prompt`** (promotion gate pointer). This file is the adoption
> record and rationale — read the articles, not this file, for the rule in
> force.
>
> **Origin:** human directive, 2026-08-27 — implementing old paused tickets
> without a freshness check re-introduces dead logic; docs must reflect
> retirements. Intake:
> `backlog/INTAKE-deprecator-stale-rules-dead-logic-docs.md`.

## 1. The intent

Business rules, conf flags, operator verbs, and feature scenarios can become
obsolete while tickets sit in `backlog/paused/`. Promoting and implementing
such a ticket faithfully **re-ships dead logic** and leaves living docs
describing behaviour that no longer exists.

The swarm needs a standing **deprecator** duty — Boy Scout-shaped for rules,
not code — with a **fail-closed freshness gate** at promotion time so the
coordinator never feeds stale premises into the pipeline without specifier
review.

## 2. What this is not

- Not a replacement for Boy Scout (BL-1013) — that epic ranks code/ops debt.
- Not a replacement for BL-564 spec-drift — that epic reconciles OOB commits
  to specs; deprecator retires obsolete rules and tickets.
- Not auto-closing tickets — specifier retains mint/retire authority (BL-311).
- Not a ninth pipeline agent by default — a named duty on coordinator,
  specifier, and documenter until review proves a separate seat is required.

## 3. Proposed form (incorporated)

1. **Freshness gate (coordinator, fail-closed).** Before EVERY promotion of a
   paused item into `backlog/active/` — same sites as the onboarding contract
   gate — run a deprecator freshness check. On `hold`, do NOT promote; surface
   the reason to the specifier (note, priority `00`) rather than silently
   skipping.
2. **Manual checklist until CLI lands.** When
   `node extension/out/tools/deprecate-check.js <root> <BL-id>` is not yet
   available, the coordinator applies the checklist in `coordinator.prompt`.
   Gate errors fail closed — same posture as BL-262.
3. **Specifier adjudication.** When the gate fires, the specifier chooses:
   amend spec, retire ticket (`closed_as: superseded-by-<id>`), split ticket,
   or confirm promote with recorded rationale — never silent promotion.
4. **Dead logic removal.** When retiring: remove superseded code paths and
   conf keys; **retire** feature scenarios (never reword); documenter moves
   affected pages to `docs/deprecated/` and links from `docs/index.md`.
5. **On-demand deprecator pass.** `/deprecate` operator verb and Boy Scout
   slice 3 are tracked in the intake; this amendment binds the **promotion
   gate** immediately.

## 4. Gate ordering at promotion

Subordinate to nothing except human `hold/` and ambulance freeze; sits **after**
the onboarding contract gate (BL-262) and **before** expedited-defect ordering
(Article 3.2.4). A stale ticket is never expedited around the freshness gate.

## 5. Where this lands once agreed

- **Article 3.6** — deprecator freshness gate.
- **`coordinator.prompt`** — enforce at every promotion site.
- **`specifier.prompt`** — adjudication duty when gate fires; consolidation
  pass already retires superseded paused tickets at epic promotion — deprecator
  makes that continuous.
- **`documenter.prompt`** — `docs/deprecated/` contract when logic is removed.
- **`workflow.prompt`** — pointer so every role knows the gate exists.

## 6. Explicitly out of scope for this amendment

- Implementing `/deprecate` CLI (intake slice — gate works manually first).
- Big-bang retirement of all stale paused tickets without per-item human/specifier
  adjudication.
- Changing quality gates or active-slot caps.

## 7. Model capability lock (operator 2026-08-27 ~07:28 BST)

Human: deprecator must be executed only by a model that can reason across
multiple documents very well — a must-have.

Binding form: Article 3.6 "Model capability"; `mutation_cost: high` on
deprecator tickets (BL-1172/1173/1174); specifier + operator refuse
judgment on easy/weak seats.
