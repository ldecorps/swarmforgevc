# HOTFIX AMENDMENT: newly minted critical/high-severity defects are auto-approved into the expedite lane

> **Status: HOTFIX, 2026-09-17, by the human via Claude Code.** Applied
> directly (Article 5.1's normal route — new article -> `git_handoff` to the
> specifier -> specifier incorporates -> QA lands -> coordinator bookkeeping —
> is bypassed here, same as any other operator hotfix) because the rule is
> operative immediately, not after a pipeline round trip. The binding text
> lives in **Article 3.2 rule 4** (`swarmforge/constitution/articles/03_backlog.md`)
> and **`specifier.prompt`** ("Human approval is a STRUCTURED field"). This
> file is the adoption record and rationale; read the articles for the rule
> in force. Recorded in `backlog/hotfix-ledger.yaml` by the swarm's own
> hotfix-detection sweep against the commit that carries this file — a
> stamp ticket follows automatically, same as every other hotfix, and the
> specifier should review this file at its next Article 5.1 opportunity and
> fold it into the constitution proper rather than leaving it as a
> reference-only amendment indefinitely.
>
> **Origin:** operator directive, 2026-09-17 — "New high defect[s] can be
> jumped automatically."

## 1. The intent

Article 3.2 rule 4 already promotes a `type: defect` with `severity: critical`
or `high` ahead of every non-expedited ticket — but ordering is not approval.
Today that same ticket still mints `human_approval: pending` like any other
new feature file (`specifier.prompt`, "Human approval is a STRUCTURED field"),
so it sits waiting for a human tap before it can be pulled at all, even though
the queue has already decided it goes first. The operator wants that wait
removed for exactly this class: a newly minted critical/high defect should be
able to enter the expedite lane the moment it is specced, with no approval
round trip in front of it.

## 2. The rule

A ticket qualifies for **auto-approval at mint** when ALL of the following
hold:

1. `type: defect` and `severity: critical` or `severity: high` (the same
   predicate Article 3.2 rule 4 already uses for expedite ordering — this
   rule rides that eligibility, it does not widen it).
2. The specifier is filing it from its own judgment (a defect it discovered,
   or one named in an intake/note) — **not** a ticket whose `approval_context`
   poses a genuine choice. If the ticket declares `ruling_options`, this rule
   does **not** apply: a real ruling still needs the human's answer regardless
   of severity, per the existing `ruling_options`/`ruling_tradeoffs` rule
   (BL-1300, BL-1531) — auto-approval is about not blocking on approval-to-
   proceed, not about deciding an open question on the human's behalf.
3. The ticket is minted with `human_approval: approved` directly (never
   `pending` then silently flipped) and its `notes:` field states, verbatim:
   `AUTO-APPROVED under the 2026-09-17 operator hotfix (severity defect, no
   ruling_options) — see auto-approve-high-severity-defects-amendment-20260917.md.`
   so the exception is grep-able and auditable, never indistinguishable from
   an ordinary human tap.

Everything else about the ticket is unchanged: it still needs a feature file,
an `acceptance:` pointer, and every other mint-time gate; Article 3.6's
freshness gate and Article 3.2's WIP cap still apply at promotion; the human
can still amend, re-pend (to raise a ruling they want to weigh in on after
all), or reject it after the fact through the normal channels — auto-approval
only removes the wait, not the human's later say.

## 3. Why the scope is this narrow

- **Ordering already selected this class.** Article 3.2 rule 4 already
  decided a critical/high defect jumps every non-expedited ticket in the
  queue; auto-approval just stops it from queuing behind a human tap too,
  for the class the constitution already trusted to go first.
- **No genuine choice is ever auto-decided.** The `ruling_options` carve-out
  keeps this rule from silently answering something only the human should
  answer — it removes a WAIT, never a DECISION.
- **The exception is legible, not silent.** The required `notes:` sentence
  means a human scanning `paused/`/`active/` — or a future review of this
  amendment — can find every auto-approved ticket by the string
  `AUTO-APPROVED under the 2026-09-17 operator hotfix`, the same discipline
  Article 5.3 expects of every consolidation.
