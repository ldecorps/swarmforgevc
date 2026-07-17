# Intake: pre-existing mutation-survivor debt in STANDING_TOPIC_ICON code (BL-418), surfaced near BL-469

Filed by the coordinator (2026-07-17), relaying a finding the human reported directly:
a single mutation survivor discovered in the vicinity of BL-469's changes
(per-agent Telegram steering-topic icons, `extension/src/concierge/topicIcon.ts`
/ `conciergeTick.ts`) is NOT a BL-469 coverage gap — it is pre-existing debt in
the standing-topic-icon code BL-418 shipped (`backlog/done/BL-418-standing-topic-icons.yaml`,
"Iconize the standing non-ticket topics (support/intake, Operator)").

This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## What the human reported (verbatim intent, not a transcript)

The single surviving mutant near BL-469's code is actually pre-existing debt
in STANDING_TOPIC_ICON, attributable to BL-418, not to BL-469's own changes.

## Coordinator context (not a decision — specifier owns the call)

1. BL-418 is closed (`backlog/done/`) and shipped the standing-topic
   (support/intake, Operator) icon-ownership logic alongside BL-342/BL-417's
   ticket-level icon-state machine in `topicIcon.ts`/`conciergeTick.ts` — the
   same files BL-469 (per-agent steering-topic icons) touches, which is
   consistent with a shared-file survivor predating BL-469.
2. BL-469 had not yet reached the hardener's mutation pass at the time this
   was reported (still in flight: coder → cleaner → architect → hardener),
   so no hardener evidence file exists yet documenting this specific
   survivor's line/mutant id. The specifier (or whichever role picks this up)
   should confirm the exact mutant against `topicIcon.ts`/`conciergeTick.ts`
   once BL-469 reaches the hardener, rather than trusting this secondhand
   description alone.
3. Precedent for the right disposition: the hardener's own BL-423 evidence
   pass today (`backlog/evidence/bl423-control-verb-guard-equivalent-mutants-20260717.md`)
   documents equivalent-mutant survivors as NOT a coverage gap requiring a
   fix, with the reasoning written down so the pipeline doesn't re-treat the
   same survivor as a new defect on a future run. If this STANDING_TOPIC_ICON
   survivor is genuinely pre-existing BL-418 debt rather than something
   BL-469 introduced, the same posture likely applies: it should not block or
   gate BL-469's own hardening handoff, and if it warrants a real fix, that
   fix belongs to its own ticket referencing BL-418 — not folded into BL-469's
   scope.

## Ask for the swarm

Specifier: reconcile this against BL-418 and BL-469 once BL-469 reaches the
hardener (or now, from the shared code) — confirm whether the survivor is (a)
truly pre-existing BL-418 debt (write it up as its own low-priority
debt/bugfix ticket referencing BL-418, decoupled from BL-469), or (b) actually
attributable to BL-469's own change (leave it as BL-469's normal hardening
gate). Either way, make sure BL-469 is not blocked on fixing debt outside its
own scope.
