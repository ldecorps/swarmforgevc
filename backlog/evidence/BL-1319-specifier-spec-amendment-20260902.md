# BL-1319 — specifier amendment answering the coder's spec-gap note

Date: 2026-09-02 · Trigger: coder priority-00 `note`
"BL-1319 spec gaps: seats are DROPPED not split; sc-03 clause unsatisfiable".

**Both findings upheld. Both were mint-time specifier defects.** The coder
raised them before writing code and routed them as a `note`, which is the
correct route for a spec gap (Article 4.4) — no parcel, no bounce commit, so
nothing to hand `record-bounce.js`.

## Finding 1 — the seat is dropped, not split (UPHELD)

Verified in the live source, not taken on report:

- `extension/src/metrics/stageDwell.ts:276`
  `const pipelineRoles = roles.filter((r) => (PIPELINE_ORDER as string[]).includes(r.role));`
- `extension/src/metrics/swarmMetrics.ts:60`
  `export const PIPELINE_ORDER = ['specifier','coder','cleaner','architect','hardender','documenter','QA'];`

Bare stage names only. `coder@sonnet2` is not a member, so the entry is
filtered out **before** `readRoleStageDwellRecords` is called on it. Its
mailbox is never opened; its parcels never become records.

What the mint text got wrong:

| mint claim | reality |
|---|---|
| a two-seat stage contributes two rows | it contributes ONE — the bare seat's |
| the stage's dwell is SPLIT before ranking | the second seat's dwell is ABSENT |
| the coordinator is told a SEAT is the bottleneck | impossible; no seat-keyed row can exist |

The consequence that justifies the ticket survives: a genuinely-slowest stage
can still rank below a faster one. It arrives by dropped data, not divided
data. The fix location changes as a result — merging rows at the reporting
layer would fix nothing, because the second seat's row does not exist to be
merged. The fold must reach the membership test at line 276 so the seat
survives selection and its mailbox is read.

## Finding 2 — scenario 03 was unsatisfiable (UPHELD, provably)

`nameBottleneck` (`stageDwell.ts:217`) ranks on `s.processing.medianMs` — a
median, not a sum. Scenario 03 as minted required both:

- the coder seats **together** slower than every single-seat stage, and
- **neither** coder seat alone slower than the slowest single-seat stage.

Let X be the slowest single-seat stage's median. The second clause gives
median(A) <= X and median(B) <= X. At least ceil(|A|/2) elements of A and
ceil(|B|/2) of B are <= X, and those together are at least half of A union B —
so median(A union B) <= X. The first clause needs it > X. The two are mutually
exclusive; no fixture can satisfy the scenario, and the same flaw was copied
into `qa_e2e_procedure`.

Replaced with the form the real defect actually produces: the BARE seat is
fast, the DROPPED seat is slow, and only reading both moves the stage to the
top. Worked fixture recorded in the QA procedure — bare seat 1s,1s; second
seat 10s,10s; slowest single-seat stage 5s, giving median(union) 5.5s > 5s.

## Amended beyond what the coder raised

`invariants[3]` carried the same wrong model in its mechanism clause —
"folding happens where the report is assembled, not where records are read" —
which would have **forbidden the only fix that works**. The property it
protected (per-record seat attribution survives the fold) is kept; the
mechanism clause is dropped. Invariants 1 and 2 stand unchanged.

Scenario 02 is deliberately kept although it passes before the fix: no
seat-keyed row can exist today, so it demonstrates nothing about the defect,
but it is a real regression guard on the fix, since an implementation that
starts reading seat mailboxes could key the new row on the seat id. A comment
above the scenario now says so, so it is not later mistaken for a vacuous gate
and quietly deleted.

## Gates re-run after the amendment

- `swarmforge/scripts/gherkin_lint_gate.sh` — parses cleanly.
- IR-DRY (`bb gherkin-parser` then `bb gherkin-ir-dry-checker`) — 0 findings
  over 20 step occurrences / 15 unique steps.
- `specifier_backlog_hygiene_gate.sh` — ok.

## Handoff consequence

BL-1319 is ACTIVE, so committing to `main` does not reach the coder's
worktree (BL-317/BL-325). A priority-00 `note` goes to the coder naming the
amendment commit and telling it to merge `main` and re-read before building.
Scenario 03's name and steps CHANGED, so its step handler must match the new
text in the same parcel (BL-233) — the coder had not yet written one, so
nothing is orphaned.
