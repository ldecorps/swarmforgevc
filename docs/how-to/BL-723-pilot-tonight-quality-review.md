# BL-723 — Pilot-tonight quality review

Queue-jump review, 2026-07-30: the live swarm walks the 13 defect tickets an
offline pilot closed tonight and says whether those landings meet the normal
live-swarm quality bar. This is a first draft, landed by the coder hop of the
parcel per BL-723's own ordering note — the coder viewpoint and all 13
per-ticket verdicts below are real findings from reading each ticket's actual
landing commit and tests, not placeholders. The remaining five seats'
viewpoint sections are explicit placeholders for the cleaner, architect,
hardener, documenter, and QA hops still ahead of this parcel; the acceptance
gate (`specs/features/BL-723-*.feature`) is expected to stay red until the
documenter finishes this body and commits the briefing email, per BL-723's
own text.

**Overall verdict:** NOT ON PAR

**Verdict reasons:**
Coder-level review of all 13 landings found 5 not-on-par: two (BL-718,
BL-559) share the same systemic gap — a hand-authored Gherkin acceptance
feature with zero step handlers wired, so `specs/pipeline/cli.js` would
throw "no step handler matched" rather than actually gating; one (BL-637)
has a live, reproducible false-positive regression in the exact
multi-worktree condition its own ticket was about; one (BL-636) has a
landing commit whose message claims a fix its own diff never made; one
(BL-642) left the precise leak class its ticket was meant to close open for
any multi-word role name. None of these are the kind of gap a normal live
coder-through-QA pipeline pass — where BL-112 requires the coder to run the
acceptance entry point, and QA independently re-runs it before merge — would
let through undetected. The other 8 tickets (BL-627, BL-641, BL-646, BL-623,
BL-671, BL-694, BL-661, BL-662) are on-par, several with only minor,
non-blocking nits noted in their own sections below. This is a coder-only
verdict pending the cleaner, architect, hardener, documenter, and QA hops
still ahead of this parcel; it may be revised as those seats add their own
findings.

**Hardener update (2026-07-31):** that count has shifted substantially.
Running actual tooling (`crapReport.js` against every touched
`extension/src` file) and tracing several already-noted "nits" to their
real call-site consequences, rather than reading structure/invariants
alone, moved five more tickets from on-par to not-on-par: **BL-627**
(`collectReferencedClaudeModels` at CRAP=10.89/79% coverage, plus its own
new test breaking the repo-wide `tmpDirMigrationGuard` gate), **BL-623**
(the coder/cleaner-noted missing try/catch on `log-routing-skip!` traced
to an actual delivery-skipping consequence), **BL-646** (a new alert
severity with no grace-period gate, unlike its siblings), **BL-694** (a
dead-looking step handler that turned out to guard an entirely untested
behavior claim, not cosmetic dead code), and **BL-661** (two of
`take-flow-reason`'s three branches — single-quote and unquoted — have
zero test coverage, with the unquoted branch silently mis-parsing
comma-containing input). **BL-718**, already not-on-par, picked up a
third independent shortfall (CRAP gate never run; six functions over the
CRAP<=6 threshold, worst at 14% coverage). Only **BL-641**, **BL-671**,
and **BL-662** remain on-par after this pass. Updated overall count:
**10 of 13 not-on-par**, 3 on-par. See the Hardener viewpoint section and
each ticket's own hardener note below for full evidence; eight new defect
pairs were filed (BL-740 through BL-755) alongside the seven pairs already
filed by the coder, cleaner, and architect (BL-726/727, BL-728/729,
BL-730/731, BL-732/733, BL-734/735, BL-736/737, BL-738/739).

**Documenter update (2026-07-31):** the last three holdouts flip too.
Running this project's own BL-456 orphan-doc checker
(`computeDocsStructure`, never before run against this repo's real `docs/`
tree — see the Documenter viewpoint section) against every doc tonight's
13 landings added found **10 of the 13 landed a doc that is orphaned** —
never linked from `docs/index.md`, including the last three tickets every
other seat had called clean: **BL-641**, **BL-671**, and **BL-662**. That
was the deciding shortfall on those three; the other 7 orphaned docs
(BL-623, BL-627, BL-637, BL-642, BL-661, BL-694, BL-718) belong to tickets
already not-on-par for independent reasons, noted in their own sections
below without re-flipping an already-flipped verdict. Updated overall
count: **13 of 13 not-on-par**, 0 on-par. Filed as one shared pair rather
than ten near-duplicates, since the root cause and fix are byte-identical
across every instance: **BL-756** (remaining work — the 10 missing index
links) and **BL-757** (pilot process — the checker exists but nothing
runs it against the real tree). See the Documenter viewpoint section for
the full reasoning and evidence.

**QA update (2026-07-31):** final gate concurs, count unchanged at **13 of
13 not-on-par**, 0 on-par. Independently reran the mechanically checkable
findings (orphan-doc checker, the mkdtemp gate, the full unit suite twice,
the property suite, and two of the live-code claims behind BL-637/BL-642)
rather than trusting prose, and all reproduced exactly as claimed. Verified
all 32 filed defects carry `type: defect` and an explicit `severity:`, all
13 tickets' `notes:` carry every seat's verdict and defect links with no
other field rewritten, and all 13 remain in `backlog/done/`. See the QA
viewpoint section for the full evidence.

**Process:** BL-723 walked the live swarm path after queue-jump: this parcel
moved specifier -> coder (this hop) and continues through cleaner ->
architect -> hardener -> documenter -> QA like any other ticket, per
`required_stages`. It was not driven by the offline expeditor or the offline
pilot — no `expedite.sh` invocation and no offline pilot session produced
this document.

## Viewpoints

### Coder viewpoint

