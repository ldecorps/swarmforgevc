# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-17T08:23:50Z) - a directive came in from the human operator
(via the operator console) that is a new feature, not a desk call. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root item and
decides what (if anything) becomes a real ticket.

## The question

Add a fourth button to the Telegram approval ask: "Expedite".

### What it should do (human's words)

Expedite must not only APPROVE the ticket but also place it straight onto the
swarm to be built immediately, REGARDLESS OF ORTHOGONALITY / SEQUENCING TRIAGE.
I.e. it is "approve + jump the queue + dispatch now", where a plain Approve today
only records the decision and leaves promotion to the coordinator's normal
sequencing.

### Operator-gathered facts (context, not a spec)

- The approval ask currently renders exactly three inline buttons in
  extension/src/concierge/topicRouter.ts:202-204 - Approve / Amend / Reject,
  callback_data `approve:<id>` / `amend:<id>` / `reject:<id>` (the BL-410 flow).
- Those verbs are dispatched in
  extension/src/tools/telegramFrontDeskBotCore.ts:361-378 (approve/reject/amend
  branches). A new `expedite:<id>` verb would slot into the same round-trip -
  reuse BL-410's plumbing, never a second callback path.
- A plain Approve today only flips the ticket's `human_approval` to approved on
  disk; the ticket then waits in paused/ until the COORDINATOR promotes it during
  normal sequencing. Expedite = record approval + force-promote paused->active +
  dispatch to build NOW, bypassing the coordinator's orthogonality/sequencing
  step. (This session the human had to send the coordinator a manual promote +
  build-next note to achieve by hand exactly what this button would automate.)

### Design/risk notes for the specifier + architect (their call, not mine)

- ONE effect path: expedite's "approve" half must route through the SAME
  recordApprovalReply effect a typed reply / Approve tap already uses - never a
  divergent second approval path.
- DEPENDS ON / overlaps BL-484 (a decided ask must strip its buttons and show the
  verdict): an Expedite tap is a decision too, so it must close the ask the same
  way - "-- Expedited <time> UTC". Sequence after or fold into BL-484's one
  closing routine.
- Rendering the 4th button overlaps BL-483 (option buttons) button-layout work.
- THE REAL HAZARD the human is knowingly opting into: bypassing orthogonality
  triage can dispatch a ticket that shares files with in-flight coder work
  (memory precedents: an in-flight coder task cannot be preempted; same-file
  tickets must be serialised; the standing-topic overlap cluster). The human
  explicitly wants the queue-jump "regardless of orthogonality" - but the
  specifier/architect should decide whether Expedite still serialises at the
  FILE level (dispatch immediately unless a same-file task is mid-flight, else
  queue right behind it) or truly forces past everything, and surface a clear
  toast if a forced dispatch is unsafe. Capture the human's intent (force it);
  let the architect pick the safe mechanism.
- Access/guard: Expedite is a stronger action than Approve - the specifier may
  want it gated to the same human identity the other buttons already trust
  (no new auth model implied here, just a flag to consider).
