# BL-534 — hardener pass — 2026-08-25

Architect tip: `b2a00b8aeb` (recreated `swarmforge-hardender` on tip; no hitchhiked merge).

## Scope hardened

- `extension/src/quality/thinMainGate.ts` — CRAP extract (decision-kind sets,
  export-detection helpers, named-export predicates)
- `extension/src/tools/thin-main-gate.ts` — thin CLI (unchanged public surface;
  dogfood + unit coverage)
- Unit: `extension/test/thinMainGate.test.js` (expanded killer suite)
- CLI unit: `extension/test/thinMainGateCli.test.js` (new)
- Properties: `extension/test/thinMainGate.property.test.js` (2/2)
- Feature stamp already present from prior soft Gherkin pass (6/6)

## Gates

| Check | Result |
|---|---|
| Unit (vitest) | 49/49 green (36 quality + 13 CLI) |
| Properties | 2/2 |
| Acceptance | 4/4 |
| Dogfood CLI `main()` subprocess | exit 0 or 1 (entrypoint exercised) |
| CRAP ≤ 6 on changed TS | all functions ≤ 6 after extract |
| DRY (jscpd on both TS files) | 0 clones |
| Gherkin soft mutation | stamp present: 6/6 killed |

## Stryker (scoped)

Config scratch: `stryker.bl534.config.json` + `vitest.bl534.stryker.config.mjs`
(mutate `out/quality/thinMainGate.js` + `out/tools/thin-main-gate.js`).

| File | Score | Killed | Survived | No cov |
|---|---|---|---|---|
| thinMainGate.js | **95.16%** | 176 | 6 | 3 |
| thin-main-gate.js | **89.04%** | 65 | 3 | 5 |
| **All** | **93.44%** | 241 | 9 | 8 |

### Accepted equivalents (BL-234 / guard-class; commit-local)

**Quality AST guards (6)** — TypeScript AST shape makes these observationally
identical on every reaching fixture we can author without inventing illegal
trees:

1. `functionName` parent guard `!parent \|\| !isVariableDeclaration` → `false`
   / `&&` — arrow mains always have VariableDeclaration parents; function
   declarations never enter the parent-name branch.
2. `findMainNode` `isFunctionLike && body` → `\|\|` — overload signatures
   without bodies still resolve to the implementation declaration with the
   same finding.
3. `variableMainIsExported` early `!isVariableDeclaration` → `false` / empty
   block — FunctionDeclaration parents walk to SourceFile and still return
   false; VariableDeclaration path unchanged.
4. `statementExportsMain` `!isNamedExports` → `false` — `export *` /
   `export * as` already fail the `exportClause` / named-elements path before
   `.elements` is read; skipping the NamedExports check is unobservable.

**CLI (3)**:

1. `mode === 'full' ? loadAllowlist : empty` → always load — **equivalent**
   because `applyAllowlist` ignores allowlist contents in parcel mode
   (invariant 1). Loading is dead for parcel outcomes.
2–3. `EXTENSION_ROOT` `__dirname/'..'/'..'` string mutants — every unit path
   injects `extensionRoot`; default is unused under test. NoCoverage on
   `main()` argv/console branches is entrypoint boilerplate (dogfood
   subprocess covers the live binary, not the Stryker sandbox copy).

No remaining survivor is a behavioral gap for the gate contracts (parcel never
allowlists; allowlist only shrinks; CC≤2 exported `main`).

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-534-thin-main-crap-visible-cli-gate`, commit = this hardener tip.

By hardener.