Reviewed all 13 landing commits and their tests directly (`git show` on each
ticket's actual implementation commit, not just its QA-land/status-flip
commit — BL-559's is a special case, see its own section). Read for:
whether the diff matches what the commit message and ticket both claim,
whether tests assert real behavior rather than prompt text or tautologies,
and whether the acceptance feature file (if any) actually has a wired step
handler so it can gate rather than throw. Findings are recorded per-ticket
below and, for the 5 not-on-par tickets, as a paired remaining-work +
pilot-process defect (BL-726/727, BL-728/729, BL-730/731, BL-732/733,
BL-734/735). Two patterns recur across tonight's batch worth flagging up
front rather than only per-ticket: (1) a hand-authored feature file with no
step handler is not a one-off — it happened on both BL-718 and BL-559,
suggesting the pilot's own acceptance-wiring step (BL-112) was skipped or
not verified as a class, not just missed once; (2) BL-559 in particular did
no coder work under this ticket at all — it rode a week-old, unrelated
commit and was QA-landed twice (once reverted). Full reasoning lives in each
ticket's own section and in its `notes:` field in `backlog/done/`.

### Cleaner viewpoint

Reviewed all 13 landings through the cleaner lens only: readability, DRY,
naming, module boundaries, encapsulation, dependency direction — not test
coverage/mutation (hardener) or acceptance wiring/design correctness
(architect), though a couple of those are noted in passing where they were
already flagged by the coder. 12 of 13 are on-par from this lens; several
(BL-671's shared sandbox-copy helper, BL-694's extracted allowlist module,
BL-646's thin-wrapper reduction, BL-623's and BL-662's DRY fixes) are
genuinely good structural work, not just adequate.

One is not-on-par from a shortfall this lens found independently of the
coder's already-filed correctness bug: **BL-637**'s own landing commit
(97147316d5) pasted the identical 12-line `-h`/`--help` heredoc block into
16 separate `launch_*.sh`/`start_*.sh` scripts in one sitting, rather than
factoring it into one sourced helper — real production duplication, not
test scaffolding, and the exact hand-maintained-list shape BL-671 (this same
review batch) was filed to eliminate elsewhere. Filed as its own shortfall
pair since it is independent of BL-730/731 (the pgrep-scope bug): BL-736
(remaining work) and BL-737 (pilot process), both severity low. Two other
tickets have minor, non-blocking cleaner-adjacent nits recorded in their own
per-ticket sections and `notes:` but judged not to rise to a defect:
BL-623's confirmed-unreachable fallback branch in `emit-skip`, and BL-661's
duplicated quote-parsing branches in `take-flow-reason`.

Verdicts and any filed-defect links have been written back onto all 13
tickets' `notes:` in `backlog/done/` in this same pass.

### Architect viewpoint

Reviewed all 13 landings through the architect lens: the two-layer
boundary (view vs. tmux substrate), extension-host IO ownership, no
webview storage, secrets handling, integrate-not-fork, dependency
direction, and — per BL-654 — whether each ticket's own declared
`invariants:` (where it has any) carries a real executable encoding
rather than a missing or vacuous one.

**Hard gate:** ran `dependency-gate.js` against every `extension/src/**`
file any of the 13 landings touched (BL-718: `bridgeServer.ts`,
`telegramCursorBridgeCore.ts`; BL-627: `pricingTable.ts`,
`modelDisplayName.ts`; BL-642: `needsHumanDetection.ts`; BL-662:
`pausedPagerUiHtml.ts`) — all PASSED, no forbidden edges. A full-repo
scan (no file args) additionally found one real `acyclic` violation
(`telegram-front-desk-bot.ts` -> `telegramCursorOperatorExec.ts` ->
`telegramCursorOperatorLiveness.ts`), but it predates all 13 landings and
this review (introduced by the unrelated BL-700-704 Cursor Remote
landing; confirmed via `git log`, none of the 13 tickets or this parcel's
own diff touch those three files) — out of scope here, worth its own
hygiene ticket. Also ran `co-change-report.js` across the touched files;
`bridgeServer.ts` shows heavy pre-existing fan-in as a known routing hub,
unchanged in shape by BL-718's small, additive diff — not a new coupling
concern. The rest of the 13 (swarm `.bb`/`.sh`/workflow/doc changes) sit
outside `extension/src`/`extension/media` entirely, so the gate does not
apply to them; cleaner's dependency-direction/module-boundary read for
those already covers that ground from its own lens.

**Invariants Review (BL-654):** 5 of the 13 tickets declare `invariants:`
in their YAML — BL-718, BL-627, BL-636, BL-694, BL-662. Checked each for
a real executable encoding before hand-verifying the property itself:

- **BL-627** (every referenced model is priced, fails loud otherwise):
  covered directly by a fixture-backed example test
  (`extension/test/pricingTable.test.js`, "an unpriced model referenced
  by a fixture conf fails loud and names it") — a fixture conf is the
  natural unit here since `checkPricingCoverage` reads real files; no gap.
- **BL-636** (rotation is priority-first, recency only breaks ties):
  no `fast-check`-equivalent tool is wired for Babashka anywhere in this
  repo today (confirmed: zero `clojure.test.check` usage under
  `swarmforge/`) — a real, project-wide tooling gap, not specific to this
  ticket. `mono_router_lib_test_runner.bb` compensates with a genuinely
  well-chosen example matrix (priority-00 beats a newer priority-50,
  equal-priority ties go to recency, ranking uses a role's *best*
  priority rather than its newest parcel's, a missing priority never
  outranks a valid low-urgency one) that exercises the invariant's actual
  boundary cases. Judged adequate given current tooling; not filed as a
  defect.
- **BL-694** (a stage move never changes the residual-word scan's
  verdict): initially looked untested — the only `extension/test/*`
  consumer (`onboarderRenameNoResidualFacilitator.test.js`) is a
  whole-tree smoke scan, not a direct call. But the ticket's *Gherkin*
  acceptance steps (`specs/pipeline/steps/bl694ResidualAllowlistSteps.js`)
  do call `isAllowlisted` directly for the grandfathered basename across
  all three of `active`/`paused`/`hold`, for the ungrandfathered case, and
  for the basename-collision edge case (same basename, different
  location, must NOT inherit the exemption) — a genuine, well-targeted
  direct encoding of the invariant. No gap; on-par confirmed.
- **BL-662** (every server failure reason reaches the screen): covered by
  four jsdom example tests spanning both action types (expedite, approve)
  and all three response shapes (reason present, reason absent, body
  unparseable) through the one shared `reasonOrFallback` helper both
  actions use — not exhaustive on the two untested approve-branch
  permutations, but those share the same helper already exercised on the
  expedite side, so the risk of an unencoded path is low. No gap.
- **BL-718** (mirror delivery is length-independent: never silently
  truncates; a failed send is always surfaced) — see the independent
  finding below. Not on-par for this invariant specifically.

**Independent finding — BL-718's property test is vacuous for its own
invariant:** `extension/test/cursorBridgeLive.property.test.js` carries
`property: splitTelegramChunks reassembles without loss for short
strings`, generated with `fc.string({ maxLength: 200 })`. The function's
real default split boundary is `TELEGRAM_MESSAGE_MAX_LENGTH = 4096`
(`extension/src/tools/telegramCursorBridgeCore.ts:26`). Since 200 < 4096,
every generated string takes `splitTelegramChunks`'s early-return branch
(`text.length <= maxLen` is always true), so the property runs its
`chunks.join('') === text` assertion against a single-element array on
every single run — the multi-chunk split/rejoin loop the "length alone
never silently truncates" invariant is actually about never executes.
Proof of vacuousness: a deliberately broken multi-chunk branch (e.g.
dropping a character across a split boundary) would leave this property
fully green. Not a live production risk — `telegramCursorBridgeCore.test.js`
independently covers the real 4096-boundary multi-chunk case with
hand-picked examples (including the exact `'a'.repeat(5000)`
lossless-reassembly case and several newline/byte-limit edge cases) — but
the declared-invariant property-test contract itself (BL-654) is not
actually satisfied by this property as written. Filed as its own
shortfall pair, independent of the coder's already-filed acceptance-wiring
gap (BL-726/727): **BL-738** (remaining work) and **BL-739** (pilot
process), both severity low.

**Acceptance-scaffolding observation, not filed as a defect:** BL-723's
own `review-05`/`review-06` step handlers
(`specs/pipeline/steps/bl723PilotReviewSteps.js`) parse only the *first*
`**Filed defects:**` line in a per-ticket section (regex stops at the
first blank line). BL-637's second, cleaner-found pair (BL-736/737) and
this section's own BL-718 pair (BL-738/739) both ride as prose past that
line and are not independently gate-checked by the Gherkin scenario — the
mechanical suite only guarantees the *first* filed pair per ticket is
well-formed. Manually verified by hand that every currently-filed defect
in this batch (BL-726 through BL-739) genuinely carries `type: defect`
and an explicit `severity:`, so the substance of invariant #2 holds; this
is a narrow blind spot in the automated check, not a broken invariant.
Flagging for the hardener/documenter/QA hops still ahead, especially QA's
mandated re-verification pass — not renegotiating the ticket's
human-approved acceptance contract per its own explicit instruction.

No other architecture, boundary, or dependency-direction concerns found
across the 13 landings.

### Hardender viewpoint

Reviewed all 13 landings through the hardener lens: test coverage
completeness, mutation-worthiness of assertions, and CRAP, using actual
tooling wherever it exists rather than reading code structure alone — the
same discipline the coder/cleaner/architect passes already applied to
their own lenses, extended to the one lens none of them ran a tool for.

**Mutation cooldown gate (BL-149):** ran
`mutation_cooldown_gate.bb` against every `extension/src` file touched by
the four TS-scope tickets (BL-718: `bridgeServer.ts`,
`telegramCursorBridgeCore.ts`; BL-627: `pricingTable.ts`,
`modelDisplayName.ts`; BL-642: `needsHumanDetection.ts`; BL-662:
`pausedPagerUiHtml.ts`). All six report `skip-cooldown` — every one was
committed within the last ~2 days, inside the default 3-day cooldown
window. Correctly so: none of tonight's landings should be
prematurely mutation-tested against Stryker while still this fresh.
`mutation_cost: low` is declared on all 13 tickets, consistent with a
light per-ticket touch, but CRAP and coverage-completeness checking are
NOT gated by cooldown or by `mutation_cost` — they ran regardless, and
that is exactly what surfaced every finding below (see BL-741/745's
pilot-process question: does `mutation_cost: low` get mistakenly read as
"skip hardening entirely," not just "skip the expensive mutation run"?).

**CRAP, run for real (`node scripts/crapReport.js`)**, against every
`extension/src` file the four TS-scope tickets touched, on a clean
coverage baseline (see below): found real, attributable, previously
unchecked violations on **two** of the four — BL-627
(`collectReferencedClaudeModels`, CRAP=10.89/79% coverage — the
packs-dir/launch-dir multi-file scan branches this ticket's own fail-loud
invariant depends on are never deliberately driven by a test) and BL-718
(six new/modified functions across `bridgeServer.ts` and
`telegramCursorBridgeCore.ts` exceed CRAP<=6, worst `mergeTopicId` at
CRAP=14.08/**14% coverage** — genuinely new topic-routing logic almost
entirely untested). BL-642 and BL-662's own new/changed functions are all
at or under CRAP<=6; BL-642's `detectNeedsHuman` shows CRAP=11 but
predates this landing entirely (confirmed via `git show`, out of scope).
No prior seat on either ticket ran this check — all three (coder,
cleaner, architect) read structure and invariant-encoding, not
coverage/complexity together.

**Getting a clean baseline required excluding two pre-existing,
already-known issues, neither introduced by this review or its 13
tickets:** (1) the tracked, already-ticketed BL-720 `CURSOR_API_KEY`
cross-file test-pollution flake
(`extension/test/cursorBridgeAgentSession.test.js` permanently unsets an
env var for the rest of its Vitest worker) — confirmed non-deterministic
across three consecutive full-suite runs (2, then 5, then 31 failures in
unrelated files), and confirmed to disappear entirely when that one file
is excluded, matching the already-filed root cause exactly; **not
re-filed**, per that ticket's own explicit instruction. (2) BL-627's own
raw-`mkdtemp` test (see below), which is itself a new finding of this
pass, not pre-existing.

**Repo-wide test-hygiene gate found broken by this review's own artifact,
fixed directly (in-parcel, not a landing under review):**
`extension/test/onboarderRenameNoResidualFacilitator.test.js`'s residual-word
scan flagged this very review body
(`docs/how-to/BL-723-pilot-tonight-quality-review.md`) for citing the
retired test filename `onboarderRenameNoResidualFacilitator.test.js` by
name in the architect's own invariants-review prose. This is a defect in
BL-723's own in-flight artifact, not in any of the 13 reviewed landings —
allowlisted the doc path in `onboarderResidualAllowlist.js` (the same
mechanism BL-694 itself established), matching the existing pattern for
other docs that legitimately cite retired terminology.

**Repo-wide test-hygiene gate found broken by a reviewed landing, NOT
fixed (per this ticket's own reviews-landings-does-not-reopen-them
invariant):** `extension/test/tmpDirMigrationGuard.test.js`'s "zero raw
mkdtemp call sites outside the shared helper" gate is currently RED —
`extension/test/pricingTable.test.js:92` (BL-627's own new test) calls
raw `fs.mkdtempSync` instead of the shared `mkTmpDir()` helper
(BL-420/BL-714). Confirmed deterministic via an isolated rerun, not a
flake. Filed rather than fixed: BL-742/743.

**Non-TS-scope tickets (no CRAP/mutation tooling wired for Babashka/shell —
per this project's own engineering guidance, a manual coverage-completeness
read instead, per-branch):** found genuine, previously unchecked coverage
gaps on **four** of the remaining nine — BL-637 (a *third* independent
shortfall: its own new shell test never invokes the real `stop-swarm.sh`
it claims to verify, re-implementing the refuse/success branch inline with
different wording and a completely missing exit-code-driven refuse path),
BL-623 (traced the coder's/cleaner's own already-noted "no try/catch" nit
on `log-routing-skip!` to its actual call site and confirmed it really
does skip real-time delivery on a write failure — upgrading a nit to a
defect), BL-646 (a new alert severity with no grace-period gate, unlike
its siblings, and a test that can't tell), and BL-661 (two of
`take-flow-reason`'s three branches have zero coverage, one of them with a
demonstrable silent-mis-parse failure mode). BL-694 also flips: a
step handler read as "dead code" by the coder is actually guarding an
entirely untested behavior claim once traced. BL-636 and BL-641 hold up
clean under the same scrutiny — their existing tests genuinely exercise
the boundary cases and wiring this lens checks for. BL-671's one
remaining nit (a static consistency check that only catches direct, not
transitive, `load-file` additions) is real but low-risk — a dynamic
runtime check already covers the gap in practice — so it is noted, not
filed, matching this batch's own established bar for a nit that does not
rise to a shortfall.

**Pattern worth naming, echoing the coder's and architect's own
cross-ticket observations:** every finding in this pass came from either
(a) running a tool no prior seat ran (CRAP), or (b) tracing an
already-noticed observation one level further — to its actual call site,
its actual test coverage, or its actual sibling-branch comparison —
rather than accepting it at face value once flagged. Three separate
"already-noted, not filed" nits (BL-623's try/catch, BL-694's dead step
handler, and implicitly BL-637's own suite design) turned out to be real,
fileable shortfalls once traced one level deeper. This suggests the
gap is not that reviewers miss things — coder, cleaner, and architect
all *noticed* these — it's that noticing was not consistently followed
by tracing to a concrete consequence before being downgraded to a nit.

**Verification:** ran the full unit suite (`npx vitest run`, excluding the
one pre-existing BL-720-flaky file) twice for determinism — 389/390 files
green, only the BL-627 mkdtemp gate red, both runs identical. Ran the
acceptance CLI for BL-627 (6/6 pass) and BL-718 (6/6 fail — confirmed
identical to the coder's own already-filed "no step handler matched"
finding, not a new regression). Ran `gherkin_lint_gate.sh` and the
acceptance CLI against BL-723's own feature file: parses cleanly, all 14
scenarios correctly fail on the Background step requiring the not-yet-
committed briefing email — expected and unchanged, per this ticket's own
text, until the documenter commits it. No orphaned test/mutation
processes before or after this pass (`pgrep -fl 'node --test|stryker'`
scoped to this worktree, checked both times).

### Documenter viewpoint

Reviewed all 13 landings through the documenter lens: does each ticket's
user-facing behavior change carry an accurate, correctly-classified
(Divio-mode) doc, is it discoverable (linked from `docs/index.md`, not
orphaned), and is any doc with a freshness field (e.g. Specification.MD's
`Last Updated`) current. Checked which of the 13 actually needed a new
doc at all before checking whether the doc that landed is adequate — a
ticket with no prior doc surface and no new user-facing behavior (BL-636's
rotation-ordering fix, BL-646's fixture-path fix, BL-559's pre-existing
property test) correctly added none; nothing stale to update either,
confirmed by grepping `docs/` for any prior description of the old, buggy
behavior in each case and finding none. The other 10 tickets each added a
doc, correctly classified (9 how-to task recipes, BL-627's reference doc
sitting in `docs/reference/specs/` alongside its sibling spec docs — no
mode-mixing found anywhere).

**Independent finding: every one of those 10 new docs is orphaned.** This
project's own `docs/index.md` states the rule plainly ("the index stays
exhaustive and orphan-free") and this project already built a real checker
for exactly this — `computeDocsStructure` /
`computeDocsStructureReport` (`extension/src/docs/docsStructure.ts`,
landed by BL-456). Grepping for its only real-tree caller
(`computeDocsStructure(`, the impure entry point) turned up exactly one
call site: its own test file, and only ever against a throwaway
`mkTmpDir` fixture — never this repo's actual `docs/` directory. Running
it for real (`node -e "require('./extension/out/docs/docsStructure').computeDocsStructure('.')"`)
reports 28 orphaned docs total, of which 10 are tonight's own landings:
the 9 how-to docs (BL-623, BL-637, BL-641, BL-642, BL-661, BL-662, BL-671,
BL-694, BL-718) and BL-627's reference doc — none of them linked from
`docs/index.md` despite each one's own documenter pass having just
written it. This is the same "pure module DARK until wired" shape this
project's own guidance already names for other subsystems: the checker is
real and tested, it is just never pointed at the tree it exists to check.
Three of the ten — **BL-641**, **BL-671**, **BL-662** — were on-par under
every other lens; this is their deciding shortfall, so their verdicts flip
above. The other seven were already not-on-par for unrelated reasons; this
is an additional, independent finding on each, noted in their own sections
below rather than silently folded into someone else's already-filed pair.

**Judgment call, stated plainly for QA/human review:** filed as ONE shared
remaining-work/pilot-process pair (**BL-756**/**BL-757**) covering all ten
instances, not ten near-duplicate pairs. Every other seat in this review
filed a distinct pair per ticket even for a repeated pattern (e.g. the
coder's feature-file-with-no-step-handler finding on both BL-718 and
BL-559 got two separate pairs, BL-726/727 and BL-734/735) — deviating from
that precedent here because the fix itself is one mechanical, single-PR
change (ten one-line additions to `docs/index.md`), and ten tickets each
opened to add one line apiece would itself be the kind of unDRY,
process-heavy busywork a documentation-quality pass should be flagging,
not committing. BL-756's own description makes this reasoning explicit so
a human disagreeing with the call can split it back out at spec time.

**Also checked, no gap found:** `docs/reference/Specification.MD`'s
`Last Updated` preamble line already carries a July 30, 2026 entry for the
day's landings (BL-714/BL-630 most recently) — current, no bump needed by
this parcel since BL-723 itself adds no Specification.MD content of its
own. None of the 13 landings changed anything the constitution's mandated
architecture or swarm-workflow diagrams (`docs/diagrams/`) depict — no
pipeline-topology, component-boundary, or backlog-flow change among them —
so neither diagram needed updating in this pass. Confirmed by reading
both diagram sources directly, not inferring from ticket titles alone.

### QA viewpoint

Final gate: independently re-ran the checkable claims from every other seat
rather than trusting the prose, per this ticket's own instruction that QA
compiles and re-verifies against the live pipeline bar before landing.

**Re-run, not re-read, the mechanically checkable findings.** (1) Ran
`computeDocsStructure('.')` against this worktree's real `docs/` tree myself
(`node -e "require('./extension/out/docs/docsStructure').computeDocsStructure('.')"`)
— confirms all 10 of the documenter's named docs (BL-623, BL-627, BL-637,
BL-641, BL-642, BL-661, BL-662, BL-671, BL-694, BL-718) are genuinely
orphaned from `docs/index.md` today, 29 orphaned docs total repo-wide. (2)
Reran `npx vitest run test/tmpDirMigrationGuard.test.js` in isolation — the
BL-627 raw-`mkdtemp` violation at `test/pricingTable.test.js:92` reproduces
deterministically, exact file and line the hardener named. (3) Ran the full
unit suite twice, once with all files (99 then 2 failures — different counts
each run) and once excluding `cursorBridgeAgentSession.test.js`
(consistently 389/390 files green, only the mkdtemp gate red both times) —
this independently reproduces the BL-720 CURSOR_API_KEY cross-file pollution
flake's own signature (non-deterministic failure counts across runs,
converging to a single known-red file once the polluting test is excluded),
matching the hardener's own three-run observation (2, 5, 31) closely enough
to confirm the mechanism, not just the symptom; correctly not re-filed, per
BL-720's own standing ticket. (4) Ran `npm run test:properties` — 30 files,
92 tests, all green, no property-test contract regressions from tonight's
batch. (5) Spot-checked two of the hardener's/coder's live-code claims
directly rather than trusting prose: `PANE_TITLE_SESSION_NAME_PATTERN` in
`needsHumanDetection.ts:40` is `/^SwarmForge [A-Za-z][\w-]*$/` —
confirmed no space is in the character class, so "SwarmForge Model
Steward" (a real title-cased multi-word role name) cannot match, exactly
the BL-642 leak the coder/architect/hardener all named. `kill_pipeline_swarm.sh:271`'s
post-kill survivor check is `pgrep -fl 'handoffd\.bb|copilot.*SwarmForge'`
with no `$ROOT` anchor, unlike the reaping loop's own `pgrep -fl
"handoffd\.bb.*$ROOT"` two sections above it — confirmed the exact
unscoped-vs-scoped asymmetry BL-637's cleaner/hardener findings describe.
Read `babysitter_assess_lib.bb` directly for the BL-646 severity-asymmetry
claim: `:warn-fixture-droppings` (line 106) fires on
`(and head-unchanged? fixture-droppings?)` alone, while its siblings
`:warn-uncommitted` (line 108) and `:watch` (line 110) both additionally
require `(>= elapsed-pct 0.75)` — confirmed the grace-period gate really
is missing on only that one severity, exactly as the hardener named it.
Read `take-flow-reason` in `required_stages_lib.bb` directly for the
BL-661 claim too: the `:else` branch (line 105-108) is an unconditional
`(.indexOf after ",")` split with no lookahead for a quote character, so
an unquoted reason containing a comma really does split at the first
comma and mis-parse the remainder as a new stage:reason pair — confirmed
by reading the branch, not just trusting the hardener's prose description
of it. (6) Compile is clean (`npm run compile`), and no orphaned
`node --test`, `vitest`, or `stryker` processes were running before or
after any of the above (`pgrep -fl` checked at both ends, per this role's
own gate).

**Did not reproduce, and says so plainly:** CRAP/coverage numbers for
BL-627's and BL-718's specific functions (`collectReferencedClaudeModels`,
`mergeTopicId`, etc.) — this worktree's `npm run coverage` run did not
write a fresh `coverage/coverage-final.json` under
`extension/coverage/` (a stale copy exists only in the separate main
checkout, not this QA worktree, and re-pointing `crapReport.js` at
another checkout's coverage would not reflect this commit). Rather than
silently accept the hardener's numbers or silently drop the caveat, this is
recorded here as a real but narrow gap in this pass's own re-verification,
not a defect in the hardener's work — the structural finding these numbers
support (CRAP was never run before this review) is independently
corroborated by the other tooling gaps this pass found runnable and
verified above, and the underlying behavioral claims (e.g. BL-718's
`mergeTopicId` routing logic being new and thin on tests) match a direct
read of the diff.

**Structural gates (review-05/06/07), checked against disk, not prose:**
all 32 filed defects (BL-726 through BL-757, 16 remaining-work/pilot-process
pairs) carry `type: defect` and an explicit `severity:` — verified every
YAML field directly, none missing (the Article 3.2.4 expedite lane's
fail-closed rule never triggers here). All 13 primary tickets' `notes:` in
`backlog/done/` carry every seat's verdict and defect links that walked
through the pipeline (spot-diffed BL-718 against its pre-BL-723 commit:
only lines appended to `notes:`, `description:`/`acceptance:` byte-identical
— no rewritten done history). All 13 remain physically in `backlog/done/`.

**Delivery mechanism (mandatory before approving, per this ticket's own
text):** the briefing email cannot be verified sent until this commit is
actually the one live on `main`, since `handoffd`'s `briefing-email-sweep!`
reads `docs/briefings/` off the live checkout's disk, not off this
worktree's branch tip — a QA approval on an unlanded branch is not yet
visible to that sweep. The check accordingly runs in two parts: first,
here, that the file is committed with the right shape (first non-empty
line "BL-723 pilot review verdict: 13 of 13 landings NOT on par", 57
characters, well under the 80-character cap; not present in
`docs/briefings/.sent.json`, so nothing has silently swallowed it as
already-sent); second, after landing on `main` and pushing to `origin`,
confirming the daemon's own log records either `briefing-sent` for this
file or an explicit `briefing-skip-missing-key`/`briefing-send-failed`
reason to report to the human — never treating an unlogged silence as a
pass. `main`'s own working checkout is currently many commits behind this
worktree (still at BL-723's early `assigned_to: specifier` reset point),
so this file will only become visible to the sweep once this parcel's
push lands and the live checkout's own push-sweep (already running,
`push-sweep up-to-date` on every `handoffd` heartbeat) pulls it in.

**e2e QA procedure (per this ticket's own text), run for real:**
`gherkin_lint_gate.sh` parses this feature file cleanly;
`node specs/pipeline/cli.js` on it passes 13/14, the sole red being
`review-04` (QA section must be longest) — expected until this section
lands and now resolved by this section's own length. Email delivery
verified separately below, and after this parcel lands on `main` and
`origin`, per the mechanism's own live path.

**Independence note:** if this parcel is riding a mono-router pack, the
same resident process plays every seat in turn on a respawned model per
role — a real, load-bearing reduction in cross-seat independence versus a
full pack, per that pack's own overlay prompt. This pass treated that
caveat as binding: every claim re-verified above was re-derived from the
live tree or a fresh command output, not recalled from an earlier hop's
own prose, and the two claims this pass could not reproduce (BL-627/
BL-718's exact CRAP numbers) are reported as unreproduced rather than
rubber-stamped just because an earlier hop already wrote them down.

**Overall QA verdict: concurs with 13 of 13 not-on-par.** Every prior
seat's verdict trail is independently reproducible where reproduction was
possible in this worktree, and every structural contract the ticket
promises (per-ticket write-back, paired defects, no rewritten history, a
QA section that is actually the fullest) holds. This is not the normal
live-swarm bar being met by tonight's batch — it is the normal live-swarm
bar successfully catching what an offline pilot missed, which is exactly
what this queue-jump review was commissioned to test.

## Per-ticket verdicts

### BL-718

**Verdict:** not-on-par

The Bubble talk mirror chunking implementation itself
(`mirrorLetsTalkTurnToBubble`, the shared chunker reuse, the Bubble-vs-Cursor
topic suppression) is correct and has real behavioral unit tests in
`extension/test/letsTalkBridge.test.js` covering chunk reassembly and the
operator-event failure path. But its acceptance feature file
(`specs/features/BL-718-*.feature`) has zero step handlers anywhere under
`specs/pipeline/steps/` — running it would throw "no step handler matched"
on every scenario, so the acceptance contract this ticket names has never
actually gated.

**Filed defects:** BL-726 (remaining work), BL-727 (pilot process)

**Architect note:** independently found a second, unrelated shortfall —
the `splitTelegramChunks` property test in
`extension/test/cursorBridgeLive.property.test.js` caps its generator at
200 chars against the real 4096-char split boundary, so it never
exercises the multi-chunk branch the ticket's own declared invariant
("length alone never silently truncates") is about; it stays green
against a deliberately broken multi-chunk implementation. Real behavior
is independently covered by example tests, so no live risk. Filed as its
own pair: BL-738 (remaining work), BL-739 (pilot process), both severity
low.

**Hardener note:** a third, independent shortfall — CRAP was never run
against this landing. `mergeTopicId` (new, `bridgeServer.ts:113`, the
logic deciding which of a state-file topic id vs. a topic-map id wins
when routing a Bubble/Cursor mirror message) lands at
complexity=4/**coverage=14%**/CRAP=14.08. Five more new or
this-landing-modified functions in the same two files also exceed
CRAP<=6: `readCursorBridgeTopicIds` (new, CRAP=6.91),
`appendPendingChoicePoll` (modified, CRAP=7.07),
`mirrorLetsTalkChoicePollToBubble` (new, CRAP=8.13),
`mirrorLetsTalkTurnToBubble` (new, CRAP=10.01), and `buildPersistedState`
in `telegramCursorBridgeCore.ts` (modified to add the `bubbleTopicId`
branch, CRAP=11.07). `mergeTopicId`'s 14% coverage is the standout risk —
genuinely new routing logic, reachable any time both a state-file and a
topic-map id are present, with almost none of its branch combinations
exercised by any test today. Filed as its own pair, independent of the
coder's acceptance-wiring gap and the architect's vacuous-property-test
finding: BL-744 (remaining work, severity medium), BL-745 (pilot process,
severity low).

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md`) is
orphaned, never linked from `docs/index.md`. Rides the shared BL-756/
BL-757 pair (see Documenter viewpoint section above); no dedicated pair
filed for this ticket alone.

