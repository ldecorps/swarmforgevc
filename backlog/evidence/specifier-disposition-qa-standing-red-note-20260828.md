# Specifier disposition — QA's standing-red note (2026-08-28)

Answers QA note `001816` (priority `00`, 01:41:53Z) to specifier+coordinator:
*"Untracked defect (23 files, node:test/Vitest): see BL-1189-qa-pass-20260828.md"*,
raised while clearing BL-1189 (verdict PASS, unaffected).

QA did this correctly: it diagnosed all 47 failing unit files rather than
waving the red through, grepped `backlog/{active,paused,hold}` to confirm the
finding was untracked, and sent a note rather than minting or bouncing.

## Every number re-measured before minting

| QA reported | Measured | Note |
|---|---|---|
| ~23 main-lane `node:test` files | **25** | `test/*.test.js` excluding `*.property.test.js` |
| BL-1206 covers 13 property files | **14** present, 13 enumerated | close enough; BL-1206's list is authoritative for its own scope |
| `checkOrphanedAuthoredDocs` stub gap | **16** files call `landPilotedTicket`, **0** supply the dep | grep for the name under `extension/test/` returns nothing |
| attributed to BL-757 | **confirmed** | `2ed133333`, via `git log -S` on the contract line |

Overlap: **10 files carry both defects** and currently fail to collect, so
their copy of the deps error is masked until the collection defect is fixed.

## The finding QA's note did not contain, and it changes the severity

**Nothing in this repository runs `node --test`.** `npm test` is
`node scripts/recordTestDuration.js`, which spawns Vitest and nothing else;
that script's own comment at line 41 records why — *"BL-124: the suite now runs
under Vitest (node --test can no longer run the...)"*. There is no `node --test`
invocation in `package.json` or under `swarmforge/scripts/`.

So these files are not merely uncollected. **Their assertions have never run.**
38 files across both lanes — 25 unit, 13 property — are counted as coverage by
anyone who greps the tree for a test covering a module, and cover nothing.

That also falsifies a load-bearing sentence in **BL-1206**, whose `severity:
medium` rationale reads *"The 13 files' assertions do run and pass under
node:test's own runner"*. Corrected in this pass.

## Disposition

| Action | Ticket | State |
|---|---|---|
| Mint — main/unit lane, 25 files, plus a lane-scoped import guard | **BL-1220** | `paused/`, `high`, approval pending |
| Mint — pilot-gate deps stubs, 16 files | **BL-1221** | `paused/`, `medium`, approval pending |
| Amend — correct false premise, `medium` → `high` | **BL-1206** | `paused/`, stays approved (deliverable unchanged) |

**Siblings, not one ticket.** BL-1206 is already human-approved, enumerates its
own 13 files by name, and involves the property standing allowlist, which the
unit lane does not have. Folding the 25 into it would rewrite an approved scope
and break INVEST Small. Same precedent as BL-1200 beside BL-1196, and BL-1222
beside BL-1196 earlier tonight.

**BL-1220 is `high`, BL-1221 is `medium`, deliberately.** A gate reporting pass
over assertions that never ran is a broken safety signal. BL-1221's failures are
loud, contained, and production is correctly wired — the stubs are what is
behind.

**BL-1220 must not be "fixed" with an allowlist**, and that constraint is
written into its acceptance rather than left as advice. An allowlist absorbing a
"pending fix" rationale is precisely how the property lane's identical 13 files
became invisible. Repairing 25 visible reds into 25 invisible ones would close
the ticket looking green.

## Not minted here, deliberately

The structural fix for BL-1221's class — a guard asserting every required member
of `landPilotedTicket`'s TypeScript deps interface appears in the hand-written
`.js` stubs — is named in BL-1221's `out_of_scope` and `approval_context`. It
needs type introspection or a generated fixture, is a larger slice, and should
be a decision rather than a side effect.

Also left with their diagnosed owners rather than swept into these tickets: the
ambient `CURSOR_API_KEY` gap (infra-environment, ~10 files) and the assorted
repo-hygiene guard reds (`constitutionDocCitations` citing a `docs/deprecated/`
that does not exist, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
`socketFixtureShortRootGuard`, `liveRepoDerivationGuard`).

By specifier.

---

## Addendum — QA corroboration pass, same day (BL-1247 minted)

QA re-ran both lanes in full against the merged QA tip while verifying BL-1192
and recorded `backlog/evidence/QA-standing-red-corroboration-20260828.md`
(QA worktree). It corroborates every red dispositioned above — 38 unit-lane
files, ~45 property-lane failures, none touched by BL-1192's merge diff — and
adds ONE item this note had not seen.

**New, now ticketed as BL-1247**:
`test/bl593MutationRunTelemetry.property.test.js`, property "completed records
always carry load-bearing scope total and incremental", throwing
`mutation run record requires a non-empty scope` out of
`requireLoadBearingMeta` (`src/mutation/mutationRunTelemetry.ts:39`).

Root cause measured, not inferred: the property draws scope from
`fc.string({ minLength: 1, maxLength: 80 })`; fast-check 4.9.0's default
charset includes the space character, so ~1 draw in 600 is whitespace-only
(8 of 5000 measured). The guard correctly refuses those. **The production code
is right; the generator models a wider domain than the contract accepts.**

**Correction to QA's evidence, recorded here because it changes how the fix is
verified**: QA reported the red as deterministic ("ran isolated, twice, same
counterexample both times"). It is not — it is a ~30% per-run flake. Measured
on the same tip with no code change between: 8 consecutive passes in one batch,
then 6 failures in 20 consecutive isolated runs. Two consecutive failures has
~9% probability at that rate, so QA's reading was a sound inference from its
sample, not an error of method. The consequence is what matters: **a single
green run is not evidence that BL-1247 is fixed**, which is why its scenario 01
specifies 20 consecutive runs.

Sibling risk swept before minting, to keep the slice small: ~40 property files
use `fc.string({ minLength: 1, ... })`, but sweeping `src/` for the
trim-blank rejection class finds `mutationRunTelemetry` as the only *throwing*
guard of that shape fed by such a generator (the `letsTalkCore` blank checks
return booleans and are silence-handling, not refusals). No repo-wide generator
audit opened.

Nothing else in QA's note needs a ticket — the remainder is this note's
existing disposition, re-observed.

By specifier.
