# Intake request (operator, 2026-07-10, via coordinator)

## Automated temporal / co-change coupling tool for the architect (make the Feathers check a real tool, not just a prompt instruction)

**Problem:** `architect.prompt:32-37` tells the architect to detect LOGICAL
(temporal) coupling by eyeballing `git log` for files that change together — the
Michael Feathers co-change technique. Today that is a manual, non-reproducible
instruction with no tool behind it. Make it a real, repeatable analysis tool the
architect runs and consumes, so hidden coupling detection isn't left to whether
the architect remembered to hand-inspect git history.

**Inspiration — Michael Feathers, "Using Repository Analysis to Find Single
Responsibility Violations":**
https://michaelfeathers.silvrback.com/using-repository-analysis-to-find-single-responsibility-violations
(and his `delta-flora` Ruby tool). Core ideas to draw from:
- **Premise:** the set of things changed together in a commit (he used a *day*'s
  changes) is usually one story/feature, so **coincident change reveals
  responsibility/coupling** that static imports don't show. Treat repo history as
  design documentation.
- **Technique:** parse git history, extract what changed, aggregate **co-change
  frequency** of items that appear together, and surface clusters.
- **Granularity:** Feathers went to **method level** (delta-flora mapped commits
  → method add/change/delete events, emitted CSV). For us, **file-level is the
  MVP** (matches the architect prompt's "which files most often appear alongside
  them"); method-level is a valuable later slice.
- **Thresholds (tunable):** Feathers tuned to "groups of size > 2 with frequency
  > 3" to get coherent clusters. Ours should expose similar tunable
  min-cooccurrence / min-support knobs, not hardcode.

**Wanted (for the specifier to shape into acceptance):**
- A host-side tool that reads `git log --name-only` (or `--numstat`) history and
  computes, for a given set of changed files (the parcel under review), **which
  other files most frequently co-change with them**, ranked by co-occurrence
  count / support — flagging pairs above a tunable threshold as suspected logical
  coupling the static dependency graph misses.
- Output a concise report the **architect** consumes during its review (feeds
  `architect.prompt:32-37`); the architect still makes the pass/bounce judgment.
- Tunable knobs: min co-change frequency, min group size, and a history window
  (all commits vs recent N).

**Constraints / fit (specifier + engineering rules):**
- TESTABLE host-side module: git-history reading sits behind an **injectable
  seam** (feed recorded `git log` output), faked in unit tests — **no real git
  invocation in unit tests** (engineering test-double rules). Assert on the
  computed co-change ranking from fixture history, not on live repo state.
- REUSE, don't reinvent: this is a NEW analysis tool (no existing co-change tool
  in the repo — grep-confirmed). Language TS (host-side), alongside the other
  quality scripts. Follows the pinned-tool discipline only if it wraps an external
  tool; otherwise it's project code with its own tests.
- Deterministic output (stable ordering) so the architect's report diffs cleanly.

**RELATED (mention, specifier's call whether to fold in or separate ticket):**
the earlier idea of a tool-enforced **static dependency-rule gate** (high-level
policy independent of low-level detail; low-level adapters depend inward — the
Dependency Inversion rule the architect/cleaner check by hand). Static
(import-direction) + temporal (co-change) coupling are complementary; they could
be one "coupling analysis" tool with two lenses, or two tickets. Specifier decides.

**Priority:** normal — not blocking; schedule it into the queue. (Operator did not
mark it top-priority.)

_Turn this into a proper spec (prose description + Gherkin acceptance), place it in
backlog/paused/, and remove this intake file._
