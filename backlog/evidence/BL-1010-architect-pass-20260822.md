# BL-1010 architect pass — 2026-08-22

**Parcel:** cleaner forward `5a2c2524c2` (coder's own commit — "BL-1010:
this swarm's own name comes from the identity file, so a secondary
publishes under its own name"), merged into architect at `2c20a54ce`.
Cleaner reviewed clean and forwarded as-is (no cleaner-added commit in the
range).

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect found
in the parcel's own changed code.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary rules:** applies this time — real
  `extension/src/` code changed. `holisticProjections.ts` is a projections
  module whose own pre-existing header already documents that some of its
  functions deliberately touch disk (`readSwarmName`/`parseSwarmName`
  predate this ticket); not `src/quality/` (the one directory the
  `no-io-from-policy` rule restricts), imports no `vscode`, and is already
  in the dependency-cruiser `pathNot` allowlist's spirit as a data-reading
  bridge module. No webview/media file touched; no secrets touched;
  extension host still owns all I/O.
- **Dependency-rule hard gate (BL-259):** `node extension/out/tools/dependency-gate.js
  src/bridge/holisticProjections.ts` → **PASSED: no forbidden edges.** The
  other six changed files are outside `extension/`'s import graph
  (`swarmforge/` Babashka, `specs/pipeline/steps/`), same as BL-1022 — not
  gated by this checker, nothing to report.
- **Co-change coupling (BL-255):** ran `node extension/out/tools/co-change-report.js`
  over all eight changed files. Every file's own suspected-coupling list is
  either another file in this same parcel or `specs/pipeline/steps/index.js`
  (a shared registration file that co-changes with nearly everything by
  construction — every acceptance-step addition touches it; not a real
  signal). No coupling to code outside the ticket's declared scope.
- **Declared invariant (1)** — "One resolution order everywhere ... identity
  file, then conf, then the shared default, no caller keeping a private
  order": encoded as P1 (order, generated with the conf name DERIVED from
  the identity name so disagreement is constructed rather than hoped for)
  and P3 (structural: reads the source of all three callers) in
  `bl1010SwarmNameResolution.property.test.js`. Independently verified
  non-vacuous by hand, not by trusting the commit message:
  - Swapped the resolver's fallback order (conf before identity) in a
    scratch-restored copy, compiled, re-ran live — **P1 and P2 both fail**
    (identity/conf-disagreement case published under the wrong name),
    matching the commit's claimed break row exactly. Restored
    (`diff` confirmed byte-identical) and re-confirmed 3/3 passing.
  - Added a private `readConfigValue(t, 'swarm_name')` call into
    `emit-fleet-status.ts` in a scratch-restored copy, compiled, re-ran
    live — **P3 fails naming the file**, P1/P2 stay green (the resolver
    itself is still correct; only the structural source-read check catches
    a caller that never calls it) — exactly the asymmetry the commit's own
    non-vacuity table describes and explains. Restored and re-confirmed
    clean.
- **Declared invariant (2)** — "No cross-name write ... no input, and no
  absent input, causes a write under any other swarm's name": encoded as P2,
  which enumerates the rendezvous directory rather than asserting the
  expected name exists (catches a clobber-alongside, not just a
  wrong-name-instead). Covered by the same P1/P2 break above (both invariant
  1 and invariant 2's properties fail together on that break, as expected
  since a wrong resolution order directly causes a wrong-name write).
- **Cross-language literal parity (the guardrail this ticket instances):**
  `bl1010SwarmNameResolution.test.js`'s scenario-03 test reads both
  `DEFAULT_SWARM_NAME` (TS) and `default-swarm-name` (Babashka,
  `swarm_identity_lib.bb:17`) from source and compares them — a real gate,
  not a "kept in sync" comment. Confirmed green live.
- **Format/path parity with the actual writer, checked by hand (not
  assumed):** `write_swarm_identity_file` in `swarmforge/scripts/swarmforge.sh`
  writes `swarm_name\t%s\n...` to `$STATE_DIR/swarm-identity` where
  `STATE_DIR="$WORKING_DIR/.swarmforge"` — byte-for-byte the same path
  (`.swarmforge/swarm-identity`) and tab-separated `key<TAB>value` format
  `readSwarmIdentityValue` parses in the TS code. `swarm_identity_lib.bb`'s
  `read-swarm-identity` reads the identical file/format. No mismatch.
