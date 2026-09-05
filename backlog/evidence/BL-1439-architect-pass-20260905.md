# BL-1439 — architect pass, 2026-09-05

Ticket: BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged
Role: architect
Commit reviewed: 79cd8c2977 (cleaner NONE pass — flagged a disposition
question for architect/QA rather than deciding it unilaterally)

## Result: NONE — no architecture, invariant, or correctness defect found.
Disposition call (below): land now.

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run on both new/touched JS files: `0
  clones`.
- **Register check**: `backlog/standing-reds.tsv` carries all 5
  hardening rows, all owned by `BL-1439` — correctly persisting, per the
  ticket's own design ("the five register rows... leave in the same
  commit that discharges the last of the five"), since only 1 of 5 is
  discharged.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"A ledger row leaves outstanding debt only through a discharge...
   the row itself is never deleted"** — read `discharge-debt`: matches by
   `(parcel, gate)`, mutates in place via `update ... assoc`, never
   removes an entry from `rows`. Confirmed via the shell test's own "still
   2 rows — never deleted" assertion, independently re-run.
2. **"The register and the throttle see one notion of outstanding debt...
   a discharged row contributes no register row and no age"** — read
   `outstanding-debt`: `remove`s any row carrying `:discharged-at` before
   projecting. `standing_red_register_cli.bb` calls this function
   unchanged (confirmed via `git diff` — that file is untouched by this
   parcel).
3. **"A gate that cannot complete on this host... is recorded as such
   with the evidence of the attempt and stays outstanding, never
   discharged by assertion"** — this is precisely the outcome I
   independently confirmed for 4 of 5 gates (see below). The coder did
   not force any of them.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `hardening_debt_ledger_lib.bb`, made `discharge-debt` a no-op
(`{:rows rows :discharged? false}` unconditionally): reran the shell
test — the CLI itself immediately errors (`no matching outstanding row
for parcel=BL-915 gate=mutation - nothing written`), confirming the
discharge path is genuinely load-bearing. Restored the file, confirmed
byte-identical via `diff` and `git status --short` (empty), reran — `ALL
CHECKS PASSED` again.

## Independently re-verified every claim about the four blocked gates

Rather than trust the coder's/cleaner's counts, I ran the real tools
myself against the live checkout:

- `bb swarmforge/scripts/mutation_cooldown_gate.bb .
  extension/src/tools/telegramFrontDeskBotCore.ts` — `DECISION:
  skip-cooldown, file_age_days: 0.13 (cooldown: 3 days)` — confirms
  BL-620's and BL-955's shared file is genuinely too fresh (touched by
  BL-1425, `2cd4072055`, ~3 hours before this review).
- `bb swarmforge/scripts/mutation_cooldown_gate.bb .
  extension/src/concierge/pipelineBoard.ts` — `DECISION: skip-cooldown,
  file_age_days: 0.11` — confirms BL-956/mutation is genuinely blocked
  for the identical reason.
- `npx vitest run test/constitutionDocCitations.test.js` — **genuinely
  red** (1 failed, 5 passed), naming `docs/deprecated/` and two
  Art-Director/deprecator design docs that do not exist on disk — an
  unrelated, pre-existing, out-of-coder's-scope defect, confirmed real
  and not fabricated as an excuse.
- `npx vitest run test/operatorRuntimeBbFixtureClosure.test.js` — **6/6
  pass** (was 4/6) — the collateral drift fix (5 missing entries in
  `OPERATOR_RUNTIME_BB_FILES`) is genuine and correctly scoped (same
  hand-mirrored-closure class this session already fixed three times).
- `node specs/pipeline/cli.js
  specs/features/BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged.feature`
  — **3/4 pass**, scenario 03 failing with the identical 4 rows named
  above, confirming the failure is real and not a malformed assertion.
- `bb swarmforge/scripts/test/hardening_debt_ledger_lib_test_runner.bb`,
  `bl942_hardening_debt_ledger_property_runner.bb`,
  `test_hardening_debt_ledger_cli.sh` — all pass, matching evidence
  exactly.

## Disposition call: land now, do not hold

The cleaner correctly routed this decision to architect/QA rather than
deciding it unilaterally. My call: **forward this parcel now**, not hold
it.

Holding the parcel gains nothing. The two remaining blockers are both
time/scope-external to this parcel: the mutation-cooldown window (BL-620/
BL-955/BL-956-mutation) clears on its own in ~3 days regardless of when
this parcel lands, and the `constitutionDocCitations` red requires
separate content authorship (Art Director/documenter territory, already
flagged to the specifier) that this parcel cannot and should not attempt.
Delaying the land delays the one genuine, complete discharge available
today (BL-956/gherkin-mutation, a real clean 6/6-mutants-killed run) and
the ledger's own discharge mechanism — which every future discharge,
including the remaining four, will need regardless. The register/throttle
state is unaffected by the timing choice either way: all 5 rows persist
under BL-1439's ownership until the last discharges, exactly as the
ticket's own text says, whether this parcel lands today or after another
cycle.

This is exactly the shape invariant 3 was written for: a partial,
fully-honest discharge with the remainder correctly left outstanding
rather than asserted. A follow-up pass (this ticket re-run, or a
successor) closes the remaining four once their real-world blockers
clear.

## required_wiring

All three anchors confirmed present: `--discharge` in
`hardening_debt_ledger_update.bb`; `discharged` fields and the
`outstanding-debt` filter in `hardening_debt_ledger_lib.bb`; the new step
handler discovered by directory scan (BL-1371), confirmed by the
acceptance run's 3 passing scenarios (scenario 03's failure is a real
outstanding-debt result, not a wiring failure).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found — the ledger discharge mechanism is
correctly and completely built, and the four undischarged gates are
genuinely, honestly blocked exactly as invariant 3 anticipates.

## Addendum: the ticket was amended by the specifier while I held the parcel

After writing the verdict above, my attempt to forward to hardener was
refused (`CONTRACT_AMENDED_SINCE_BASE`): the specifier amended this
ticket on main (`42674ab66d`) independently reaching the same
"land what's genuinely done, don't hold on external blockers" conclusion
I recorded above — but going further than a disposition call: BL-1440
(new) now owns the `constitutionDocCitations` red; BL-1441 (new) is
minted as the successor for the four still-blocked gates; scenario 03 is
amended (wrong at mint per the specifier's own note) to require every row
discharged OR carrying an attempt record naming its blocker, with every
outstanding row's register ownership re-pointed to BL-1441; and a new
`--attempt` verb is added to `required_wiring`, absent from the commit I
just reviewed.

Merged main (`5b84569457`). This is new required work, not a defect in
what was delivered — the coder's and cleaner's work was correct against
the ticket as it stood, and my own review found no defect. The
`--attempt` verb and the BL-1441 re-pointing are genuine new production
code / data no one has written yet (confirmed: `grep attempt
hardening_debt_ledger_update.bb` finds nothing). This is coder-owned
work, not mine to write. Forwarding the merged commit to coder (not a
bounce, no bounce_count recorded — nothing here was wrong, the ground
moved under an already-correct parcel) so the amendment gets implemented,
rather than sending an already-stale candidate to hardener.
