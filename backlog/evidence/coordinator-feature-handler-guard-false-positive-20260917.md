# check_feature_handler_registration.sh false-positive blocking direct-to-main commits, 2026-09-17

While bookkeeping BL-1605's close (QA-approved land `1bcfa2ba45`), the
coordinator's `commit_integrity_cli.bb` close commit (moving
`backlog/active/BL-1605-*.yaml` to `backlog/done/`) was refused by the
pre-commit guard `check_feature_handler_registration.sh`:

```
Commit refused: a feature file would reach `main` with no runnable step handler.

  - missing or unreadable registry module: specs/pipeline/steps/test/helpers/propertyLaneContentionBudget.js (required by specs/pipeline/steps/index.js)
```

This is a false positive in the checker itself
(`extension/src/tools/featureHandlerRegistrationText.ts`,
`withoutEmbeddedSource`), not a real missing module. Root cause:

`withoutEmbeddedSource` blanks double-quoted strings and template literals
via `/"(?:\\[\s\S]|[^"\\])*"/g`, but does NOT account for single-quoted
string literals that contain an embedded `"` character. In
`specs/pipeline/steps/bl1607ShippedStepScanBudgetGrowsWithLaneSteps.js`
(landed on main via `e102e1a5a7`, 2026-09-16 21:04), line ~37 has:

```js
if (c === '"' || c === "'" || c === '`') {
```

The `'"'` single-quoted literal contains a bare `"`, which desyncs the
double-quote-stripping regex's pairing for the rest of the file. Everything
downstream is now misparsed, and a later line (~234) that contains an
embedded require-like string for test purposes:

```js
ctx.bl1607configSource.includes("require('./test/helpers/propertyLaneContentionBudget')"),
```

survives stripping (because the parity is already broken) and gets matched
by the `require('./x')` extraction regex, producing a bogus registry
dependency `specs/pipeline/steps/test/helpers/propertyLaneContentionBudget.js`
that does not exist. Confirmed directly:

```
$ node -e "
const { extractRequiredModules } = require('./extension/out/tools/featureHandlerRegistrationText.js');
const fs = require('fs');
const file = 'specs/pipeline/steps/bl1607ShippedStepScanBudgetGrowsWithLaneSteps.js';
console.log(extractRequiredModules(fs.readFileSync(file, 'utf8'), file));
"
[
  'specs/pipeline/steps/lib/contentionBudget.js',
  'specs/pipeline/steps/test/helpers/propertyLaneContentionBudget.js'
]
```

Isolating just the offending line shows `withoutEmbeddedSource` handles it
correctly on its own — the corruption only appears when scanning the whole
file, confirming the single-quote/double-quote desync theory rather than a
problem with that one line in isolation.

## Why this was not caught earlier

The guard only runs when committing directly ON the `main` branch (or with
`--assume-main`), per its own branch gate. Every other role commits on its
own worktree branch, so this landed and sat latent since 2026-09-16 21:04.
QA's tip-pure lands are fast-forwards (no new commit object), so no
pre-commit/pre-merge-commit hook fires for them either. The coordinator's
backlog-bookkeeping commit (and any specifier commit directly to `main`) is
the first path that actually creates a new commit object on `main` since
this file landed — which is why it surfaces now.

## Impact

Blocks ANY new commit made directly on `main` (coordinator backlog
bookkeeping, specifier spec/prompt/amendment commits) for as long as
`bl1607ShippedStepScanBudgetGrowsWithLaneSteps.js` carries this pattern.
Does not appear to block worktree-role commits or QA fast-forward lands.

BL-1605's close is on HOLD (git mv already staged, commit not yet made) —
no other backlog bookkeeping can complete until this is fixed or a safe
workaround is confirmed.

## Suggested remedy (specifier to adjudicate/mint)

Fix `withoutEmbeddedSource` in
`extension/src/tools/featureHandlerRegistrationText.ts` to correctly skip
single-quoted string literals too (mirror the same blanking treatment
applied to double-quoted strings and template literals), so a `'"'`
character literal cannot desync the double-quote stripping for the rest of
the file. `extension/out/` needs a recompile afterward in every checkout
that commits to `main` directly (master checkout at minimum).

By coordinator.
