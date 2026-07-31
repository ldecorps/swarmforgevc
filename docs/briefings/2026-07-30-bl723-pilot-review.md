BL-723 pilot review verdict: 13 of 13 landings NOT on par

**Overall verdict:** NOT ON PAR

Queue-jump review (BL-723), human via Let's Talk 2026-07-30 evening: the live
swarm walked all 13 defect tickets an offline pilot closed tonight — BL-718,
BL-627, BL-636, BL-637, BL-641, BL-642, BL-646, BL-623, BL-671, BL-694,
BL-559, BL-661, BL-662 — through the full coder→cleaner→architect→hardener→
documenter→QA chain, exactly like any other ticket (not the expeditor, not
the offline pilot itself). Verdict: **all 13 are not on par** with what a
normal live-swarm pass would let merge. Two seats — cleaner and architect —
judged most landings clean from their own lens; it is the coder, hardener,
and documenter passes that surfaced real, previously-uncaught shortfalls
by actually running tooling (CRAP, dependency-gate, an existing but never-
wired docs-orphan checker) and tracing already-noted "nits" one level
further to their real consequences, rather than accepting them at face
value. Full detail, per-ticket verdicts, and every filed defect are in
`docs/how-to/BL-723-pilot-tonight-quality-review.md`.

**By the numbers:** 15 shortfall-pairs filed so far (BL-726 through
BL-757 — 30 new defect tickets, each `type: defect` with an explicit
`severity:`), split roughly evenly between "remaining work" (what's still
wrong in the landed code/acceptance) and "pilot process" (what gate or hat
should have caught it). Every reviewed ticket keeps its `backlog/done/`
status and its original description/acceptance — this review does not
reopen landings, only reviews and annotates them.

## Coder viewpoint

Read all 13 landing commits and tests directly (not just their QA-land
commits). Found 5 not-on-par: **BL-718** and **BL-559** share a systemic
gap — a hand-authored Gherkin feature with zero step handlers wired, so the
acceptance CLI would throw "no step handler matched" rather than actually
gate; **BL-637** has a live, reproducible false-positive regression in the
exact multi-worktree condition its own ticket exists to fix; **BL-636**'s
landing commit message claims a fix its diff never made; **BL-642** leaves
open the exact leak class its ticket was meant to close for any multi-word
role name. **BL-559** in particular did no coder work under this ticket at
all — it rode a week-old, unrelated commit and was QA-landed twice. The
other 8 were coder-clean. Filed: BL-726/727, BL-728/729, BL-730/731,
BL-732/733, BL-734/735.

## Cleaner viewpoint

Reviewed all 13 for readability, DRY, naming, and encapsulation. 12 of 13
clean from this lens, several genuinely good structural work (BL-671's
shared sandbox helper, BL-694's allowlist module, BL-646's thin-wrapper
reduction). One independent shortfall: **BL-637**'s landing pasted an
identical 12-line `--help` heredoc into 16 separate scripts instead of
factoring a shared helper — real production duplication, the same
hand-maintained-list shape BL-671 in this same batch was filed to
eliminate elsewhere. Filed: BL-736/737 (both low severity).

## Architect viewpoint

Ran `dependency-gate.js` against every touched `extension/src` file (all
passed, no forbidden edges) and reviewed each ticket's declared
`invariants:` for a real, non-vacuous executable encoding (BL-654). Found
one independent shortfall: **BL-718**'s own property test for its
"length alone never silently truncates" invariant caps its generator at
200 chars against the function's real 4096-char split boundary, so it
never exercises the multi-chunk branch the invariant is actually about —
vacuous, though real behavior is independently covered by example tests
elsewhere (no live risk). Filed: BL-738/739 (both low severity). A narrow,
explicitly-flagged blind spot in BL-723's own acceptance scaffolding
(only the first "Filed defects:" line per ticket is mechanically
gate-checked) is noted for QA's re-verification pass, not renegotiated.

## Hardender viewpoint

The seat that moved the needle most: ran real tooling no prior seat had
run. **CRAP** (`crapReport.js`) against every touched `extension/src`
file found two new not-on-par tickets: **BL-627**
(`collectReferencedClaudeModels`, CRAP=10.89/79% coverage) and **BL-718**
(six functions over CRAP<=6, worst `mergeTopicId` at CRAP=14.08/**14%
coverage**). BL-627's own new test also breaks the repo-wide
`tmpDirMigrationGuard` raw-mkdtemp gate (filed, not fixed, per this
review's own does-not-reopen-landings rule). For the nine non-TS-scope
tickets (no CRAP/mutation tooling wired for Babashka/shell), a manual
coverage-completeness read traced three already-noted "nits" to real
consequences: **BL-623**'s missing try/catch on `log-routing-skip!`
genuinely skips real-time delivery on a write failure; **BL-694**'s
"dead-looking" step handler actually guards an untested behavior claim;
**BL-637** picked up a *third* independent shortfall (its own shell test
never invokes the real `stop-swarm.sh` it claims to verify). Also found
**BL-646** has a new alert severity with no grace-period gate unlike its
siblings, and **BL-661** has two of three parser branches with zero
coverage, one silently mis-parsing comma-containing input. Only BL-641,
BL-671, and BL-662 survived this pass — see Documenter below for why even
those three don't stay on-par. Filed: BL-740 through BL-755 (8 pairs).

## Documenter viewpoint

Checked every landing for doc currency, correct Divio classification, and
discoverability. 3 of the 13 correctly added no doc (no prior doc surface,
no user-facing change: BL-636, BL-646, BL-559); the other 10 each added a
correctly-classified doc. But running this project's own existing
orphan-doc checker (`computeDocsStructure`, built by BL-456 and never
before pointed at this repo's real `docs/` tree) found **all 10 of those
new docs are orphaned** — never linked from `docs/index.md`, which this
project's own docs explicitly require to stay "exhaustive and
orphan-free." That is the deciding shortfall on the last three tickets
every other seat had called clean — **BL-641**, **BL-671**, **BL-662** —
which is why the overall count reaches 13 of 13, not 10 of 13. Filed as
one shared pair rather than ten near-duplicates, since the fix is
byte-identical in every case (one line added to `docs/index.md`):
**BL-756** (remaining work) and **BL-757** (pilot process — the checker
exists and is tested, it is simply never run against the real tree).

## QA viewpoint

PENDING — this parcel has not yet reached the QA hop. Per BL-723's own
text this section must be the fullest of the six: QA compiles and
re-verifies every other seat's findings against the live pipeline bar,
confirms the shared BL-756/BL-757 filing decision and every other filed
defect carries `type: defect` and an explicit `severity:`, confirms all 13
reviewed tickets stay in `backlog/done/` with their verdict written back,
and verifies this very email actually sent (checking handoffd's log for
`briefing-sent` for this file, or reporting a `briefing-skip-missing-key`/
`briefing-send-failed` reason to the human) before approving. QA will
replace this paragraph with its real findings during its own hop.
