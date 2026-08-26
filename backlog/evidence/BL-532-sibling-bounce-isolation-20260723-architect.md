# BL-532 — architect review

**Verdict: PASS.** Forwarded to the hardener at the reviewed commit.

Reviewed commit: `c389f60e56` (cleaner) / `9847453ac0` (coder work).
Merged into `swarmforge-architect` before review; ancestry confirmed.

## Hard gate — dependency rules (BL-259)

```
node extension/out/tools/dependency-gate.js src/quality/siblingDeferral.ts \
  src/metrics/siblingDeferralStore.ts src/tools/qa-sibling-check.ts
  -> Dependency-rule gate PASSED: no forbidden edges.   (exit 0)

node extension/out/tools/dependency-gate.js        # full-repo sweep
  -> Dependency-rule gate PASSED: no forbidden edges.   (exit 0)
```

Note for future reviewers: the gate takes **extension-relative** paths. Passing
repo-relative paths (`extension/src/...`) makes depcruise print
`Can't open ... for reading` and the gate still exits 0 — a silent no-op scan.

## Layering

Dependency direction is inward and correct:

```
tools/qa-sibling-check.ts   (CLI, argv + exit codes)
        |                \
        v                 v
metrics/siblingDeferralStore.ts  ->  quality/siblingDeferral.ts   (pure, no I/O)
        (fs, atomicAppend)                    ^
                                              |
                                     quality/qaBounce.ts (class vocabulary)
```

- `quality/siblingDeferral.ts` imports no `fs`/`child_process`/`vscode` —
  `no-io-from-policy` holds, same posture as its sibling `qaBounce.ts`.
- The impure layer lives in `metrics/` for exactly the reason `qaBounceStore.ts`
  does; policy does not depend on it.
- No VS Code API, no webview, no browser storage, no process spawning, no
  secrets. The two-layer tile/tmux boundary is untouched by this parcel.
- Failure-class vocabulary is reused from `qaBounce.ts` — no second vocabulary,
  as specced.

## Security posture (specifier decision 2) — verified as built

The tool **never executes** a recorded blocker command. `runStatus` reads the
JSONL and `console.log`s the command for QA to paste. There is no `exec`/`spawn`
anywhere in the module set. This is the right call: any writer of the store
would otherwise be a command-injection vector into QA's worktree.

## Runtime wiring — NOT dark

