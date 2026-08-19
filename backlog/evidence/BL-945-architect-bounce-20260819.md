# BL-945 architect bounce — 2026-08-19

## Reviewed commit

`0bfd52db4` ("BL-945: land docs/branding/icon-system.md on main and gate
future dangling doc citations", By coder), forwarded unchanged by cleaner
(`c41d628662` is a pure merge commit).

## Checks run (complete inventory, not first-failure-stop)

1. **Doc landed correctly**: `docs/branding/icon-system.md` byte-identical
   to `origin/branding/epic-marks:docs/branding/icon-system.md` (empty
   `git diff`); §4d and §5a — the two sections actually cited — present.
   No `docs/branding/assets/**`, no generator scripts, in the diff.
2. **Out-of-scope items untouched**: `git show --stat 0bfd52db4` names only
   5 files; none of `epicIcon.ts`, `topicIcon.ts`, or
   `local-engineering.prompt` (Architecture Rule 6) are in the diff.
3. **Guard test suite** (`extension/test/constitutionDocCitations.test.js`,
   6 tests): all pass. **Independently re-verified non-vacuous**: added a
   dangling citation to a REAL constitution article (`03_backlog.md`, not a
   fixture), ran the suite — exactly one test failed, naming the article
   and the unresolved path; restored, reconfirmed green.
4. **Property test suite**
   (`extension/test/constitutionDocCitationsInvariant.property.test.js`,
   4 tests, coder-authored per coder.prompt's Invariants section): all
   pass. **Independently re-verified non-vacuous**: forced
   `findUnresolvedCitations` to unconditionally `return []` — the "a
   docs/ citation that does not exist is always reported" property failed
   immediately on its first generated case, exactly as the file's own
   non-vacuity comment claims. Restored, reconfirmed green.
5. **Acceptance feature** (4/4 scenarios): pass.
6. **Dependency-rule gate (BL-259 hard gate)**: PASSED, no forbidden edges
   (ran per-parcel against all 4 JS files in the diff, excluding
   `index.js` — its own pre-existing, already-tracked BL-759 cycle is
   unrelated, confirmed at this session's earlier BL-944/BL-631 passes).
7. **Co-change report (BL-255)**: all co-changes at frequency 1, nothing
   flagged.
8. **Fixture discipline**: the step handler tracks every `mkTmp()` root in
   `afterEach`, same established shape as this session's other new
   fixture-heavy files. Independently confirmed 0 leaked
   `sfvc-bl945-*` dirs before and after a real acceptance run.
9. **Invariant 1 negative case** ("never [flagged] because of how it is
   spelled, cased, or punctuated"): a URL and a bare cross-article
   filename (`05_amendments.md`) are correctly never reported — covered by
   both the unit suite and the property suite's decoy generator.

Items 1-2 and 5-9 above are clean. Two defects found in items 3-4's own
surface area — not in what they test, but in what the module under test
itself fails to cover.

## D1 — the citation scanner only recognizes backtick-quoted `docs/...`
paths, silently missing at least two real, currently-resolving citations
in the exact corpus this ticket scans

**Class**: `behavior` (completeness/correctness defect I can see) — bounced
per the architect prompt's own standing rule that a concrete defect
spotted during review is a send-back even when the parcel is otherwise
clean (BL-333 precedent).

**Where**: `specs/pipeline/steps/lib/constitutionDocCitations.js:23`,
`CITATION_RE = /\`(docs\/[^\`]+)\`/g` — requires backtick quoting.

**Reproduced, not assumed**:
```
grep -rn "docs/" swarmforge/constitution/articles/ | grep -v '`docs/'
```
finds exactly two live citations, both in
`swarmforge/constitution/articles/project.prompt` (lines 94-95, itself one
of the files `listArticleFiles` scans — a top-level `.prompt` file):
```
- The full product vision (later milestones) is in docs/reference/Specification.MD and
  docs/explanation/Milestone Roadmap.MD. Build ONLY Milestone 1 described above.
```
Both currently resolve on `main` (`docs/reference/Specification.MD` and
`docs/explanation/Milestone Roadmap.MD` — the latter's real filename
genuinely contains a space), so there is no live dangling citation today.
But running the shipped extractor directly against this file's real text:
```
node -e "const {extractDocCitations}=require('./specs/pipeline/steps/lib/constitutionDocCitations');
console.log(extractDocCitations(require('fs').readFileSync('swarmforge/constitution/articles/project.prompt','utf8')))"
```
prints `[]`. If either file is ever renamed or deleted, this guard stays
silent — exactly the failure mode this ticket exists to prevent, in a file
already inside its own declared scan corpus.

**Why this is a real defect, not nitpicking**: the coder's own commit
message claims the regex was "verified against every real citation across
all constitution articles" — that claim is incorrect; these two citations
exist in the same corpus and were not part of that verification (a full
`grep -rn "docs/" swarmforge/constitution/articles/` inventory, run during
this review, confirms they are the ONLY two non-backtick citations in the
entire scanned corpus — everything else is already backtick-quoted).
Ticket's own description: "the fix is... a check that scans constitution
articles for cited repo document paths and fails when one does not
resolve" — not "backtick-quoted cited repo document paths." Widening to
source-comment citations (`epicIcon.ts`/`topicIcon.ts`) is explicitly out
of scope per the ticket's constraints; this is not that — it is a gap
within the already-in-scope constitution-article corpus.

**Remediation** (direction, not mandate — two options, either closes the
gap):
- Widen `CITATION_RE` to also recognize a bare (non-backtick) `docs/...`
  token that looks like a file citation (a path segment ending in a
  file-extension-shaped suffix), while continuing to exclude the one bare
  directory mention already in scope
  (`engineering-detailed.prompt:655`: `"...docs/ confirmed..."`, no
  filename following). Care needed: `Milestone Roadmap.MD`'s real filename
  contains a literal space, so a naive `\S+`-based pattern will truncate
  it — verify against this exact real sentence, not just a synthesized
  no-space example.
- Simpler and more robust: backtick-quote the two citations in
  `project.prompt` itself, bringing them into the same convention every
  other citation in the scanned corpus already uses (confirmed by the full
  inventory above — no other article has a non-backtick `docs/` citation).
  This is a formatting normalization of an existing citation, not a rule
  change, so it does not read as an Article 5 amendment concern.

Either way: re-run the full `grep -rn "docs/" swarmforge/constitution/articles/`
inventory against the fix and confirm zero non-backtick citations remain
uncovered, not just that the two named here are fixed.

## D2 — the required_wiring anchor does not literally hold

**Class**: `behavior` — a mechanically-checkable gate failure, confirmed
by running the actual tool, not by inspection alone.

**Where**: `extension/test/constitutionDocCitations.test.js:16`,
`const ARTICLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles');`

**The ticket's own required_wiring entry**:
```
extension/test/constitutionDocCitations.test.js::constitution/articles::the citation check must live in extension/test/, ...
```
requires the raw text of this file to contain the substring
`constitution/articles`. It does not: the path is built via `path.join`
across four separate string arguments — the raw source reads
`'constitution', 'articles'` (comma-space, no slash), never
`constitution/articles`.

**Reproduced with the actual gate, not by eye**:
```
bb swarmforge/scripts/pre_qa_gate_cli.bb BL-945 0bfd52db4
```
prints
`PRE_QA_GATE_FAIL wiring BL-945 extension/test/constitutionDocCitations.test.js does not contain "constitution/articles"`.
(The accompanying `ancestry ... stranded on ...` lines in that same output
are an artifact of running the standalone CLI outside the live handoff
flow against branch tips that do not line up in this manual invocation —
unrelated to this finding, not part of this bounce.)

**Why this matters**: `pre_qa_gate_lib.bb`'s own `wiring-findings` does a
plain `str/includes?` substring check
(`swarmforge/scripts/pre_qa_gate_lib.bb:168`) — this is exactly the kind
of literal the engineering rule on required_wiring anchors exists to
enforce mechanically rather than by eyeballing "the file looks like it
references the right directory." Left as-is, this ticket would fail the
pre-QA gate downstream, or (per the lesson already on file for this
project) reach QA with a required_wiring entry that was never actually
satisfied.

**Remediation**: either add a literal `'constitution/articles'` string
occurring somewhere in the file (e.g. a comment, or restructure the
`path.join` call to pass `'constitution/articles'` as one argument instead
of two), or change the required_wiring entry's own pattern to match what
the file actually contains — the former is simpler and does not touch the
ticket's own YAML. Re-run
`bb swarmforge/scripts/pre_qa_gate_cli.bb BL-945 <new-commit>` after fixing
and confirm the `wiring` finding is gone (the unrelated `ancestry`
findings from this standalone invocation are expected and not a signal of
success or failure here — check with the live handoff flow, not this
manual CLI, for the true pre-QA verdict).

## Everything else in this parcel is clean

Items 1-2 and 5-9 above. D1 and D2 are the only items in this inventory.

By architect.
