# BL-624 spec-gap bounce — 2026-08-16

## Bounce received

The **documenter** bounced BL-624 to the specifier and coordinator as a
priority `00` note:

> BL-624 acceptance: is block-scalar; PRE_QA_GATE fails-closed, needs single-line

Failure class: `spec-gap`. Blamed role: **specifier** — the ticket's
`acceptance:` field is the specifier's own deliverable, and it was written as a
block scalar carrying prose. Bouncing role: documenter. Defect present at
commit `09214932d1`.

## Diagnosis — confirmed in the code, not taken on report

The report was accurate, but the mechanism needed checking because two
different gates read `acceptance:` and they behave *differently* on this input:

- **BL-880 acceptance-POINTER gate** (`acceptance_pointer_gate_lib.bb`)
  deliberately **skips** this case. Its `applicable?` excludes any declaration
  containing a newline, and also the bare `|` residue a block scalar's first
  line collapses to — "the QA edge already owns those judgements with full
  context". So this gate is silent here and is *not* the blocker.
- **BL-761 acceptance-CONTRACT gate** (`acceptance_contract_gate_lib.bb`,
  fed by `pre_qa_gate_gather_lib.bb`'s `gather-acceptance-contract-facts`) is
  the blocker. It passes the raw `acceptance:` value **straight to
  `feature-text-at-commit` as a path**. A multi-line value names no file, so
  `feature-text` is nil, the facts collapse to
  `{:declaration-readable? false}`, and `evaluate`'s first `cond` branch emits
  an `:acceptance-contract` finding and **fails CLOSED** — blocking the
  documenter's handoff to QA.

So exactly one gate had to be satisfied, and the fix is the schema's own
single-line pointer shape.

## Remediation

`backlog/active/BL-624-onboarding-facilitator-survey-to-gate.yaml`:

- `acceptance:` is now the single-line pointer
  `specs/features/BL-624-onboarding-facilitator-survey-to-gate.feature`
  (verified to exist on disk).
- The QA end-to-end procedure moved verbatim into its own `qa_e2e:` field.
- The BL-233 handler note, the scenario map and the supporting-gates list
  moved verbatim into `notes:`.

**Nothing anyone builds changes.** No scenario, gate, invariant or QA step was
added, removed or reworded — the prose was relocated, not edited. Verified
mechanically: a set-compare of distinct trimmed non-blank lines between the
pre- and post-amendment YAML shows the only two lines absent are `acceptance: |`
(the block indicator, correctly gone) and the bare path line (now folded into
the `acceptance:` line itself). Every other line survives byte-identical.

## Ledger recording — why the CLI was not used

`record-bounce.js` was **deliberately not run**. Its `--role` flag (the blamed
producing role) accepts only
`coder|cleaner|architect|hardender|documenter` — the specifier is not an
expressible value, because the specifier is pre-pipeline by design. Recording
this bounce through the CLI would have required naming an innocent pipeline
role as the producer of a defect the specifier wrote, putting false blame in
the durable ledger. That is worse than not recording it there.

Recorded instead as a hand-written `bounce_history:` entry on the ticket, with
`blamed: specifier`, which is the surface the BL-819 lifecycle ledger actually
reads. The CLI gap itself is a known, separate limitation and is not this
ticket's to fix.

## Recurrence

This is the same defect class as **BL-514** (2026-08-14), whose `acceptance:`
was likewise prose where a pointer belongs. Two occurrences from the same
author in three days is a pattern rather than a slip: the schema wants a
pointer, and supporting prose has legitimate homes (`qa_e2e:`, `notes:`) that
are easy to skip when drafting the field inline. Worth a mint-time check on
every future ticket — the specifier's own `acceptance:` line should be one
path and nothing else.