### BL-627

**Verdict:** not-on-par

Root cause addressed directly: wrong per-model rates corrected, the missing
`claude-opus-5` roster entry added, and a fail-loud `checkPricingCoverage`/
`assertPricingCoverage` invariant added so an unpriced model in the actual
roster throws rather than costing as zero. Deliberately declines to build
the cron the operator explicitly rejected. Tests are fixture-backed and
real; the wired acceptance suite passes end to end. Minor nit only, not
filed as a defect: the conf/JSON model scanner is a regex heuristic rather
than a real parser, so an unusually-shaped model id could still evade
detection. Coder, cleaner, and architect all judged this on-par — see the
hardener note below for why the overall per-ticket verdict flips.

**Filed defects:** BL-740 (remaining work), BL-741 (pilot process)

**Hardener note:** not-on-par — two independent findings CRAP/coverage
tooling surfaced that none of the prior three seats' structural/invariant
review caught. (1) `collectReferencedClaudeModels` (new function this
landing added) lands at complexity=10/coverage=79%/CRAP=10.89 — the
`packs/*.conf` and `.swarmforge/launch/*.claude-settings.json` multi-file
scan branches are never deliberately driven by a test, only incidentally
exercised via whatever the ambient real repo happens to contain, even
though those are exactly the sources the ticket's own fail-loud invariant
depends on once a swarm launches with per-role model overrides.
Remaining-work: BL-740. Pilot-process: BL-741. (2) The ticket's own new
test (`extension/test/pricingTable.test.js:92`) calls raw
`fs.mkdtempSync` instead of the shared `mkTmpDir()` helper, which is
currently RED against the repo-wide `tmpDirMigrationGuard.test.js` "zero
raw mkdtemp call sites" gate — confirmed with an isolated, deterministic
rerun (`npx vitest run test/tmpDirMigrationGuard.test.js`), not a flake.
Not fixed in this parcel, per this ticket's own invariant (reviews
landings, does not reopen them). Remaining-work: BL-742. Pilot-process:
BL-743.

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new reference doc
(`docs/reference/specs/BL-627-pricing-table-correctness-and-coverage-invariant.md`)
is orphaned, never linked from `docs/index.md`. Rides the shared
BL-756/BL-757 pair (see Documenter viewpoint section above); no dedicated
pair filed for this ticket alone.

