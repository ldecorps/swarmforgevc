# Triage — coder note "Unowned red: telegramFrontDeskBotCli.property BL-1203 inv1 blocks commits"

**Received:** `50_20260830T044645Z_001485_from_coder_to_specifier_for_specifier.handoff`
**Disposition:** the red is **not unowned and not a BL-1203 defect**. Root cause found,
reproduced deterministically end to end, and minted as BL-1294 against the shared
fixture-closure builder. The coder's parcel is the trigger, not the defect.

## The reported file is GREEN on main — solo and under the full lane

| # | Condition | Runs | Result |
|---|---|---|---|
| 1 | whole file, solo (loadavg 5.9) | 1 | green, 18.2s |
| 2 | `-t "invariant 1"`, solo | 3 | green, 7.1–7.7s |
| 3 | **full `npm run test:properties`** (279 files, `pool: forks`) | 1 | **green, 21.0s** |

Condition 3 is the guard's own condition, so this is not a weak reproduction: on
`main` the file is not red, and it is not among the 28 files that ARE red in that run.

## The red is real — on the coder's branch, deterministically

`swarmforge-coder` adds `swarmforge/scripts/unregistered_test_gate_lib.bb` (BL-1240)
and reaches it from `swarm_handoff.bb` via a new `load-file`. Line 42 of that new lib:

    (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "test" "suite_inventory_lib.bb")))

It load-files **into a subdirectory**. `extension/test/helpers/pinnedRepoFixture.js`
cannot express that. `loadFileDeps` keeps only quoted strings ending in `.bb` and
reduces each to `path.basename(...)`, so the `"test"` segment is discarded and the
dependency is recorded as the bare name `suite_inventory_lib.bb`. `copyScriptClosure`
then looks for that name at the flat root, does not find it, and **silently skips it**:

    if (!fs.existsSync(src)) {
      if (entrypoints.includes(name)) throw ...
      continue;   // a dependency named but absent - the closure records it, the copy skips it
    }

### Measured, closure computed from the coder branch's own scripts

    closure size: 50
    NAMED BUT ABSENT (silently skipped by copyScriptClosure): [ 'suite_inventory_lib.bb' ]

### Measured, the runtime consequence, in a fixture built by the real helper

Closure copied by `copyScriptClosure` into a scratch tree (49 of 50 files;
`suite_inventory_lib.bb` absent), then a plain note draft handed to it:

    ----- Error ------------------------------------------------------------
    Type:     java.io.FileNotFoundException
    Message:  .../fixture/swarmforge/scripts/test/suite_inventory_lib.bb (No such file or directory)
    Location: .../fixture/swarmforge/scripts/unregistered_test_gate_lib.bb:42:1

`bb swarm_handoff.bb` therefore exits non-zero for **every** call.
`enqueueRoleAnswerNote` catches that, writes one stderr line, and returns `false`;
no outbox file is written. BL-1203 invariant 1 asserts
`outboxFileCount(root) === distinctUpdateIds.size` and so reports a **dedup**
violation. Nothing about dedup failed. The chain is complete and load-independent.

## Hypotheses tested and DISPROVED — recorded so nobody re-walks them

**H1 — "the dedup history is too short, so a replay falls out of the window."**
`ROLE_ANSWER_SEEN_UPDATE_IDS_LIMIT` is **100**; the property generates at most 4 calls
over updateIds 1–4. The window cannot overflow. This was the BL-1062 seed-lottery
shape and it is not this. Disproved.

**H2 — "the fixture's `roles.tsv` names the REAL live tmux sessions
(`swarmforge-specifier`, `swarmforge-coordinator`), so `swarm_handoff.bb` takes the
tmux path and never writes the outbox."** The sessions really are live on this host
under those exact names, and `process.env` (including `TMUX`) is passed through to the
spawn. But all 5 runs above were green **while the swarm was up**, so the socket-path
scoping holds and the outbox fallback is taken. Disproved.

**H3 — "the closure resolver is already incomplete on main."** Same six entry points
against main's scripts: `closure size: 48 missing: []`. Nothing is silently skipped
today, so failing loud (scenario 02) breaks no existing fixture. Disproved — and this
is what makes the fix safe to land.

## Ownership — why this is not the coder's defect, and not BL-1203's

The subdirectory `load-file` is a legitimate script layout, and the pattern already
exists on main (four sites under `swarmforge/scripts/test/` reaching back up into
`swarmforge/scripts/`). Those sites are runners, never fixture entry points, so none
of them had ever been pulled through the resolver. The coder's lib is simply the
**first production script in a fixture closure** to cross a directory boundary. The
trap was latent; BL-1240 walked into it.

Blast radius: 11 test files call `copyLiveScriptClosureInto`; two of them
(`telegramFrontDeskBotCli.property.test.js`, `telegramFrontDeskBotCli.test.js`) put
`swarm_handoff.bb` in their closure, so both break the moment BL-1240 lands.

## NOT ticketed — checked and deliberately left alone

**The swallowed spawn failure is correct, not a defect.**
`enqueueRoleAnswerNote` returns `false` on a failed spawn, and
`telegramFrontDeskBotCore.ts:2011` consumes it: `const queued = await
enqueueRoleAnswerNote?.(...)`, and `confirmRoleAnswerDelivery` runs only `if (queued)`.
A failed spawn therefore leaves the pending marker in place — a human's answer is
never silently confirmed away. No production defect; no ticket.

What the swallow *does* cost is diagnosis: it converts an infrastructure failure into
a false accusation against BL-1203's dedup invariant, which is why this arrived as
"BL-1203 inv1 is red" rather than "the fixture is missing a script". Once BL-1294's
scenario 02 fails the build loudly and by name, that misdirection cannot recur, so
this is recorded as an observation in BL-1294's `notes:` rather than folded into its
scope — different file, different mechanism (BL-1061's 1:4 split principle).

## IR-DRY review of the new feature file

Four `possible-synonym` findings, all medium confidence, all reviewed and none acted
on: three pairs are one step pattern differing only in its quoted argument (the
handler is shared), and `has a file at` / `has no file at` are deliberate opposites.
The checker's own guidance is to normalize only accidental drift; none of this is.
