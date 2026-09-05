# BL-1439 — hardener pass, 2026-09-05/06

Ticket: BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged
Commit reviewed: 117a78703e (architect NONE pass, post-amendment)

## Result: found and fixed one BL-113 mutation gap (test-side only)

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/hardening_debt_ledger_lib_test_runner.bb` | ok |
| `bash swarmforge/scripts/test/test_hardening_debt_ledger_cli.sh` | ALL CHECKS PASSED (30 checks) |
| `bb swarmforge/scripts/test/bl942_hardening_debt_ledger_property_runner.bb` | ok |
| `node specs/pipeline/cli.js specs/features/BL-1439-...feature` | 4/4 pass |
| `bb swarmforge/scripts/hardening_debt_ledger_read.bb .` (live) | 4 rows `attempted_at: "2026-09-06"`, `discharged_at: null`; 1 row (BL-956/gherkin-mutation) `discharged_at: "2026-09-05"` with its evidence pointer — exact match |
| `bb swarmforge/scripts/standing_red_register_cli.bb .` (live) | 4 hardening rows all name `BL-1441`; the citations row names `BL-1440`; `"unowned":[]` |
| `bb mutation_cooldown_gate.bb . <telegramFrontDeskBotCore.ts / pipelineBoard.ts>` (live) | both still `skip-cooldown` — the attempt records remain accurate today |
| `npx vitest run test/constitutionDocCitations.test.js` (live) | still genuinely red (1/6) — the BL-954 blocker is real and unrelated, correctly owned by BL-1440 |
| `npx vitest run test/operatorRuntimeBbFixtureClosure.test.js` | 6/6 (collateral drift fix) |
| `npx jscpd` on the two touched/new JS files | 0 clones |
| `npx jscpd` on `hardening_debt_ledger_lib.bb` directly (`.bb` pattern) | 0 files analyzed — independently confirmed the cleaner's/architect's jscpd-has-no-Clojure-parser caveat is real, not an excuse |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently re-ran the BL-956 gherkin-mutation discharge itself

Rather than trust the discharged evidence file's claimed numbers, ran
the real gherkin-mutation tool myself:
`bash specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-956-pipeline-board-caption-and-cap-hotfix.feature ""
specs/pipeline/steps/index.js full` — **6 mutants, 6 killed, 0 survived**
— exact match to the discharged evidence, a second independent
corroboration. The re-run's own mutation-stamp write to BL-956's feature
file was reverted before committing (BL-1439's task-scope gate correctly
refused a commit whose diff carried a path belonging to BL-956; the
stamp is transient tool output, not part of this ticket's own
deliverable) — the discharge's original evidence file and ledger record
remain the durable proof.

## Independently read both new ledger verbs directly

`hardening_debt_ledger_lib.bb:194-231`: `find-row-idx` (shared,
`(parcel, gate)` match) backs both `discharge-debt` (sets
`:discharged-at`/`:discharged-evidence`) and `record-attempt` (sets
`:attempted-at`/`:attempted-blocker`, **never** `:discharged-at`).
`outstanding-debt` (line 233) filters on `:discharged-at` alone,
confirming an attempted-but-undischarged row still counts as outstanding
debt — matches every prior role's reading exactly.

## Independently reproduced non-vacuity myself, both verbs

**`discharge-debt`**: mutated its blank-evidence guard to always refuse
(`(if true ...)`), re-ran the CLI wiring suite: the discharge call
immediately errors (`no matching outstanding row for parcel=BL-915
gate=mutation - nothing written`), confirming the path is genuinely
load-bearing. Restored; confirmed byte-identical via `diff` and `git
status --short` (empty); re-ran — ALL CHECKS PASSED again.

**`record-attempt`**: mutated its blank-blocker guard to never refuse
(`(if false ...)`), re-ran the unit suite: **2 failures** (`an empty
blocker refuses` and `a refused attempt changes nothing`) — matching the
cleaner's own claimed non-vacuity result exactly. Restored; confirmed
byte-identical via `diff` and `git status --short` (empty); re-ran — `ok`
again.

## BL-113 hard gherkin mutation: found and fixed a real gap

One `Scenario Outline` (scenario 01, 2 examples, 3 mutable columns = 6
mutants). First run: **2 survived** — both `<evidence>` column mutants
(`bl620-mutation.md` → `bl620-mUtation.md` and the BL-956 equivalent).

Root cause, found by reading
`specs/pipeline/steps/bl1439DeferredHardeningGatesDischargedSteps.js`:
the Given step captures `<evidence>` into `ctx.evidence` and passes it
straight to the real `--discharge` CLI call; the Then step's own
assertion (`assert.equal(row.discharged_evidence, ctx.evidence)`)
compares the ledger's recorded value against that SAME captured
variable. Because both the CLI input and the expected value derive from
one Examples cell, mutating that literal changes both sides together —
the round-trip assertion holds for ANY string, so the mutant is
invisible. This is the exact BL-908/BL-1420 KNOWN_VALUES class from this
session's own established rules.

**Fix (test-side only, no production code touched):** added
`KNOWN_EVIDENCE`, pinning each `(parcel, gate)` pair's own expected
`<evidence>` literal, and asserted the captured `evidence` against it in
the Given step — ahead of the existing self-referential round-trip,
matching the same pattern used to fix BL-1420's analogous gap.

**Re-verification after the fix:**
- Acceptance feature re-run: still **4/4** pass (no assertion weakened).
- BL-113 hard mutation re-run: **6/6 mutants killed, 0 survived** —
  manifest confirms `"Total":6,"Killed":6,"Survived":0,"Errors":0"`.

## Design/CRAP/DRY

No production code changed. Test-file-only fix scoped to one step-handler
file; the new map mirrors the Outline's own Examples table 1:1, same
pattern as BL-1420's `KNOWN_SUPERVISOR_COUNTS` fix earlier this session.
Babashka files carry no mutation/CRAP/DRY tooling; the cleaner's manual
`find-row-idx` extraction was independently confirmed load-bearing (both
callers now share it) and correctly reasoned given jscpd's own inability
to analyze `.bb` sources at all.

## Constraints respected

- `git diff --name-only` (this pass) touches only BL-1439's own feature
  file (mutation stamp/manifest), its step-handler file, and this
  evidence file — no ledger/library files, no other production code, and
  no path belonging to another ticket (the BL-956 mutation-stamp write
  from my own re-verification run was reverted before committing, per
  the task-scope gate's own refusal).

## Verdict

Real BL-113 gap found and fixed. Forwarding to documenter.
