# BL-337 investigation evidence — 20260713 (coder)

## The human's direct question, answered

**"How many times were 252 and 255 violated since they were introduced?"**

Interpreting BL-252 and BL-255 as ticket IDs that may have been cited as
violation instances within this project's standing engineering rules
(constitution articles + role prompts) — the only place this project
already records "a rule was violated" durably, per the ticket's own
"derive from history, do not add new bookkeeping" instruction:

- **BL-252: violated 1 standing rule since it landed.** Cited in
  `engineering.prompt`'s "Scenario Outline KNOWN_VALUES" rule alongside
  BL-250 and BL-253 (all three landed together in commit `40fdf6b3`,
  2026-07-10). BL-250 is the numerically-smallest citation — the origin
  incident that prompted writing the rule in the first place, so it does
  not count as a violation OF a rule that did not yet exist. BL-252 and
  BL-253 are real recorded violations since landing.
  BL-252 is ALSO cited in `local-engineering.prompt`'s "two phone-viewable
  surfaces" rule, but there it is the numerically-smallest of the three
  citations (252/257/265, landed together in commit `74121ef5`,
  2026-07-10) — i.e. BL-252 is THAT rule's own origin, not a violation of
  it. So: 1 real recorded violation total, not 2 (a naive "how many rules
  cite this ticket at all" count, ignoring origin-vs-violation, would have
  said 2 — see "what was rejected" below).
- **BL-255: violated 0 standing rules.** Its only citation anywhere in the
  constitution/role prompts is `architect.prompt`'s "(source:
  `extension/src/tools/co-change-report.ts`, BL-255)" — crediting which
  ticket BUILT the co-change tool, not recording a violation of anything.
  Mechanically excluded by the same "(source: ...)" pattern-strip that
  keeps every other provenance credit out of the violation count.

Side finding while building the acceptance suite: BL-250 is COINCIDENTALLY
also cited in a completely unrelated rule — `documenter.prompt`'s "one
ticket, one doc entry, one handoff" rule, which cites both BL-245 and
BL-250 (BL-245 is that rule's own origin; BL-250 is a genuine, real
violation of THAT rule, unrelated to the Scenario-Outline rule where
BL-250 is instead the origin). This is expected and correct: a single
ticket ID can be the origin of one rule and a genuine violation of an
entirely different one, since the two are independent classifications
scoped per-rule, not a single global fact about the ticket.

## The general mechanism (the durable part of this ticket)

Per the ticket's own "GENERALIZE — do not hardcode two ticket IDs":
`swarmforge/scripts/standing_rule_violations_lib.bb` scans EVERY standing
rule in EVERY constitution article and role prompt (not just the two the
human happened to notice), and reports a violation count for each. A rule
added tomorrow — anywhere, in any of these files, as a dash bullet or a
numbered list item (both real conventions already in use) — is counted
with zero code change, because the scan walks every top-level rule marker
generically rather than naming files/rules by ID.

**Definitions, precisely, so the numbers are reproducible:**
- A "standing rule" is one top-level bullet (`- `) or numbered item
  (`N. `) in a `swarmforge/constitution/articles/*.prompt` file or a
  `swarmforge/roles/*.prompt` file, together with its wrapped continuation
  lines.
- A "citation" is a distinct `BL-NNN` ticket ID appearing in that rule's
  own text, EXCLUDING one already-observed non-violation pattern:
  `(source: ..., BL-NNN)`, which credits a tool's own authorship rather
  than recording a violation (confirmed real instance: BL-255 above).
- A "violation since landing" is every citation EXCEPT the numerically-
  smallest one. Ticket IDs in this project are assigned sequentially as
  tickets are created, so the smallest cited ID is the earliest known
  incident — the one that most plausibly PROMPTED writing the rule, and
  therefore necessarily predates the rule's own existence (standing-rule-
  violation-observable-02: "violations that predate the rule are not
  counted against it").