### BL-636

**Verdict:** not-on-par

The priority-first rotation-ordering fix itself
(`mono_router_lib.bb`'s `preferred-rotate-target`) is correct and covered by
real unit assertions for the exact starvation scenario the ticket describes.
But the landing commit's message claims it also restores a `deliver!`
close-paren dropped by BL-611 in `handoffd.bb` — the actual diff never
touches that file; that fix exists only on an unmerged sibling commit. The
paren is closed on `main` today only incidentally, via a later, unrelated
BL-611 commit.

**Filed defects:** BL-728 (remaining work), BL-729 (pilot process)

### BL-637

**Verdict:** not-on-par

Script renaming (`kill_pipeline_swarm.sh` extracted from `kill_all_swarm.sh`),
`--help` scope wording, and the new full-stack `stack_survivor_scan.sh` are
all correct and root-scoped. But `kill_pipeline_swarm.sh`'s own post-kill
survivor check kept the old unscoped `pgrep` pattern — not anchored to
`$ROOT` the way the reaping loop two lines above it is. Reproduced live: it
false-positives on a legitimately running `handoffd.bb` from a sibling
worktree, which is the exact multi-worktree condition this repo runs in
daily and is what this ticket exists to handle correctly. This failed the
ticket's own acceptance suite (8/8) and one shell test when re-run during
this review.

**Filed defects:** BL-730 (remaining work, severity high, live reproducible false positive), BL-731 (pilot process)

**Cleaner note:** independently found a second, unrelated shortfall — the
same landing commit pasted the identical --help heredoc block into 16
scripts instead of factoring it into a shared helper. Filed as its own
pair: BL-736 (remaining work), BL-737 (pilot process), both severity low.

**Hardener note:** a third, independent shortfall —
`test_lifecycle_script_scope.sh`'s stop-path scenarios never invoke the
real `stop-swarm.sh`; they `source stack_survivor_scan.sh` and re-derive
its refuse/success branch logic inline, printing `"full stack SUCCESS —
clean slate"` — a string `stop-swarm.sh` itself never prints (its real
line 96 says `"full stack SUCCESS — no known survivors"`) — and never
exercising `stop-swarm.sh`'s second, independent `kill_rc`-driven refuse
path at all. If the real script's refuse-gate logic broke, this suite
would stay green. Filed as its own pair, independent of the coder's and
cleaner's own: BL-746 (remaining work, severity high), BL-747 (pilot
process, severity low).

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-637-lifecycle-script-scope.md`) is orphaned, never linked
from `docs/index.md`. Rides the shared BL-756/BL-757 pair (see Documenter
viewpoint section above); no dedicated pair filed for this ticket alone.

### BL-641

**Verdict:** not-on-par

Matches the ticket's shape exactly: 20-minute headroom (not a job-level
cap) on the Pages deploy step, and a repo-wide major-version bump across all
workflow files that actually pin the affected actions. Acceptance suite ran
7/7 against real parsed YAML. No coder-eye concerns found. See the
documenter note below for the shortfall that flips this ticket's overall
verdict.

**Filed defects:** BL-756 (remaining work), BL-757 (pilot process)

**Documenter note:** not-on-par (independent finding, the deciding
shortfall — every other lens found this ticket clean) — its new how-to doc
(`docs/how-to/BL-641-pages-deploy-timeout-and-action-majors.md`) is
orphaned, never linked from `docs/index.md`. See the Documenter viewpoint
section above for the full evidence and why this is filed as one shared
pair (BL-756/BL-757) across all ten of tonight's orphaned docs rather than
its own dedicated pair.

### BL-642

**Verdict:** not-on-par

`FOOTER_START_PATTERN` and the `NO_QUESTION_TEXT_CAPTURED` fail-closed
fallback are correct and well tested against the ticket's real repro pane
text. But `PANE_TITLE_SESSION_NAME_PATTERN` only matches a single-token role
name after "SwarmForge " — `swarmforge.sh`'s `display_name_for_role()`
title-cases multi-word roles (e.g. `model-steward` -> "Model Steward"), and a
title-rule line for such a role is not recognized as chrome, confirmed
directly against the shipped regex. This leaves open the exact leak class
the ticket was meant to close, for any multi-word role.

**Filed defects:** BL-732 (remaining work), BL-733 (pilot process)

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-642-gate-snippet-question-not-chrome.md`) is orphaned,
never linked from `docs/index.md`. Rides the shared BL-756/BL-757 pair
(see Documenter viewpoint section above); no dedicated pair filed for this
ticket alone.

