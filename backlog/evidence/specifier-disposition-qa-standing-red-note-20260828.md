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
