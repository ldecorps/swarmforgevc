# BL-1554 — architect review pass, bounce, 2026-09-16

Commit reviewed: merge of cleaner e21b362f67 into architect. Full
checklist run: dependency-gate on the three new TS files PASSED, no
forbidden edges - `src/quality/qaGather.ts` correctly imports no
fs/child_process (the dependency-gate's `no-io-from-policy` zone), all IO
lives in `src/metrics/qaGatherAdapter.ts` per the ticket's own required
split. Co-change report shows only expected sibling coupling. The three
declared invariants: invariant 1 (never encodes a verdict) and invariant
3 (fixed order, blocked-not-omitted) are both covered by a non-vacuous
property test (`qaGather.property.test.js`) generating exit codes,
blocked reasons and adversarial output text; invariant 2 (no
reimplementation) is correctly recorded as a structural/process claim
with a stated reason (BL-654), verified by inspection and by the
register-join unit tests. `main()` is a thin CLI wrapper over
`gatherQaChecklist` (engineering rule). Acceptance
(`BL-1554-*.feature`) is 5/5 green; `qaGather.test.js` (15/15) and
`qaGatherCli.test.js` (4/4) green; the property file green (1/1, 100
runs). One defect found; the full pass is this single item.

## D1

- **Failing command**: reproduced directly against the compiled module (`extension/out/quality/qaGather.js`), not a test-suite failure — see repro below
- **Commit hash**: e21b362f67 (merged as part of this parcel; production file `extension/src/quality/qaGather.ts`)
- **First error excerpt**: `Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)` when parsing a 40-row register JSON (4640 chars) truncated to `EXCERPT_MAX_CHARS` (4000)
- **Failure class**: behavior
- **Expected vs observed**: the register join is expected to correctly classify a failing file as `owned`/`unowned` whenever the register CLI actually names it (invariant 2's own "reads the register CLI's JSON" contract); observed is that once the register CLI's own JSON output exceeds 4000 characters, `composeQaGatherReport` silently reports the SAME file as `absent` instead — a genuinely owned row is reported as if no row existed at all.
- **Blamed role**: coder
- **Remediation pointer**: give the register check its own untruncated capture (or run it a second time only for the JSON, or simply not filter it via `tailExcerpt` before `JSON.parse`) — never reuse the same bounded-for-display `excerpt` field as the machine-parsed source for the register join.

### Root cause and repro

`runChecklist` (qaGather.ts:131-162) stores every check's combined
stdout+stderr through `tailExcerpt` (bounded to `EXCERPT_MAX_CHARS` =
4000, keeping only the LAST 4000 characters) into `CheckRow.excerpt`.
`composeQaGatherReport` then feeds that SAME bounded `excerpt` field to
`parseRegisterOutput`, which does `JSON.parse(row.excerpt)` and silently
returns `undefined` on any parse failure (qaGather.ts:222-231). Bounding
is appropriate for a human-facing report excerpt, but the register
check's own stdout is also the ONLY thing `buildRegisterJoin` has to
determine ownership — once the register CLI's real JSON output exceeds
4000 characters, `tailExcerpt` truncates from the front (cutting the
opening `{`/array structure), `JSON.parse` throws, the exception is
swallowed, and every failing file this run found is reported `absent`
regardless of whether the register actually owns it.

This is not a hypothetical: `bb swarmforge/scripts/standing_red_register_cli.bb .`
against the real live register right now prints 2104 bytes for 12 rows
(~175 bytes/row); the constitution's own circuit breaker (Article 3.5)
treats "register over 10, oldest over 7 days" as a degraded health signal,
so a register of 20+ rows during an incident — well within the range this
project's own health signals already discuss — crosses 4000 bytes and
trips this exact silent misclassification. Reproduced directly:

```
$ node -e "
const qg = require('./out/quality/qaGather');
const bigRows = [];
for (let i=0;i<40;i++){ bigRows.push({lane:'unit', file: 'test/file'+i+'.test.js', ticket:'BL-'+(1000+i), first_seen:'2026-01-01', age_days:1, owned:true}); }
const registerJson = JSON.stringify({rows: bigRows});
const runFn = (command, args) => {
  if (args.some(a => String(a).includes('standing_red_register_cli'))) return { started: true, exit: 0, stdout: registerJson, stderr: '' };
  if (args.includes('test')) return { started: true, exit: 1, stdout: 'FAIL test/file0.test.js\n', stderr: '' };
  return { started: true, exit: 0, stdout: '', stderr: '' };
};
const report = qg.composeQaGatherReport('/fake/root', 'BL-9999', { commit: 'abc1234567' }, runFn, undefined);
console.log(JSON.stringify(report.register_join));
"
[{"file":"test/file0.test.js","join":"absent"}]
```

`test/file0.test.js` is owned by `BL-1000` in the register the fake
`runFn` returned; the report says `absent`. No existing test exercises
this because every fixture (unit tests and the acceptance step handler's
`registerReportFor`) uses a register with one or a handful of rows, far
under the 4000-char bound — the gap is real and untested, not merely
theoretical.

### Why this matters enough to bounce (not a future-proofing nit)

The register join exists so QA (per the ticket's own description) can
tell "pre-existing red, already owned" apart from "new, unowned" without
a by-hand lookup — exactly the judgment this tool is meant to remove
guesswork from. A silent `absent` where the truth is `owned` at register-
growth sizes this project already flags as a health-degraded state risks
QA re-flagging or re-minting a ticket for red the register already
tracks, or treating an already-covered defect as a fresh unowned one -
the opposite of what BL-1554 was scoped to fix.

By architect.
