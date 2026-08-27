# ARCHIVED — drained by specifier 2026-08-27

Disposition:
- Constitution Article 4.5 + `QA.prompt` amendment landed on main at mint (BL-798).
- Minted `backlog/paused/BL-1164-qa-changed-path-unit-test-gate.yaml` (documenter
  how-to slice; human pre-approved).

---

# INTAKE — QA must run unit tests for every changed production path; missing tests bounce to coder

**Source:** human via Cursor, 2026-08-27 ~00:27 BST (BL-668 / handoffd parse outage)  
**Status:** new intake, not minted. Specifier: amend constitution + `QA.prompt`; mint ticket if needed.  
**Direction hint:** `human-requested` — governance tightening after a live CRIT outage.

## Human ask (locked)

> QA has to at least run the unit tests for the code that's been changed. If
> there are no unit tests, it's a bounce back to coder. Amend QA constitution?
> Let specifier know and decide but to me it's pretty evident.

## Incident (why now)

BL-668 (`f5b6b49f1`) landed broken `handoffd.bb` — two `defn` bodies missing
closing parens. QA passed on lib/cli/acceptance gates and a `required_wiring`
grep, but **did not** run `test_handoffd_one_shot_flags_parse.sh` (BL-728 guard
for exactly this failure class). The daemon died on next restart; pipeline
stalled CRIT until hotfix.

QA evidence (`backlog/evidence/BL-668-qa-pass-20260826.md`) shows Article 4.4
inventory ran acceptance + new sweep tests only — not any handoffd parse/load
test despite `handoffd.bb` being in the land diff.

## Gap in current governance

- `QA.prompt` says "Run the full unit test suite; it must be green" — but does
  **not** require running **targeted** tests mapped to **changed paths**, nor
  bouncing when changed production code has **no** registered unit/wiring test.
- Article 4.4 inventory lists compile/unit/acceptance/`required_wiring` but
  does not define a **changed-path unit-test obligation** distinct from
  whole-suite green.
- Coder owns TDD per Article 4.1 pipeline; hardener was skipped on BL-668.
  QA became the last gate that could have caught a parse error in changed
  `handoffd.bb` and did not exercise it.

## Proposed rule (for specifier to adopt verbatim or refine)

### Article 4 — add §4.5 (or fold into 4.2 merge criteria)

**Changed-path unit test gate (QA).** On every QA pass, for each production
path the parcel changes (`git diff --name-only origin/main...HEAD`, excluding
docs-only / backlog-only / generated-only paths per engineering.prompt), QA
must:

1. **Run** every unit, wiring, or `suite-manifest.tsv` test entry whose scope
   covers that path (grep manifest + `swarmforge/scripts/test/` conventions;
   run the narrowest command that exercises the changed module).
2. **Bounce to coder** (`failureClass: unit`) when changed production code has
   **no** registered automated test that loads or exercises it — QA does not
   invent tests; the coder adds them in the same parcel or a follow-up the
   specifier routes.
3. Record each changed-path command in the QA pass evidence under Article 4.4
   inventory (RUN or BLOCKED BY, never omitted).

Whole-suite green remains required; this gate is **additional**, not a
substitute.

### `QA.prompt` — Verification Order (after full unit suite bullet)

- **BL-??? changed-path unit gate:** diff the parcel against `origin/main`;
  for every changed production file, run the mapped unit/wiring test(s) from
  `swarmforge/scripts/test/suite-manifest.tsv` and repo conventions. If no
  test maps to a changed path, bounce to **coder** with `failureClass: unit`
  and evidence naming the uncovered path — do not approve on acceptance or
  lib-only tests alone.
- Example: a `handoffd.bb` change must run
  `bash swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh` (or
  successor) before pass.

### Coder prompt cross-reference (optional, specifier call)

Remind coder: production changes without a mapped unit/wiring test are not
QA-ready; add the test in the same parcel.

## Non-goals (specifier may tighten)

- Does not replace acceptance, property, or full-suite gates.
- Does not require QA to run mutation (hardener-only, unchanged).
- Does not mandate a new tool on day one — manifest grep + existing scripts
  are enough; a `qa-changed-path-tests.js` helper can be a follow-up ticket.

## Request

Specifier: adopt the amendment (constitution Article 4 + `QA.prompt`), mint a
ticket if the wording needs a parcel, and route. Human considers the rule
**evident** — prefer fast adoption over debate unless a genuine conflict with
Article 4.4 run-or-blocked semantics appears.
