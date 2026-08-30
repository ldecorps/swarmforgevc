# BL-1254 — coder pass, 2026-08-30

BL-848 stamp-off of the Cursor expedite no-verdict hotfix chain
`3f4f69ec1b` → `70c5e0e5b0` → `5de352ed1d`, reviewed as ONE resulting state
(the state at `5de352ed1d`). Nothing in this parcel reimplements, rewrites or
reverts any of the three commits, and nothing writes to
`backlog/hotfix-ledger.yaml`.

## Verdict: CONFIRMED, with one narrow follow-up finding

Every claim in `qa_e2e_procedure` was checked by EXECUTING the landed
decisions, not by reading their source:

1. `max-missing-verdict-recoveries` is `2`, `should-recover-missing-verdict?`
   gates on it, `bounce-payload-valid?` exists — all three driven live through
   `specs/pipeline/steps/lib/bl1254ExpediteDecisionCli.bb`, which `load-file`s
   the real `swarmforge/scripts/expedite_lib.bb`. CONFIRMED.
2. `bounce-payload-valid?` refuses both-blank (empty and whitespace-only) and
   the synthetic `no-verdict-abandoned` class / `no-verdict` reason (string and
   keyword spellings), and accepts an actionable reason. CONFIRMED, with the
   asymmetry recorded below.
3. The recovery prompt at `attempt >= 2` escalates (different text, `ESCALATED
   RECOVERY`), forbids Monitor/background/IDE standby, and requires a
   pass/bounce/fail verdict NOW. The base prompt carries the same requirement
   in its own wording (`as your LAST action`). CONFIRMED.
4. Both Babashka suites run green — see below.
5. No scenario asserts the superseded same-stage no-verdict bounce. Enforced
   MECHANICALLY, not by inspection: the acceptance Background scans the feature
   file and fails on any affirmative step or scenario title claiming a bounce
   back to the same stage. CONFIRMED.
6. All three ledger rows are left `state: stamp-open`, `human_decision: null`.
   The acceptance asserts both, and asserts this parcel did not modify the
   ledger file at all. CONFIRMED.

## Finding (narrow follow-up, NOT fixed here)

`bounce-payload-valid?` lower-cases `reason` before comparing it to the
synthetic tag, but compares `class` exactly (after a trim). So a verdict
carrying `class: "NO-VERDICT-ABANDONED"` is accepted as a real bounce, while
`reason: "NO-VERDICT"` is refused.

