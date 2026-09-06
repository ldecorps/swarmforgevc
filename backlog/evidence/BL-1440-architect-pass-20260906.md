# BL-1440 — architect pass, 2026-09-06

Ticket: BL-1440-every-constitution-doc-citation-resolves
Role: architect
Commit reviewed: 4d416fc5dc (cleaner NONE pass)

This closes the `constitutionDocCitations` red I independently confirmed
during my own BL-1439 review yesterday (blocking BL-954's Stryker dry
run).

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: `run_commit_guards.sh`'s coupling is expected
  (a well-established shared guard-chain file); nothing else suspicious.
- **jscpd**, independently re-run on both new files: `0 clones`.
- **Register check**: `grep -c constitutionDocCitations
  backlog/standing-reds.tsv` — `0`, confirming the row is gone.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"A cited docs path either resolves on disk or the citation is
   removed; no article is reworded to hide a path it still relies on"** —
   read all six previously-dangling citations: `docs/deprecated/` (now
   has `README.md`), `docs/design/artifact-inventory.md` and
   `docs/design/system.md` (both seeded, matching option 1) — none of the
   citing article text was reworded.
2. **"The commit guard refuses only on evidence the guard itself computed
   at that commit, over the same corpus and resolver the suite test
   uses"** — confirmed `check_constitution_doc_citations.sh` calls
   `findUnresolvedCitations(articlesDir, repoRoot)` from
   `constitutionDocCitations.js` — the exact same function and signature
   the vitest test imports (read both call sites directly). No second
   regex or resolution rule exists anywhere in this diff.

## Independently confirmed non-vacuity myself (via a real fixture, not just trusted)

Built a scratch `git init` fixture with a staged article citing a bare
`` `docs/nope.md` `` (backtick-quoted, matching `CITATION_RE`'s own
`` /`(docs\/[^`]+)`/g `` pattern — my first attempt used no backticks and
was correctly ignored, the same mistake the cleaner's own evidence
independently reports making and correctly diagnosing): ran the real
guard script directly — **refused**, naming the exact article and the
exact dangling path. Fixed the citation and re-staged — **exit 0**.
Reproduces qa_e2e_procedure step 3 exactly, from a fixture I built myself
rather than trusting the coder's or cleaner's own claimed output.

## Independently re-verified the substance

- `npx vitest run test/constitutionDocCitations.test.js` — **6/6 pass**
  (was 5/6) — the ten-day-old red is genuinely green.
- `node specs/pipeline/cli.js
  specs/features/BL-1440-every-constitution-doc-citation-resolves.feature`
  — **4/4 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged.feature`
  (regression — the ticket this exact red had blocked) — **4/4 pass**,
  unaffected.

All matching both the coder's and cleaner's claimed counts exactly.

## required_wiring

All three anchors confirmed present: `check_constitution_doc_citations.sh`
wired into `run_commit_guards.sh`'s cheap tier; `deprecated/README.md`
linked from `docs/index.md`; the new step handler discovered by directory
scan (BL-1371), confirmed by the acceptance run passing 4/4.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
