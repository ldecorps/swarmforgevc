# BL-1410 closure blocked — actually a total main-commit freeze (2026-09-09)

## Symptom reported

`check_feature_handler_registration.sh` refuses BL-1410's closure commit
(active/ -> done/ move) with:

```
missing or unreadable registry module: specs/pipeline/steps/helpers/tmpDir.js
(required by specs/pipeline/steps/index.js)
```

`specs/pipeline/steps/helpers/tmpDir.js` does not exist, and no `require`
statement for it is visible in `index.js` or any discovered handler on
manual inspection.

## This is not BL-1410-specific

`check_feature_handler_registration.sh` calls
`check-feature-handler-registration.js <repo-root>` unconditionally on every
`main` commit — it re-scans the **whole tree**, not the staged diff. The
offending file is already on `main` (not part of BL-1410's closure diff), so
**every commit to main is refused right now**, regardless of what it touches.
Verified directly: `node extension/out/tools/check-feature-handler-registration.js .`
fails against the current tree with no changes staged.

## Root cause (confirmed by instrumenting the checker)

The real offender is `specs/pipeline/steps/bl1410StepHandlersTakeTheStepsLaneRootSteps.js`
— BL-1410's own already-landed acceptance-test handler — **not** `index.js`.
(`featureHandlerRegistrationReport.ts`'s `describeOffender` hardcodes
`(required by ${REGISTRY_PATH})` for the `missing-registry-module` kind
regardless of which file actually required it — a real second bug, and the
reason manual inspection of `index.js` found nothing. Worth a follow-up
ticket, not blocking this fix.)

Line 30 of that file:

```js
/^the feature for "([^"]+)" runs under the acceptance runner with fixture-root creation traced$/,
```

This regex *literal* contains **three** literal `"` characters (the third is
the one inside `[^"]+`, excluding quotes from the capture group) — an odd
count. `featureHandlerRegistrationText.ts`'s `withoutEmbeddedSource` blanks
double-quoted strings by naively scanning for `"…"` pairs across the whole
file; it has no awareness of regex literals or `//` comments. The odd quote
on line 30 desyncs that scan for the rest of the file: the genuinely-intended
exclusion string on line 125,

```js
if (line.trim().startsWith('//') || line.includes("require('./helpers/tmpDir')")) {
```

(written to make an acceptance scenario correctly *skip* lines that merely
mention the old `require('./helpers/tmpDir')` shape as a string, not import
it) ends up split across two mismatched blank-spans instead of being blanked
as one string, leaving `require('./helpers/tmpDir')` exposed as literal text.
`extractRequiredModules`'s regex then matches it as a real require from this
top-level discovered handler, resolving to `specs/pipeline/steps/helpers/tmpDir.js`
— confirmed via a debug harness that monkey-patches `extractRequiredModules`
to log `fromFile` on match; it logs
`specs/pipeline/steps/bl1410StepHandlersTakeTheStepsLaneRootSteps.js`, never
`index.js`.

## Fix

One-character-class edit, zero behavior change to the regex:

```diff
- /^the feature for "([^"]+)" runs under the acceptance runner with fixture-root creation traced$/,
+ /^the feature for "([^\x22]+)" runs under the acceptance runner with fixture-root creation traced$/,
```

`\x22` is the double-quote character — identical match semantics, just no
longer a literal `"` in the source, so the odd-count desync goes away.

## Why an operator can't just commit this

The edit is inside `specs/pipeline/steps/`, one of
`check_pipeline_code_on_main.sh`'s QA-exclusive paths (Article 1.8/4.2,
BL-247) — refused for any committer whose `SWARMFORGE_ROLE` isn't `QA` (and
not import-exempt, since this content doesn't already exist QA-side). It
must land as a QA-role commit through the normal pipeline. Given the total
freeze, this is the highest-priority thing blocking `main` right now.

## Also worth a follow-up ticket (not blocking this fix)

`featureHandlerRegistrationReport.ts`'s `describeOffender` for
`missing-registry-module` always names `REGISTRY_PATH` as the requirer,
never the actual file. `visitRequiredModule` in
`featureHandlerRegistrationCheck.ts` doesn't even track which file produced
each require edge. Both this incident and any future one of the same shape
will misdirect whoever investigates toward `index.js`.