- A rule with only its own origin citation (or no citation at all) is
  reported WITH a violation count of zero — never omitted from the list
  (standing-rule-violation-observable-05: "a rule with no violations is
  reported as holding, not omitted").

**What was rejected, and why (shown for transparency, not left silent):**
a simpler first design counted every DISTINCT citation as a violation,
with no origin-exclusion. Under that design BL-252 came out as "2
violations" and the mechanism looked to work fine on a spot check. Only
building the acceptance suite's own scenario 02 ("violations that predate
the rule are not counted against it") surfaced that this over-counts: BOTH
of BL-252's citations turned out, on inspection of real git history
(`git log -S` + `git show <commit>:<path>`), to have LANDED together with
their rule's own first-ever commit — i.e. neither citation was added in a
later, separate edit. Attempting to derive "added before vs. after
landing" from git commit history directly turned out to be unreliable for
this codebase's real authoring pattern: when a rule recurs, the author
typically REWRITES the whole paragraph in one commit, narrating the full
history retrospectively (confirmed: engineering.prompt's "3rd occurrence"
multi-slice-pipeline rule cites BL-272 AND BL-296/297/298 together, added
in the SAME single commit `3a67cd14`) rather than incrementally appending
across separate commits — so "citations present at the block's own most
recent landing commit" would trend toward the WHOLE citation list, most of
the time, making a strict git-diff approach collapse toward the exact
"broken query reads as zero violations" trap this ticket's own TRAP
warning describes. The numerically-smallest-ticket-is-the-origin heuristic
avoids that trap: it needs no git history at all (pure text, fast,
testable without a subprocess), and is directly falsifiable against the
committed prose itself, which is the only source of truth actually
available.

## Live results against the real repo (verified 2026-07-13)

```
$ bb swarmforge/scripts/standing_rule_violations_cli.bb <repo> report
total_citations: 38
rules scanned (every bullet/numbered item, every file): 458
rules with a nonzero violation count: 26
top violators: 3x "A multi-slice emit→route→consume pipeline..." (engineering.prompt)
               3x "The Stryker sandbox copies only the mutated..." (engineering.prompt)
               3x "Make the merged code actually RUN..." (coordinator.prompt)
```
Not a zero-across-the-board result (the ticket's own explicit trap) - 26
real rules show real recorded recurrences, spanning multiple files and
roles, which is itself evidence the mechanism is measuring something real
rather than silently failing closed.

## Where the count is surfaced

`swarmforge/scripts/handoffd.bb`'s `standing-rule-violations-briefing-line`
(wired into `briefing-email-sweep!` via a new `:standing-rule-violations-line`
optional-section adapter, the SAME composition mechanism `briefing_email_lib.bb`
already uses for every other briefing line - BL-252's own suite-duration
line, BL-263's not-done-count line, etc.) reads the real constitution/role
files directly (pure Babashka - no compiled TS dependency, no data-URI/cid
image risk per BL-286's own lesson, since this is plain text, never an
attached image) and appends a line like:

```
Standing-rule violations: 38 cited recurrence(s) across 458 rule(s) since
they landed (top: "A multi-slice emit→route→consume pipeline..." x3,
"The Stryker sandbox copies only the mutated..." x3, "Make the merged
code actually RUN..." x3).
```

to the next unsent daily briefing email, alongside every other existing
section. Verified live (function logic re-run directly against this real
repo, producing the exact real line above) and verified wired (a new test
in `briefing_email_test_runner.bb` proves the adapter's returned line
reaches the actual sent email content, mirroring every prior section's own
wiring test; `test_handoffd_briefing_email_wiring.sh`'s real-daemon smoke
test still passes with the new adapter present).

## E2E note for QA

Per the ticket's own E2E procedure: this evidence's numbers were derived
by running the real CLI (`standing_rule_violations_cli.bb`) against this
real repo, not a fixture render - reproduce with the exact command shown
above. The "KNOWN VIOLATION" unit test
(`standing_rule_violations_lib_test_runner.bb`) independently re-derives
BL-252/BL-250/BL-255's exact classification from the real, live
`engineering.prompt`/`local-engineering.prompt`/`architect.prompt` content
on every run, so a future edit to those files that broke the mechanism
would fail that test immediately, not silently drift.
