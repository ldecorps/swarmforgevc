# BL-259 bounce evidence — 20260710 (QA)

## Failing command

No existing test fails — the gap is that no test in the suite reproduces
the ticket's own stated violation. The reproducing command is my own
manual empirical check, run against the real compiled tool and the real
project ruleset:

```
mkdir -p /tmp/bl259-repro/media
echo "localStorage.setItem('x', '1');" > /tmp/bl259-repro/media/real-violation.js
echo '{ "compilerOptions": { "module": "commonjs", "target": "ES2022", "allowJs": true }, "include": ["src/**/*", "media/**/*"] }' > /tmp/bl259-repro/tsconfig.json

node -e "
const { runDependencyCruiser } = require('./out/tools/dependency-gate');
const { parseDependencyCruiserOutput } = require('./out/quality/dependencyGate');
const raw = runDependencyCruiser(['media'], '/tmp/bl259-repro', './.dependency-cruiser.cjs');
console.log(JSON.stringify(parseDependencyCruiserOutput(raw), null, 2));
"
```

## Commit hash tested

`f27a210` (QA's merge of documenter's handoff `a12a319220`).

## First error excerpt

```json
{
  "passed": true,
  "violations": []
}
```

Expected: a violation reported under `no-webview-storage` for
`media/real-violation.js`. Observed: the gate reports it as clean — the
exact violation pattern the ticket names ("no webview browser-storage
import (localStorage/sessionStorage)") passes silently.

Root cause: `.dependency-cruiser.cjs`'s `no-webview-storage` rule only
matches IMPORTS of a hand-picked list of wrapper package names
(`idb|localforage|dexie|store2|lockr`) — none of which are installed
dependencies of this project (the config's own comment admits this: "none
of these packages are installed in this project (by design)"). But
`localStorage`/`sessionStorage` are global browser objects accessed
directly (`localStorage.setItem(...)`), never via an `import` statement.
`dependency-cruiser` is a static import-graph analyzer; it structurally
cannot see a bare global-identifier reference at all, only module
resolution edges. So this rule can currently only ever fire on an
essentially impossible-today scenario (importing one of five specific,
uninstalled package names) and can never catch the realistic violation —
a developer writing `localStorage.setItem(...)` directly in `media/*.js`.

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure — 191/191 unit test files
(2593 tests) and all 11/11 of BL-259's own acceptance scenarios pass,
because the acceptance fixture for "webview code imports browser storage"
(`dependencyGateSteps.js`'s `FORBIDDEN_EDGE_FIXTURES`) tests
`require('localforage')`, not the real global-usage pattern. The suite is
green because it never exercises the actual threat model; the other 5 of
6 rules (`no-io-from-policy`, `view-not-import-host-io`,
`no-process-spawn-from-view`, `core-not-vscode-api`, `acyclic`) were each
independently spot-checked against a real fixture reproducing their own
named violation and all fire correctly — this bounce is scoped to
`no-webview-storage` alone.

## Expected vs observed

Expected: per the ticket's own wanted behavior ("no-webview-storage: no
webview browser-storage import (localStorage/sessionStorage)") and the
constitution's merge criterion that a gate actually enforces what it
claims, code writing directly to `localStorage`/`sessionStorage` from
`media/*.js` should hard-fail the gate.
Observed: it passes silently. `architect.prompt`'s own new "REQUIRED HARD
GATE" text lists `no-webview-storage` alongside the other 5 genuinely-
enforced rules with no caveat, so every future architect review will
trust this protection exists when it does not for the realistic case —
false confidence in a brand-new permanent gate is worse than no gate for
this one rule, since nobody will think to eyeball it once the tool
"covers" it.

## Suggested fix scope (coder/architect call, not prescribed here)

`dependency-cruiser` cannot see bare global-identifier usage — this needs
either: (a) a small supplementary check alongside the depcruise gate (a
plain regex/grep scan of `media/**/*.js` for the literal identifiers
`localStorage`/`sessionStorage`, reported under the same `no-webview-
storage` rule name so the bounce note stays consistent), or (b) re-scoping
the rule/comment honestly to what it can actually catch (wrapper-package
imports only) and tracking the global-usage case as a separate, explicitly
out-of-scope gap — NOT silently claiming full coverage in architect.prompt
either way. Whichever shape, the fix must be empirically re-verified the
same way this bounce found the gap: write a fixture with the literal
`localStorage.setItem(...)` pattern and confirm the gate actually flags it,
not just that a wrapper-package-import fixture still passes.
