# BL-1277 — architect bounce

Architect, 2026-08-30. Reviewed cleaner's `3edaffd80a` (merge of coder's
`37842890e9` into cleaner, no changes made by cleaner).

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own changed files under `extension/test/`) — PASSED, no forbidden edges.
  `specs/pipeline/**` files are outside this gate's domain (extension
  host/webview boundary only); nothing in the parcel touches `extension/src`.
- `node extension/out/tools/co-change-report.js` against the parcel's changed
  files — no pair at or above the default threshold (frequency 3); every
  reported pair is frequency 1 (first co-occurrence, not standing coupling).
- Invariants Review (BL-633/654): both declared invariants have a live,
  non-vacuous property test in `extension/test/bl1277StepCollisionInvariants.property.test.js`.
  Re-ran `npm run test:properties -- bl1277`: 5/5. Invariant 1 is exhaustive
  over the ambiguous corpus (not sampled — the evidence file documents why a
  sampled version was worthless) plus a construction-guaranteed sensitivity
  draw; invariant 2 is adversarial against the source-scan re-implementation
  it forbids. Both show non-vacuity by a break-then-restore run (documented in
  the coder's evidence file, spot-checked by rerunning the property lane
  green on the restored tree).
- Re-ran and confirmed the coder/cleaner's headline claims directly rather
  than trusting the evidence files alone:
  - `extension/test/bl1277UnscopedStepCollisionGuard.test.js`: 6/6.
  - `npm run test:properties -- bl1277`: 5/5.
  - `node specs/pipeline/cli.js specs/features/BL-1277-...feature`: 5/5.
  - `BL-1268-stale-claim-branch-must-name-this-ticket.feature`: 7/7 (was 2/7).
  - `BL-378-no-single-file-bounds-the-suite.feature`: 4/4 (was 3/4).
- Spot-checked five of the sixteen re-scoped files
  (`alwaysOnOperatorPresenceSteps`, `bl437FleetStatusPublishSteps`,
  `dependencyGateSteps`, `gateAnswerSteps`,
  `theFrontDeskAnswersAtTheAgreedVerbositySteps`,
  `bl483MultiOptionAskButtonsSteps`, `bl617NightlyCooldownWindowSteps`) against
  their feature files' own `Feature:` title line — every `BL1277_FEATURE_NAME`
  constant is a byte-for-byte match of the feature it claims.
- `specs/pipeline/stepRegistry.js`: only addition is the read-only
  `listDefinitions()` accessor; `resolve()` untouched, per the ticket's
  constraint.
- Architecture: guard is a pure module (`stepCollisionGuard.js`) consumed by
  three lanes through one verdict path; correct dependency direction
  (depends on `stepRegistry.js`'s public API, never on step-file source
  text) — matches invariant 2 by construction. No layering concern.

## D1 — stray literal NUL byte in the property test file (send-back)

`extension/test/bl1277StepCollisionInvariants.property.test.js` line 120:

```
    const key = `${feature}\x00${text}`;
```

That is not the two-character escape sequence `\0` — it is a single literal
NUL byte (0x00) sitting raw in the source file, confirmed with `od -c`:

```
0000020   `   $   {   f   e   a   t   u   r   e   }  \0   $   {   t   e
```

Consequence, already observed rather than theoretical: `git diff` /
`git show` render this entire 321-line file as `Bin 0 -> 15571 bytes` — the
merge that landed it (`e8bafb136`) shows no line diff at all for this file,
and neither will any future change to it. `file` reports the file as `data`,
not text. This defeats line-level code review, `git blame`, GitHub's diff
view, and this repo's own `co-change-report.js` (which reasons over commits
touching the file, not its line content, so it is not itself broken, but any
future *line-level* tool would silently no-op on this file the way `git diff`
already does).

The value at runtime is correct — a JS template literal may contain a raw
NUL and `Set`/string equality works over it fine, which is why every test
still passes — so this is not a logic defect. It is a send-back anyway
(architect role: "a correctness defect you can see is a send-back too...
even when the code is architecturally clean"): the file is durably
unreviewable as text from this commit forward, in a source file that itself
belongs to the pipeline's testing/quality tooling.

**Remediation**: replace the raw byte with the escape sequence `\0` (renders
as backslash-zero, two ASCII bytes) — or, since NUL is unlikely to appear in
either `feature` or `text`, a printable delimiter (e.g. `` `${feature}\0${text}` ``
written via the escape, or simply `` `${feature}|${text}` ``) removes any
ambiguity for a future reader. Verify with `git diff` on the fixed file
rendering as a normal text diff (not `Bin`), and `file <path>` reporting
ASCII/UTF-8 text.

No other defect found. Complete review inventory: this is the only item.