- **One theoretical (not live) divergence found and judged non-blocking:**
  `readSwarmIdentityValue` explicitly treats an empty value as "not a name"
  and falls through to conf/default; `swarm_identity_lib.bb`'s
  `read-swarm-identity` would return the literal empty string for the same
  malformed line (`get` only falls back to the default when the KEY is
  absent, not when its value is empty). This is a real behavioral
  difference between the two languages, but `write_swarm_identity_file`
  always writes a real `$SWARM_NAME` (defaulted to `"primary"` at
  `swarmforge.sh:179`, never emptied) — no writer in this codebase can
  produce the malformed line either side would need to diverge on, and the
  TS side's behavior is the strictly safer one (never publish under `""`)
  if it ever did occur. Not a failure scenario reachable from real code;
  recorded here rather than silently passed over, not bounced.
- **`required_wiring` (BL-925), both checked directly:** `holisticProjections.ts`
  contains `swarm-identity` at a real `readFileSync` call (not a comment) —
  confirmed by reading the diff itself. `specs/pipeline/steps/index.js`
  registers `bl1010SecondarySwarmPublishesUnderItsOwnNameSteps` — confirmed
  by grep and by the live acceptance run below actually exercising it.
- **Verification re-run live** (not trusted from the commit message):
  - `npm run compile` (from `extension/`) → clean.
  - `npx vitest run test/bl1010SwarmNameResolution.test.js` → **7/7**.
  - `npx vitest run --config vitest.properties.config.mjs test/bl1010SwarmNameResolution.property.test.js`
    → **3/3**.
  - `npx vitest run test/tmpDirMigrationGuard.test.js` → **11/11** green,
    confirming the coder's claimed fix (both new unit-lane test files now
    allocate through the shared `mkTmpDir` helper) actually took.
  - `bb swarmforge/scripts/test/node_tool_bringup_lib_test_runner.bb` →
    `ALL PASS`.
  - `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` →
    still green with `node_tool_bringup_lib.bb` now inside the BL-1022
    closure (53 → 54 files: entrypoint 1, spawn-reached 1, offender set
    unchanged) — confirms the commit's own claim that this new lib is pure
    and does not reopen the subprocess-API ban.
  - `node specs/pipeline/cli.js specs/features/BL-1010-a-secondary-swarm-publishes-under-its-own-name.feature`
    → **7/7** (all scenarios, including the Outline's four rows).

## Scope note raised by the coder, answered

The commit asked the architect to weigh in: should the secondary bring-up
path (`swarmforge.sh`) get a hard compile precondition instead of (or in
addition to) the loud, actionable log message the daemon now emits on a
missing compiled tool? **Answer: no, the coder's reading is correct as
implemented, and matches the ticket's own acceptance contract, not just a
plausible interpretation.** `qa_e2e_procedure` step 5 — written by the
specifier as this ticket's authoritative acceptance check — asks for
exactly this: "attempt the publish and confirm the reported failure names
the compile step to run rather than a bare module-not-found path," with no
step asking for launch to be blocked. A hard launcher precondition would
also block launch on checkouts that never run the publisher at all, which
is a worse failure than the one being fixed. No follow-up ticket needed.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

`readSwarmIdentityValue` (parsing) and `node-tool-bringup-lib`'s
`missing-tool-message`/`names-bring-up-step?` (text generation/self-check)
are the new pure surfaces. Both are already covered by the declared-invariant
property tests (identity-file parsing, exercised across the generated
identity/conf combinations) and by direct example tests
(`node_tool_bringup_lib_test_runner.bb`'s message/gate pair, including the
defect-shape negative case). No further round-trip/idempotence candidate
found; nothing to add.

## What was NOT re-litigated

- The two pre-existing unit-lane failures the commit reports
  (`tmuxReaperGuard`, `tempDirTrapGuard`): confirmed both files
  (`specs/pipeline/steps/bl1018SingleRoleRepairNeverKillsServerSteps.js`,
  `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`)
  are absent from this parcel's changed-file list — not this parcel's
  defect, and the commit already routed a note rather than folding an
  unrelated fix in. Not re-run here (tmux-server-touching); nothing in this
  parcel's diff could have caused them.
- `parseSwarmName` remaining unused by `readSwarmName` in production code:
  pre-existing structure (unchanged by this diff — `readSwarmName` already
  called `readConfigValue` directly before BL-1010), not introduced or
  worsened here.

— By architect.
