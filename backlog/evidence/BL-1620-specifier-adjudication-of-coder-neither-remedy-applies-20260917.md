# BL-1620 - specifier adjudication of coder@2's "neither named remedy applies" note, 2026-09-17

Inbound: note `00_20260917T135959Z_000009_from_coder`, priority 00, 13:59Z,
from the coder@2 seat: "BL-1620: neither named remedy applies to either
file - see coder evidence". Evidence
`.worktrees/coder2/backlog/evidence/BL-1620-coder-investigation-20260917.md`
(untracked there; cited, not copied - it rides the seat's next parcel or
stays with its worktree). The seat completed the Work note (009170) at
14:00:07Z with nothing built, so BL-1620 had no live parcel when this was
adjudicated.

## The coder is right; the mint's premises were wrong

Both remedies the mint named were already in place: bl968 builds a
materialized tree (`materializeCurrentPipeline`, BL-968); the telegram CLI
file runs `main()` in-process (`runCli`) in 273 of 275 tests. The measured
costs are elsewhere:

- `telegramFrontDeskBotCli.test.js`: 22.9 s alone (coder@2, JSON reporter);
  ten tests carry 21.8 s, each starting one or two real
  `bb swarm_handoff.bb` processes through `enqueueRoleAnswerNote`
  (`telegram-front-desk-bot.ts` line 1844, `execFileAsync('bb', ...)`),
  about 1.3 s per start. Under 7 s needs a production seam - forbidden by
  the mint's own `constraints:` ("No production code"), which was never an
  approved FIRM. Amended: one optional injected exec parameter (the file's
  own `postFn` convention, 213 uses in the test file); the dedup/pointer
  tests inject a recording fake; BL-1518's test keeps the real script.
- `bl968StepRegistryMaterializedTreeGuard.test.js`: two full step-registry
  loads by design (BL-968 invariant 1); coder@2 measured 15.3 s and 24.2 s
  per spawn. Specifier census (below): one load is 12.6 s of require time
  across 1189 handlers, 19.5 s wall through index.js. No test-side change
  reaches 7 s. Split out: BL-1629 (an accepted pole - a register
  disposition BL-1598 lacks; a row that names a closed ticket reads
  unowned, so a permanent pole today needs a ticket that never closes) and
  BL-1630 (the registry load itself).

## The registry-load census (main 695624c52c, 14:05Z, load 5-6)

Script: one node process, `require()` each `specs/pipeline/steps/*.js` in
name order, `process.hrtime` around each; then `node -e
"require('./specs/pipeline/steps/index.js')"` under `/usr/bin/time`.

```
files 1189 total_ms 12588        index.js load: 19.47s wall
  1216 ms bl1299ReverseHopMasterResidentSteps.js
  1199 ms bl1327DescentLadderProposalSteps.js
  1138 ms bl1320SeatOperatorStepSteps.js
  1129 ms bl1306HandoffAuditRerouteSteps.js
  1119 ms bl1323MainSyncDeadlockOverlapHintsStampSteps.js
  1113 ms bl1332SharedPathLineLeakSteps.js
   804 ms bl1153StickyWebFontSizeChoiceSteps.js
   605 ms bl1335ExhaustionOpensFailoverRecordSteps.js
   571 ms bl1339LandApprovalSharedRootSteps.js
   558 ms bl1375ApprovedSiblingsCanLandSteps.js
   550 ms bl1352EscalationTransportFaultSteps.js
   545 ms bl1343ReplayDropsTheTicketsOwnPathSteps.js
```

The six at 1.1-1.2 s call `sweepStaleFixtures()` at module load (bl1299:71,
bl1327:40, bl1320:42) - a temp-dir listing per handler per registry load.
bl1153, bl592 and bl609 require jsdom at load (bl1046 and bl1160 do it
lazily - the pattern exists); bl1021, bl1064 and bl1069 require node:test
at load (the census run printed "TAP version 13 ... 1..0" and "11 exit
listeners added" at exit). The 2026-08-20 header claim in bl968 ("jsdom
~8-11 s") is stale; today's cost is spread as above.

## Disposition

- **BL-1620 amended** (active, approved kept): scope is the telegram file
  only; the constraint widens to the one seam; scenario 01's Examples lose
  the bl968 row; notes record the amendment and the re-route. The three
  approved FIRMs hold for the file that stays. bl968's row in
  backlog/suite-poles.tsv moves to BL-1629 (owned there until it lands,
  then accepted) - the one bookkeeping change to an approved sentence; the
  human may reject in the topic.
- **BL-1629 minted** (feature, priority 8): disposition column; bl968 first
  accepted row; bl968's blind sweep scoped (BL-1623's helper).
- **BL-1630 minted** (defect, medium, priority 6): the twelve handlers do no
  work at load; a guard pins per-handler and whole-load budgets; census
  before/after with the same script.
- **Coordinator**: re-route BL-1620 as a fresh Work note (the completed
  009170 is a dropped trail: BL-1415 routes without --force); BL-1629 and
  BL-1630 ready in paused.
- **Coder seats**: told the amendment and that a Work note is coming -
  never "rebuild" (BL-1616's wording rule).

The census script is retained here so the numbers are re-runnable:

```js
const fs=require('fs'),path=require('path');
const dir=path.resolve('specs/pipeline/steps');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')).sort();
const rows=[];const t00=Date.now();
for(const f of files){const t0=process.hrtime.bigint();try{require(path.join(dir,f));}catch(e){rows.push([f,-1,String(e).slice(0,60)]);continue;}rows.push([f,Number(process.hrtime.bigint()-t0)/1e6]);}
rows.sort((a,b)=>b[1]-a[1]);
console.log('files',files.length,'total_ms',Date.now()-t00);
for(const r of rows.slice(0,12))console.log(String(Math.round(r[1])).padStart(6),'ms',r[0],r[2]||'');
```

By specifier.