### BL-646

**Verdict:** not-on-par

Addresses the actual root cause (CWD-relative fixture writes rather than a
worktree-root-anchored temp dir), correctly inverts the babysitter hint only
for the pure-fixture case (never telling a role to `git add` test debris),
and the guard-root assertion is a genuine regression test. Ran both suites
live: 23/23 shell checks and 12/12 acceptance scenarios pass; the 8
previously-stray files no longer exist. No coder-eye concerns found. See
the hardener note below for the shortfall that flips this ticket's overall
verdict.

**Filed defects:** BL-750 (remaining work), BL-751 (pilot process)

**Hardener note:** not-on-par — `babysitter_assess_lib.bb`'s new
`:warn-fixture-droppings` severity is the only alert-worthy severity with
no `elapsed-pct` grace-period gate, unlike its `:warn-uncommitted`/
`:watch` siblings, so a role that claimed a ticket seconds ago with stale
fixture debris from an earlier run immediately wakes the babysitter LLM.
The one new test always uses a `claimAtMs` 15 minutes in the past, so it
never exercises or asserts this boundary either way.

### BL-623

**Verdict:** not-on-par

Logic is correct for all documented routing-skip scenarios; the acceptance
suite genuinely shells out to `bb swarm_handoff.bb` against a scratch git
fixture and asserts on real header/journal output. Minor nit only, not
filed as a separate defect: an unreachable fallback branch in the
`emit-skip` caller. The coder and cleaner both noted `log-routing-skip!`
has no try/catch despite the ticket's own "a record-write failure must not
block the send" guardrail, judging it a nit — see the hardener note below
for why that traces to a real defect.

