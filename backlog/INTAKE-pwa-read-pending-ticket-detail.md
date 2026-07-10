# INTAKE: read a pending ticket's detail (description + acceptance scenarios) from the phone-app approval flow

Source: operator direction 2026-07-10 (via coordinator): the phone app lists
tickets needing approval but the operator cannot READ what they are approving.
"can I read about them via the phone app?" -> operator wants to tap a
needs-approval entry and read the ticket.

## The gap (coordinator verified)
BL-251 shipped a "needs approval" list in the PWA + briefing, but it renders
ONLY id + title:
  - `pwa/app.js:321` renderNeedsApproval: `li = t.id + ' — ' + t.title`.
  - The projection `extension/src/metrics/backlogDashboard.ts` computeNeedsApproval
    (filter humanApproval === 'pending' over active+paused) carries NO description
    and NO acceptance scenarios.
So the operator sees WHICH tickets await approval but cannot read the ticket
(its description) or the acceptance scenarios they are being asked to approve.

## Want (observable)
- From the phone-app needs-approval list, the operator can open a pending ticket
  and READ: its description (the ticket body / what it will do) AND its acceptance
  scenarios (the Gherkin the ticket will be built against).
- With that, the operator can understand what they are approving without leaving
  the phone.
- READ-ONLY in this ticket. Actually approving/flipping human_approval from the
  phone is a SEPARATE, security-sensitive control action (same class as the
  gate-answer client, gap #10) — explicitly OUT OF SCOPE here; do not add an
  approve/write action in this ticket.

## Fit / reuse (verify live paths before naming files)
- The needs-approval projection is computed in backlogDashboard.ts
  (computeNeedsApproval); extend the needsApproval entries (or a paired feed) to
  carry the ticket DESCRIPTION and a reference to its acceptance scenarios.
- Acceptance scenarios: the docs drill-down already surfaces Gherkin via
  docs-tree.json (BL-117 / gherkinScenarios.ts) — but that path is oriented to
  IMPLEMENTED features. A pending ticket's acceptance is its `.feature` DRAFT under
  specs/features/ (authored by the specifier, human_approval pending). Reuse the
  existing Gherkin-parsing/rendering plumbing to show the pending ticket's draft
  scenarios; do not build a second parser.
- PWA render: extend the needs-approval UI so an entry is expandable/drill-in to
  the description + scenarios, reusing the existing docs-scenario render helpers.

## Constraints
- READ-ONLY / PRESENTATION: reads git-tracked backlog + feature files
  (reproducible — may ride backlog.json / docs-tree.json, unlike machine-local
  data, BL-252 boundary). NO new authoritative store; NO approve/write action.
- SINGLE SOURCE: the description + scenarios shown come from the SAME committed
  ticket YAML + `.feature` the swarm builds against — the phone never shows a
  different version than what will be built.
- KNOWN PROPERTY (note, not in scope): the deployed PWA reflects PUSHED main; a
  pending ticket appears once a QA landing pushes it (coordinator bookkeeping is
  unpushed by design, BL-247). This ticket does not change that cadence.
- LOCALIZATION (BL-229/230) + a11y (BL-238) for the new UI; localized empty state.
- TESTABLE host-side: the projection extension (ticket -> description + scenarios
  entry) is a pure fixtured unit; the PWA render logic tested with jsdom fixtures
  (pwaDocsExplorer.test.js precedent) — no live repo.
- PWA-LANE SERIALIZATION (coordinator orthogonality): touches pwa/app.js — the
  BL-257/261/263-etc lane; serialize at build time.

## Delivery
Buildable now (reuses BL-251 needs-approval feed + BL-117 Gherkin render). Priority:
operator to set; suggest normal (directly enables approving on the go). Likely one
slice; specifier may split projection-vs-render. Park in paused for operator approval.
