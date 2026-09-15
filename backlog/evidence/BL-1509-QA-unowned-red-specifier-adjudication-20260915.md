# BL-1509 — specifier adjudication of QA's five unowned property-lane reds, 2026-09-15

Specifier record, made while completing QA's `unowned-red` note of
2026-09-15T14:23Z (`BL-1509 unowned-red hold: 5 reach-floor flakes, see
3fd48291df`, inbound `00_20260915T142336Z_002753_from_QA_to_specifier`).
QA's evidence is `backlog/evidence/BL-1509-QA-unowned-red-20260915.md` on
QA commit `3fd48291df`: three consecutive `npm run test:properties` runs on
the merged BL-1509 parcel, five distinct red files, no repeats, all
described as reach-floor / rare-sample assertions. Runs 1 and 2 carry the
assertion text; run 3's three files carry none. This file is the basis for
the two owner tickets minted with it (BL-1578, BL-1579), the five
`backlog/standing-reds.tsv` rows, and the QA prompt amendment asking for the
message verbatim per red file.

## 1. Can each file miss its floor by sampling? (fast-check 3000 seeds each)

Each file's own arbitraries were re-drawn with `fc.assert(..., { numRuns,
seed })` for seeds 1..3000 and the count the floor assertion reads was
recomputed (script in section 5).

| file | floor | sampled? | misses / 3000 |
|---|---|---|---|
| bl1529ScriptSenderAuditOutcomesInvariant | `reached.queued >= 5` and `reached.failed >= 5` after 20 draws of `constantFrom(2 kinds) x constantFrom(5 stages)` | yes | 44 (1.47%) |
| meanTicketTimeCost | `casesReachingLargeCorpus >= 2` after 12 draws of `oneof(small, large)` | yes | 11 (0.37%); QA saw 0 of 12, itself a 2-in-3000 event |
| bl622TelegramTokenSeparationInvariant | `seenConflict.true > 0` after 30 draws | yes, and mis-constructed | 5 (0.17%) |
| bl1343ReplayNeverDropsOwnPathInvariants | inv 1 `partiallySubtracted > 0` (needs a `mixed` case with >= 2 files in 9 draws); every other floor constructed per shape | only that one | 0 |
| bl1323StampOffInvariants | four shapes each iterated with its own `fc.assert`, `numRuns: 5` | no | 0 (cannot miss) |

bl622's construction defect: the file says "Collisions are CONSTRUCTED (one
swarm's token copied onto another's), never left to chance", but the copy
is `tokens[names[1]] = tokens[names[0]]` while the checked subject is
`names[names.length - 1]`. Drawn list lengths over 90000 draws: 2 -> 33888,
3 -> 34496, 4 -> 21616, so the conflict arm is reached only on a two-name
draw with `forceCollision` true, about one draw in six; three- and
four-name draws with `forceCollision` true construct a collision between
two bystanders and assert no conflict, which is also what the code returns,
so the property passes while exercising the conflict branch only by luck.

## 2. Each file alone on the tree (`.worktrees/hardender` at `25a44feb63`, source identical to `main` for these files)

`npx vitest run --config vitest.properties.config.mjs test/<file>`, once
each in sequence, 15:26:35-15:27:43 BST, load 3.4-5.1 on 20 cores:

| file | result | test durations |
|---|---|---|
| bl1323StampOffInvariants | 3 passed | invariant 2 **10431 ms**, invariant 3 569 ms |
| bl1343ReplayNeverDropsOwnPathInvariants | 2 passed | invariant 1 **12770 ms**, invariant 2 **10317 ms** |
| bl1529ScriptSenderAuditOutcomesInvariant | 1 passed | 26466 ms (own 60 s timeout) |
| meanTicketTimeCost | 2 passed | 1097 ms, 1111 ms |
| bl622TelegramTokenSeparationInvariant | 2 passed | 582 ms, 326 ms |

`vitest.properties.config.mjs` sets `testTimeout: 20000`. bl1343's and
bl1323's long invariants each build a git repository or shell `bb` per
draw and sit at half the budget on a lightly loaded box; QA's three lane
runs were concurrent with the hardender's BL-1509 Stryker run (13:30-14:50)
and QA's own unit suite. A per-test timeout under that load is the leading
hypothesis for run 3; a subprocess failing inside a property under load
is the second. Neither is a floor, and QA's evidence records no message
for these files, so the cause is not established here.

## 3. Disposition

- **BL-1578** (defect, high) owns bl1529, meanTicketTimeCost and bl622:
  each floor met by construction (outer loop over the cells,
  `runsPerCell(budget, cells)` draws each, `assertReachFloor` per cell),
  floors kept, budgets kept, bl622's collision constructed on the subject.
- **BL-1579** (defect, high) owns bl1343 and bl1323: reproduce under lane
  load with the failing message recorded, remove the observed cause
  without lowering a floor, or retire the rows on 25 recorded green runs.
- Five rows appended to `backlog/standing-reds.tsv`, first_seen 2026-09-15,
  each naming its owner. QA sent the BL-1566-shape resume note.
- `swarmforge/roles/QA.prompt` amended: unowned-red evidence carries the
  assertion or timeout message verbatim per red file.

Why not one root-cause ticket: three of the five reds have a known,
simulated cause with a known fix shape (BL-1555/BL-1572), and two have no
recorded cause at all; bundling them would either ship a guess for the
two or hold the three on a reproduction they do not need. Why not five
tickets: the three fixes are one loop restructure each (BL-1555 shipped
two in one sitting) and the two reproductions share one procedure.

## 4. Statistical note for the owner of BL-1579

With per-run miss rates of 1.5%, 0.37% and 0.17% for the three sampled
files, the expected number of sampled-floor reds across QA's three lane
runs is about 0.06; QA observed three, plus two files that cannot miss.
Five distinct reds in three runs is not what independent sampling
produces, so the load hypothesis in section 2 should be tested against ALL
five files' logs, not only the two BL-1579 owns: a loaded lane run may be
turning fixture-spawning properties red by timeout and pure properties red
by seed at the same time. BL-1579's reproduction records every red of the
lane, whichever file it lands on.

## 5. Simulation script (re-run this, do not re-derive)

```js
// from extension/: node sim.js
const fc=require("fast-check"); const N=3000;
{ const LARGE=200; const arb=fc.oneof(fc.integer({min:0,max:20}), fc.integer({min:LARGE,max:400}));
  let miss=0, zero=0; for(let s=1;s<=N;s++){ let k=0; fc.assert(fc.property(arb, fc.integer({min:0,max:4}), (c)=>{ if(c>=LARGE) k++; }), {numRuns:12, seed:s}); if(k<2) miss++; if(k===0) zero++; }
  console.log("meanTicketTimeCost: <2 large in 12:", miss, "/", N, " zero:", zero); }
{ const names=fc.uniqueArray(fc.constantFrom("fes","fes2","fes3","staging","secondary"),{minLength:2,maxLength:4}).map(a=>a.slice());
  let miss=0, lenHist={}; for(let s=1;s<=N;s++){ let t=0; fc.assert(fc.property(names, fc.boolean(), fc.integer({min:0,max:1000000}), (n,f)=>{ lenHist[n.length]=(lenHist[n.length]||0)+1; if(f && n.length===2) t++; }), {numRuns:30, seed:s}); if(t===0) miss++; }
  console.log("bl622: zero genuine collisions in 30:", miss, "/", N, "lenHist", JSON.stringify(lenHist)); }
{ const arb=fc.record({files:fc.array(fc.record({name:fc.constantFrom("a","b","c","d","e"),dir:fc.constantFrom("w","x","y","z"),u:fc.boolean()}),{minLength:1,maxLength:4})});
  let miss=0; for(let s=1;s<=N;s++){ let partial=0; fc.assert(fc.property(arb,(c)=>{ if(c.files.length>=2) partial++; }),{numRuns:9,seed:s}); if(partial===0) miss++; }
  console.log("bl1343 mixed: no partial in 9:", miss,"/",N); }
{ let miss=0; for(let s=1;s<=N;s++){ const r={queued:0,failed:0}; fc.assert(fc.property(fc.constantFrom("queued","failed"),fc.constantFrom("a","b","c","d","e"),(k)=>{r[k]++;}),{numRuns:20,seed:s}); if(r.queued<5||r.failed<5) miss++; }
  console.log("bl1529: a kind under 5 of 20:", miss,"/",N); }
```
Measured 2026-09-15: 11/3000, 5/3000 (lengths 33888/34496/21616), 0/3000, 44/3000.