**Filed defects:** BL-748 (remaining work), BL-749 (pilot process)

**Hardener note:** not-on-par — traced `log-routing-skip!`'s call site in
`swarm_handoff.bb`'s `-main`: it is bound in the same `let` as, and
immediately before, `try-sync-deliver!` (the real-time tmux wake), and
`-main` has no try/catch anywhere up to the top-level invocation. A write
failure there (disk full, permissions) throws uncaught, so
`try-sync-deliver!` and the draft-file cleanup never run — even though the
parcel was already durably written to outbox moments earlier. This
directly contradicts the ticket's own guardrail. Not high severity: the
parcel itself is not lost (this repo's own backup mailbox delivery path
covers a missed sync-inject), so the practical failure mode is a delayed
wake plus an ugly crash trace, not silent data loss.

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-623-routing-skip-trail-records-actual-hop.md`) is
orphaned, never linked from `docs/index.md`. Rides the shared BL-756/
BL-757 pair (see Documenter viewpoint section above); no dedicated pair
filed for this ticket alone.

### BL-671

**Verdict:** not-on-par

Root cause (ten hand-maintained, unsynced `cp` lists) addressed structurally
via one shared sandbox-copy helper. Cross-checked the helper's lib list
against `operator_runtime.bb`'s actual `load-file` forms directly — all
present, none missing. The acceptance suite genuinely spawns bash against
all 10 real fixture scripts end to end, and the events-lock fixture flake
fix is a bonus correctness improvement. No coder-eye concerns found. See
the documenter note below for the shortfall that flips this ticket's
overall verdict.

**Filed defects:** BL-756 (remaining work), BL-757 (pilot process)

**Documenter note:** not-on-par (independent finding, the deciding
shortfall) — its new how-to doc
(`docs/how-to/BL-671-operator-runtime-fixture-sandbox.md`) is orphaned,
never linked from `docs/index.md`. See the Documenter viewpoint section
above for the full evidence and why this rides the same shared pair
(BL-756/BL-757) as the other nine orphaned docs from tonight's batch.

### BL-694

**Verdict:** not-on-par

Design directly satisfies the stated invariant (backlog-ticket exemptions
survive a stage move via basename matching; everything else stays
exact-path). Acceptance suite exercises the real `scanUnexpected`/
`isAllowlisted` functions across all 5 scenarios, and later commits reusing
the same pattern show it is a real, adopted abstraction rather than a
one-off patch. The coder noted an unexercised step registration with no
matching Examples row as a minor dead-code nit — see the hardener note
below for why that is an untested behavior claim, not cosmetic.

**Filed defects:** BL-752 (remaining work), BL-753 (pilot process)

**Hardener note:** not-on-par — the step handler at
`bl694ResidualAllowlistSteps.js:75` for "a different file with the same
basename at a non-stage path under the backlog" has no matching Examples
row in Scenario Outline 04 (only "outside the backlog" and "elsewhere in
the tree" rows exist; confirmed the regex cannot match either). The claim
it was meant to prove — a basename match under a non-stage `backlog/`
path (e.g. `backlog/topics/`) is correctly not excused — is untested
anywhere, not just cosmetically dead code.

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-694-residual-word-allowlist-survives-stage-moves.md`) is
orphaned, never linked from `docs/index.md`. Rides the shared BL-756/
BL-757 pair (see Documenter viewpoint section above); no dedicated pair
filed for this ticket alone.

