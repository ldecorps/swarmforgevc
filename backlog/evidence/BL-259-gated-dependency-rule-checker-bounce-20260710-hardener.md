# BL-259 bounce evidence — 20260710 (hardener)

## Failing command

No existing test fails — the gap is that no test in the suite reproduces
this false-positive case. My own manual empirical check, run against the
real compiled fix:

```
node -e "
const { scanTextForStorageGlobal } = require('./out/quality/dependencyGate');
const text = [
  '// This view intentionally avoids localStorage/sessionStorage per',
  '// local-engineering.prompt - state lives in the extension host instead.',
  'function noop() { return 1; }',
].join('\n');
console.log(JSON.stringify(scanTextForStorageGlobal('media/compliant.js', text)));
"
```

## Commit hash tested

`648f76d` (coder's "BL-259: fix no-webview-storage gate gap", QA bounce
`6747a4812d`), merged into the hardener branch at `fd7c471`.

## First error excerpt

```json
{"from":"media/compliant.js","to":"localStorage","rule":"no-webview-storage"}
```

Expected: `null` (no violation) — the file contains no actual
`localStorage`/`sessionStorage` API usage anywhere, only a comment
explaining that it deliberately avoids them.
Observed: a hard-fail violation, identical in shape to a real usage
violation.

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure — 191/191 unit test files
and all of BL-259's own acceptance scenarios pass, because none of them
exercise a comment-only or string-literal-only mention of the identifier.

## Expected vs observed

Root cause: `STORAGE_GLOBAL_PATTERN = /\b(localStorage|sessionStorage)\b/`
(`dependencyGate.ts`'s `scanTextForStorageGlobal`) is a raw-text regex
scan with word-boundary matching — this correctly fixed the ONE
false-positive QA's own prior bounce evidence didn't test for
(`myLocalStorageHelper`, a substring), but the fix's own doc comment only
claims that fix ("Word-boundary match so e.g. `myLocalStorageHelper`
never false-positives"). The regex has no concept of code vs. comment vs.
string literal — it matches the bare word ANYWHERE in the file's raw
text, including inside a `//` comment or a string. Since this is a HARD
GATE (the architect bounces immediately on any reported violation, per
the ticket's own design), a developer who writes a compliant file with
an explanatory comment mentioning the forbidden identifiers — exactly
the kind of careful, well-documented code the rule exists to encourage —
gets hard-failed identically to a real violation, with no way to
distinguish the two from the report alone (`{ from, to: 'localStorage',
rule: 'no-webview-storage' }` looks the same either way).

Confirmed via `git log`/`grep`: no test anywhere (unit, CLI, or
acceptance) exercises a comment-only or string-literal-only mention of
`localStorage`/`sessionStorage`; the code's own doc comment claims
protection only against the substring case, not this one — this reads as
an unaddressed gap, not an intentionally accepted tradeoff.

## Suggested fix scope (coder/architect call, not prescribed here)

`scanTextForStorageGlobal` needs to distinguish actual API usage from
prose mentioning the identifiers. Options (not choosing here — this is
product-behavior work, outside the hardener's remit):
- (a) Strip `//` line comments, `/* */` block comments, and string/
  template literals from the text before applying
  `STORAGE_GLOBAL_PATTERN` (a small, bounded tokenizer pass — no need for
  a full JS parser).
- (b) Require the match be followed by a property/method access
  (`localStorage.`/`localStorage[`) to look like real API usage, not a
  bare word — cheaper than (a) but still regex-based and could still
  false-positive on e.g. a comment literally containing
  `localStorage.setItem(...)` as an example.
- (c) Use dependency-cruiser's own AST/parser layer if it exposes one, or
  a lightweight existing tokenizer already a devDependency, rather than
  hand-rolling comment/string stripping.

Whichever shape, the fix must be empirically re-verified the same way
this bounce found the gap: a fixture with the literal identifier
appearing ONLY inside a comment or string, confirming the gate now
passes it, alongside the already-covered real-usage and substring
(`myLocalStorageHelper`) cases staying correctly handled.
