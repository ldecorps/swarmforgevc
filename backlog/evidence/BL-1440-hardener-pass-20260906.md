# BL-1440 — hardener pass, 2026-09-06

Commit reviewed: 332356da76 (architect NONE pass)

## Scope note

No `.ts`/`.tsx` file is touched by this parcel (`git diff main...HEAD
--name-only`: two evidence dirs, `backlog/standing-reds.tsv`, three
`docs/` files, one shell script, one `specs/pipeline/steps/*.js` file,
and `run_commit_guards.sh`). Stryker (`--mutate out/**/*.js`) and the
CRAP gate (`src/*.ts`) therefore have nothing to run against in this
parcel — consistent with the ticket's own `mutation_cost: low`. The
applicable mutation gate here is BL-113 Gherkin mutation, since the
feature's scenario 03 is a `Scenario Outline` with `Examples:`.

## BL-149 cooldown / load

`mutation_cooldown_gate.bb` on the two changed non-doc files: both
`run` (quiet host, load avg 1.66/1.72 on 20 cores). No orphaned
`node --test`/stryker processes before starting.

## BL-113 Gherkin mutation (soft)

`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1440-every-constitution-doc-citation-resolves.feature
<mktemp -d under ./tmp> specs/pipeline/steps/index.js soft`

4 mutants over the two `Examples:` cells (scenario 03 is the only
Outline in this feature): 3 killed, 1 survived.

| id | mutation | result |
|---|---|---|
| m1 | `outcome` row1 `refuses` → `refuSes` | killed |
| m2 | `path` row1 `docs/how-to/not-there.md` → `docs/how-to/Not-there.md` | **survived** |
| m3 | `outcome` row2 `passes` → `pasSes` | killed |
| m4 | `path` row2 `docs/how-to/present.md` → `docs/hOw-to/present.md` | killed |

### m2 — accepted equivalent (BL-234 exception)

Row 1 exists to prove the guard refuses when the cited path does not
resolve on disk; the exact spelling of that path is not load-bearing.
The step handlers substitute `<path>` identically into both the
fixture (the Given step writes `` `${citedPath}` `` into the article,
never creating a file at that path — see
`initFixtureRepo`/`bl1440ConstitutionCitationsResolveSteps.js:91-97`)
and the assertion (`ctx.result.stderr.includes(citedPath)`,
same file:110-111). The guard's own refusal path
(`findUnresolvedCitations` → `fs.existsSync`) and its error line both
echo back whatever string was substituted, verbatim. So for ANY value
substituted into row 1 that does not name a file the fixture actually
creates, both halves of the check move together: `fs.existsSync`
returns `false` regardless of letter case (there is no
`docs/how-to/Not-there.md` OR `docs/how-to/not-there.md` on the fixture
disk either way), and the reported citation string is copied from the
same substituted literal the assertion checks against. No assertion
reachable from this Outline row could ever distinguish the original
from the mutant — the equivalence is demonstrable from the code, not
argued from resemblance to a prior accepted survivor (contrast row 2 /
m4, which names a path the fixture DOES create at
`docs/how-to/present.md`, so a letter-case mutation there genuinely
flips existence and correctly kills the mutant — same shape of edit,
opposite verdict, decided by the fixture's own content, not by shape).

This is not the case-insensitive-filesystem trap (BL-927): m2 does not
depend on the host's filesystem case-folding, because neither the
mutated nor the original string names any real file at all — a
case-sensitive OR case-insensitive host resolves both to "not found."

Recorded per BL-234: not re-tested with a forced assertion, and the
manifest's `scenarios: []` for scenario 03 is expected (BL-502 — a
survivor, even an accepted-equivalent one, keeps the scenario out of
the clean manifest).

## Verification (re-run, all green)

| check | result |
|---|---|
| `node specs/pipeline/cli.js BL-1440-....feature` | 4/4 |
| `node specs/pipeline/cli.js BL-1439-....feature` (regression) | 4/4 |
| `cd extension && npx vitest run test/constitutionDocCitations.test.js` | 6/6 |
| property lane, `constitutionDocCitationsInvariant.property.test.js` only | 4/4 |
| whole-tree standing guards (`test/*Guard*.test.js`, non-property, 18 files) | 183/183 |
| `npx jscpd` over all 5 new non-evidence files | 0 clones |
| leftover `/tmp/bl1440-fixture-*` after every run above | 0 (checked after each) |

## Fixture-leak note (not a production defect — recorded per "clean up
after yourself")

During the mutation run, m1 and m3 (mutating the literal words
`refuses`/`passes` in `Examples:`) make the generated step text
("...guard refuSes naming...") match NO registered step regex at all
— `no step handler matched`. That failure occurs before the intended
`Then` handler (and its `try/finally` cleanup of `ctx.root`) is ever
invoked, so the fixture directory that step's own `Given` created is
orphaned in `os.tmpdir()`. This is inherent to how a killed Gherkin
mutant of this shape is detected (the framework's routing failure IS
the kill signal) and cannot recur in the real suite, where the
Examples table only ever contains the literal words `refuses`/`passes`
and the handler always matches and always reaches its `finally`.
Confirmed by re-running the unmutated feature directly and checking
`/tmp` before/after: zero leaked directories. Cleaned up the mutation
run's own leaked dirs (created and removed by this pass, per "Clean Up
After Yourself").

## Verdict

No defect found; one accepted-equivalent Gherkin mutant recorded above.
Forwarding unchanged to documenter.