### BL-559

**Verdict:** not-on-par

The property suite it names does pass (7/7, real assertions on the rendered
anchor label), but the fix it verifies predates this ticket's own filing and
landing entirely — no coder work happened under this ticket. It was also
QA-landed twice (paused -> done, reverted, re-landed), and its acceptance
feature file has zero step handlers anywhere under `specs/pipeline/steps/`,
so the acceptance contract was never mechanically gated, only asserted in
commit-message prose.

**Filed defects:** BL-734 (remaining work), BL-735 (pilot process)

### BL-661

**Verdict:** not-on-par

Root cause (block-style-only scanner vs. universally flow-style
declarations) correctly fixed at the source; the unit suite ran live, all
pass, covering the real parsing hazard (quoted reasons containing commas and
braces). Caveat, not filed as a separate defect: scenario 05 (the routing
skip-trail audit record carries a flow-style reason end to end) has no step
handler wired against `swarm_handoff.bb` itself — the `.bb` unit test only
simulates the embed, so that specific consumer-impact claim is unverified
end-to-end. See the hardener note below for the shortfall that flips this
ticket's overall verdict.

**Filed defects:** BL-754 (remaining work), BL-755 (pilot process)

**Hardener note:** not-on-par — `take-flow-reason` has three branches
(double-quoted, single-quoted, unquoted/bare-comma-split); every test
exercises the double-quoted branch only. The single-quote branch is
entirely untested, and the unquoted `:else` branch's actual behavior for a
comma-containing unquoted reason (e.g. `cleaner: no test, obvious`) is
untested: it silently splits at the first comma, truncating the reason and
mis-parsing the remainder as the start of a next stage:reason pair, with
no error. Current production risk is low (the ticket's own docstring says
live tickets always use quoted values), but the parser silently
mis-parses malformed input rather than rejecting it.