`swarmforge/roles/QA.prompt` is present in the parcel and is the live call site
(QA's bounce ritual is agent-driven; there is no automated bouncer). Both edits
land in the correct branches: `status` before verifying, `defer` instead of a
bounce in the verification-FAILS branch, with an explicit "no evidence file, no
`record-qa-bounce.js`" instruction.

## Live CLI smoke (real subprocess, fixture repo — not in-process)

| case | result |
| --- | --- |
| `status` unknown ticket | `VERIFY BL-900`, exit **0** |
| `defer` | `{"recorded": true}`, exit 0 |
| `status` deferred | `DEFERRED BL-900 BLOCKED_BY BL-901 CHECK npm run compile`, exit **3** |
| `--class bogus` | usage, exit **2** |
| two blockers | both lines printed, exit 3 |
| clear one of two | only the remaining blocker printed, exit 3 |
| clear both | `VERIFY`, exit 0 |
| duplicate defer | `{"recorded": false}`, store unchanged |

`.swarmforge/qa_deferrals/2026-07.jsonl` created; `.swarmforge/qa_bounces/`
**never created** — the tally-isolation guarantee holds at runtime, not just in
the comments.

`process.exitCode = 3` survives `runCliMain` (it does not call `process.exit`
on the success path), confirmed in a real subprocess rather than by reading
`process.exitCode` in-process.

## Scope (BL-506)

Nine files, all BL-532: three `src` modules, three unit test files, the step
handler + its registration, and `QA.prompt`. No ticket-less functional files.

## Co-change (BL-255)

The new modules co-change only with each other and their own tests (1 each —
they are new). `QA.prompt`'s suspected coupling with `coordinator.prompt` (8),
`swarmforge.conf` (5) and the other role prompts is pre-existing governance
coupling, not introduced here; this parcel touches `QA.prompt` alone.

## Property testing (architect-owned phase)

`siblingDeferral.ts` is a pure module this parcel touched, with genuine
broad-range invariants. Added `extension/test/siblingDeferral.property.test.js`
(fast-check, 5 properties, `npm run test:properties` only — excluded from
unit/coverage/mutation per the separation rule; confirmed the unit run collects
3 files, not 4):

1. `normalizeCommand` idempotence + total whitespace erasure.
2. Signature equality ⟺ shared normal form under one class; distinct classes
   never collide (the `::` separator is safe over the closed class set).
3. A pair is open ⟺ its last event was a `defer`; open blockers come back
   sorted by blocker id, no duplicates. Checks the defer→clear→defer state
   machine over every interleaving, not one hand-written sequence.
4. Redundancy ⟺ natural-key equality with the pair's current state; an
   identical re-write is a no-op.
5. **The ticket's central guarantee**: with open blockers, a matching failure
   signature defers (naming only the matching blockers) and any other signature
   bounces.

Non-vacuity confirmed — each invariant was deliberately broken in the compiled
module and the corresponding property failed, then restored:

| mutant | result |
| --- | --- |
| `normalizeCommand` drops `.trim()` | 1 failed |
| `openBlockersForTicket` drops the sort | 1 failed |
| `decideDisposition` defers on ANY failure | 1 failed |
| `isRedundantSiblingDeferralWrite` always false | 1 failed |
| restored | 5 passed |

Full property suite green afterwards: 10 files, 32 tests.

## Findings for downstream (none blocking)

1. **`decideDisposition`'s `bounce` branch has no production caller.**
   Its only call site is `runStatus`, always with `null`. The narrow-suppression
   guarantee — the ticket's stated centre — is therefore enforced at runtime by
   `QA.prompt` prose, not by the tool; the code path exists only for tests and
   step handlers. This is spec-conformant (the specced CLI surface is exactly
   status/defer/clear, and specifier decision 1 keeps the decision with QA), so
   it is not a bounce. Recording it because it is the kind of half-wired
   mechanism the runtime-wiring-slice rule exists to catch: if a later ticket
   wants the guarantee machine-enforced, it needs a fourth subcommand that
   takes an observed failure. Property 5 above is currently the only thing
   pinning that branch.

2. **The natural key omits `check` and `commit`.** A same-day, same-class
   re-defer of the same pair carrying a *different* failing command is treated
   as redundant and dropped, and `status` keeps handing QA the *first* command:

   ```
   records:   defer BL-901/BL-902 class=integration check="npm run compile"
   candidate: defer BL-901/BL-902 class=integration check="npm run test:acceptance"
   -> isRedundantSiblingDeferralWrite === true   (write dropped)
   -> status still prints CHECK npm run compile
   ```

   Spec-conformant (the specced key is `(ticket, blocker, date, class)`,
   mirroring `qaBounceNaturalKey`), **visible** (`appendSiblingDeferralRecordIfNew`
   returns `recorded: false` and the CLI prints it), and it fails in the safe
   direction: the stale command either still fails, so the deferral rightly
   stands, or passes, so QA clears and verifies normally. It cannot suppress a
   bounce that should have happened. Not a defect — but the documenter should
   say what `recorded: false` means in the runbook, since a QA agent seeing it
   will otherwise assume the new command was stored.

3. **Ordering ties.** `latestRecordsByPair` sorts by `at` string and relies on
   `Array#sort` stability for ties; `readSiblingDeferralRecords` concatenates
   files in `readdirSync` order. Two events on one pair within the same
   millisecond would resolve by read order. Implausible for an agent-driven
   ritual; noted, not actioned.

4. **Step handler temp dirs.** `bl532SiblingBounceIsolationSteps.js` uses
   `os.tmpdir()` + `mkdtempSync` without cleanup. This matches the prevailing
   convention (172 of 294 step handlers do the same) rather than the swept
   `extension/test/helpers/tmpDir` used by the unit tests, so it is not a
   regression from this parcel — but it is one more site for whatever ticket
   eventually finishes the BL-420 sweep into `specs/pipeline/steps/`.
