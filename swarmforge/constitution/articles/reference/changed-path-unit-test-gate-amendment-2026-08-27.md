# AMENDMENT (INCORPORATED): Changed-path unit test gate for QA — BL-1164

> **Status: INCORPORATED, 2026-08-27** (Article 5.1 step 2, by the specifier).
> The binding form now lives in **Article 4.5** (`articles/04_quality_gates.md`),
> mirrored in **`QA.prompt`** (Verification Order) and **`coder.prompt`**
> (QA-ready cross-reference). This file is the adoption record — read Article
> 4.5 and QA.prompt for the rule in force.
>
> **Origin:** human directive via `backlog/INTAKE-qa-changed-code-unit-test-gate.md`
> (2026-08-27), after BL-668 landed broken `handoffd.bb` and QA passed without
> running `test_handoffd_one_shot_flags_parse.sh` despite `handoffd.bb` in the
> land diff.

## Human ask (verbatim)

> QA has to at least run the unit tests for the code that's been changed. If
> there are no unit tests, it's a bounce back to coder.

## Full rule text (Article 4.5)

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

## Worked example

A `handoffd.bb` change must run
`bash swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh` (or
successor) before QA pass.

## Non-goals

- Does not replace acceptance, property, or full-suite gates.
- Does not require QA to run mutation (hardener-only).
- Day-one tooling is manifest grep + existing scripts; a dedicated helper may
  follow in a later ticket.