**Documenter note:** also not-on-par by an independent finding, though not
the deciding one — its new how-to doc
(`docs/how-to/BL-661-stage-skip-reasons-flow-style.md`) is orphaned, never
linked from `docs/index.md`. Rides the shared BL-756/BL-757 pair (see
Documenter viewpoint section above); no dedicated pair filed for this
ticket alone.

### BL-662

**Verdict:** not-on-par

Root cause fixed directly (the parsed response body was being discarded) via
a shared `reasonOrFallback` helper that also removes prior duplication
between the two response branches; jsdom tests genuinely drive the compiled
script and exercise both action types. Caveat, not filed as a separate
defect: the ticket asked to sweep the rest of the file for the same shape —
a scan turned up nothing else, but the sweep isn't documented in the commit;
and the feature file's Scenario Outline has no matching
`specs/pipeline/steps/` handler (covered instead by hand-written unit tests,
which are genuinely real). See the documenter note below for the shortfall
that flips this ticket's overall verdict.

**Filed defects:** BL-756 (remaining work), BL-757 (pilot process)

**Documenter note:** not-on-par (independent finding, the deciding
shortfall) — its new how-to doc
(`docs/how-to/BL-662-paused-pager-shows-server-failure-reason.md`) is
orphaned, never linked from `docs/index.md`. See the Documenter viewpoint
section above for the full evidence and why this rides the same shared
pair (BL-756/BL-757) as the other nine orphaned docs from tonight's batch.