Not live: the driver only ever synthesizes the lowercase tag, so nothing in the
running system reaches it. It is an inconsistency inside one function, not a
defect in the behaviour under review — which is why the chain is CONFIRMED
rather than refuted, and why this is a follow-up rather than an edit here
(invariant 1 and the ticket's `constraints` both forbid touching the hotfix).

Pinned so it cannot drift unnoticed:
`extension/test/bl1254MissingVerdictNeverBounces.property.test.js`, test
"pins the reason/class case asymmetry this review found" — it asserts what the
code DOES today and will go red the moment the follow-up lands, which is the
anchor that follow-up flips.

## Suites

- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → **ALL PASS**
- `bash swarmforge/scripts/test/test_expedite_cli.sh` → **ALL PASS**

The ticket warned that BL-782's known-failing cases in `test_expedite_cli.sh`
are pre-existing and not this parcel's to absorb. **They did not fail on this
run** — the whole suite is green. Recorded rather than assumed: nothing was
absorbed, and nothing was hidden.

- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1254-swarm-stamp-expedite-no-verdict-chain.feature`
  → 9 scenarios, **9 pass**
- `npm run test:properties` (the two files below) → **6 pass**

## Invariants (BL-654)

**Invariant 1** — "this stamp-off never reimplements the hotfixes; review
confirms or refutes the landed state only".

*Stated reason, no executable property.* It quantifies over THIS PARCEL'S diff,
not over the input space of a pure module, so there is no generator space to
draw from. It is nevertheless checked rather than asserted in prose: the
acceptance Background runs `git status --porcelain` over the four files all
three commits touched (`expedite_lib.bb`, `expedite_cli.bb`,
`expedite_lib_test_runner.bb`, `test_expedite_cli.sh`) and fails if this parcel
modified any of them. A stamp-off that edited what it reviews would be
certifying its own work.

**Invariant 2** — "green tests alone never write certified or waived; only a
recorded human decision does".
`extension/test/bl1254LedgerCertificationNeedsAHuman.property.test.js`. Drives
the REAL `hotfix_ledger_update.bb` over a real ledger file across generated
sequences of the operations a green run performs (`--new`, `--link`), and
asserts no row ever reaches `certified`/`waived` and no `human_decision` is
ever non-null. Reach is BY CONSTRUCTION, not measured after the draw: two
disjoint commit pools, and every generated scenario creates at least one row,
links at least one row that exists, and links at least one that never will.

**Invariant 3** — "no scenario asserts behaviour a later commit superseded".
`extension/test/bl1254MissingVerdictNeverBounces.property.test.js`. The
Background covers the feature TEXT; this covers the substance underneath it —
the superseded behaviour was "a second missing verdict bounces back to the same
stage", so the live claim is that a missing verdict NEVER becomes a bounce.
The two spaces this quantifies over are finite and small, so they are
ENUMERATED rather than sampled: every (attempt 0-6 x timed-out x over-budget)
combination, and every payload derived from the driver's own tag by a case or
padding transform, in either field, in both the string and keyword spellings.
The remaining unbounded claim — that an actionable reason is still accepted —
stays a sampled `fc.assert`.

### A reach floor caught in the generator, not in the suite

The first draft of both files asserted reach floors AFTER a random draw. The
ledger one passed alone and on three repeat runs, then went red inside the full
property lane on an unlucky seed ("the generator never linked an existing
row"). That is exactly the failure BL-654's reach requirement describes, so the
fix was to remove the question rather than measure it: construct the reach, or
enumerate the space. Both files were re-run three times each afterwards, green
every time.

### Non-vacuity (both properties shown red against a broken implementation)

Each mutation was applied to the working tree, observed, and reverted; the
hotfix sources are byte-identical to `HEAD` afterwards (the acceptance
Background re-checks this on every run).

| Mutation | Result |
|---|---|
| `max-missing-verdict-recoveries` 2 → 3 | invariant-3 recovery test RED (1 of 4) |
| `bounce-payload-valid?` drops the `synthetic?` guard | invariant-3 tag test + pinning test RED (2 of 4) |
| `--link` also writes `state: certified` / `human_decision: approved` | both invariant-2 tests RED |

Re-run after the enumeration rewrite, not only against the first draft.

## Surfaced, not acted on

**BL-1254 and BL-1259 are the same stamp-off.** `BL-1259` sits in
`backlog/paused/` covering the same three SHAs, minted the same day, also under
Consolidation Authority — and the three ledger rows carry
`stamp_ticket: BL-1259`, not BL-1254. Certifying through this ticket therefore
leaves the ledger pointing at a different one. This is the specifier's call
(retire one, or repoint the rows); a `note` at priority `00` went to the
specifier. Not touched here: this parcel writes nothing to the ledger, and
retiring a ticket is not the coder's to do.

## Amendment, 2026-08-30: scenario 06 and the three lib anchors

The specifier amended this ticket in flight (BL-1259 retired as the duplicate
this parcel surfaced; its distinct content carried here per Article 5.3).

**Scenario 06 — a timeout is reported as a timeout even when no verdict was
written.** Confirmed. `finalize-stage-result`'s ordering puts timeout/overrun
ahead of the missing file, so a stage killed at its deadline is recorded as
`fail`/`stage-timeout`, never `fail`/`no-verdict`, and is NOT re-invoked. The
handler drives all three spellings the driver can arrive in — killed at the
deadline, over budget on return, and both — because the two conditions really
do arrive together and only the ordering separates them.

Non-vacuous, shown directly rather than asserted: with the two `cond` branches
in `finalize-stage-result` swapped, the same input returns

    {"recover":false,"finalVerdict":"fail","finalReason":"no-verdict"}

instead of `stage-timeout` — the absence masking why the stage was actually
killed, which is the defect the ordering exists to prevent. (Running the whole
feature under that mutation fails all ten scenarios, not one: the Background's
invariant-1 check sees the modified hotfix source and refuses the pass, which
is itself the guard working.) The mutation was reverted; the hotfix sources are
byte-identical to `HEAD`.

**The three new `required_wiring` anchors** pin
`should-recover-missing-verdict?`, `bounce-payload-valid?` and
`finalize-stage-result` as shared-lib calls from `expedite_cli.bb`. Each was
grepped against the file this parcel ships: one hit each, none vacuous. No code
change was needed — the driver already calls all three through the lib, which
is what makes the anchors meaningful rather than aspirational.

**BL-1259 retirement**: the ledger rows were re-linked to BL-1254, so the
mismatch this parcel surfaced is resolved. Scenario 05 asserts only that the
rows are neither certified nor waived, so it is unaffected by the re-link and
still passes.

Acceptance after the amendment: **10 scenarios, 10 pass**.

## Commit-time property guard: overridden, and why

`check_property_suite_drift.sh` rejects this commit for ONE non-allowlisted red:
`test/telegramFrontDeskBotCli.property.test.js`. It is not this parcel's, and it
is already root-caused and minted: see
`backlog/evidence/BL-1294-telegram-front-desk-cli-property-triage-20260830.md`
— the branch's own `unregistered_test_gate_lib.bb` (BL-1240) `load-file`s into a
subdirectory, which `copyScriptClosure` silently drops, so every fixture
`swarm_handoff.bb` call exits non-zero. Nothing in this parcel touches that path,
and adding a row to `property_suite_standing_allowlist.tsv` for another ticket's
red would be an out-of-scope edit.

So the commit was made with the documented recovery override,
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`. This parcel's own two property files
were run directly instead — green, three repeat runs each, and shown red against
three deliberate mutations (table above).
