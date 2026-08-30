# BL-1240 — architect bounce, 2026-08-30

Full inventory (Article 4.4) — one item, everything else checked and clean.

## D1 — `loadFileDeps`/`resolveDepPath` mishandle the `repo-root "swarmforge"
"scripts" "name.bb"` load-file idiom, silently reintroducing the exact
failure class this rework fixes, for three files not covered by the coder's
own blast-radius sweep

1. **Repro, direct**, isolated from any test file:

   ```
   cd extension && node -e '
   const { copyScriptClosure } = require("./test/helpers/pinnedRepoFixture.js");
   const fs = require("fs"); const os = require("os"); const path = require("path");
   const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bl1240-repro-"));
   const live = path.join(__dirname, "..", "swarmforge", "scripts");
   const copied = copyScriptClosure(live, path.join(tmp, "scripts"),
     ["test/cursor_seat_guard_lib_test_runner.bb"]);
   console.log("copied:", copied);
   console.log("cursor_seat_guard_lib.bb present?",
     fs.existsSync(path.join(tmp, "scripts", "cursor_seat_guard_lib.bb")));
   '
   ```

   Output: `copied: [ 'test/cursor_seat_guard_lib_test_runner.bb' ]` — the
   dependency the entry point load-files is silently absent from the closure.
   Running the fixture-built entry point against a real `bb` reproduces the
   exact FileNotFoundException shape QA's own D1 bounce described:

   ```
   Type:     java.io.FileNotFoundException
   Message:  /tmp/swarmforge/scripts/cursor_seat_guard_lib.bb (No such file or directory)
   Location: <fixture>/scripts/test/cursor_seat_guard_lib_test_runner.bb:14:1
   14: (load-file (str (fs/path repo-root "swarmforge" "scripts" "cursor_seat_guard_lib.bb")))
   ```

2. **Commit checked**: `b82a1e856a` (`BL-1240: the fixture script closure
   preserves a dependency's subdirectory`), this ticket's own rework, merged
   to my worktree tip at `1608fd62b`.

3. **Failure class**: `unit`/`correctness` — a bug in the same pure function
   this parcel introduces to fix a different instance of the same failure
   class.

4. **Expected vs observed**: expected `loadFileDeps` to resolve
   `(load-file (str (fs/path repo-root "swarmforge" "scripts" "X.bb")))` —
   present verbatim in
   `swarmforge/scripts/test/bl1081_acp_snapshot_agreement_test_runner.bb`
   (twice: `acp_session_lib.bb`, `prompt_engine_lib.bb`),
   `swarmforge/scripts/test/cursor_seat_guard_lib_test_runner.bb`
   (`cursor_seat_guard_lib.bb`), and
   `swarmforge/scripts/test/bl1088_giveup_cooldown_property_runner.bb`
   (`front_desk_supervisor_lib.bb`) — to the flat scripts-root file it
   actually names (`repo-root` + `swarmforge/scripts/` together resolve to
   the SAME scripts root `copyScriptClosure` already treats as its base, so
   the intended dependency is `X.bb` at the root, exactly as the old flat
   `path.basename` behaviour got right by accident). Observed:
   `loadFileDeps` treats the two literal segments `"swarmforge"` and
   `"scripts"` as if they were a subdirectory PATH RELATIVE TO THE REFERRING
   FILE (the same rule that correctly handles `(fs/parent ...) "test"
   "name.bb"`), producing the dep name `swarmforge/scripts/X.bb`;
   `resolveDepPath` then joins that against the referrer's own directory
   (`test/`), producing `test/swarmforge/scripts/X.bb` — a path that exists
   nowhere in the live tree, so `copyScriptClosure`'s existing "a dependency
   named but absent — the closure records it, the copy skips it" path
   silently drops it. This is not a hypothetical: reproduced end-to-end above
   against the real `bb` binary and the real repo tree.

## What I checked and did NOT find a problem in

- Dependency-rule gate (BL-259, hard gate), full-repo scan: PASSED, no
  forbidden edges.
- Co-change tool (BL-255) against `pinnedRepoFixture.js` and its new test
  file: all flagged co-changes are the module's known, expected fan-out (the
  BL-1038 commit and its many existing consumers) — no new coupling.
- BL-1240's own acceptance (`run_acceptance.sh` on its feature file): 4/4.
- `unregistered_test_gate_lib_test_runner.bb`: ALL PASS.
- The exact regression QA bounced on: re-ran
  `test/telegramFrontDeskBotCli.test.js` (271 pass) and
  `test/pinnedRepoFixture.test.js` (12 pass) myself — genuinely fixed for
  that shape.
- The four `.bb` tests the coder wrote for `pinnedRepoFixture.test.js`: read
  them; each is a real TDD case (subdirectory-preserving, `..`-relative,
  copy reconstruction, and the real `swarm_handoff.bb` closure). None of the
  four exercises the `repo-root "swarmforge" "scripts"` idiom, which is why
  this parcel's own tests did not catch D1.
- The coder's evidence file states: *"Blast radius checked directly:
  `"test" "suite_inventory_lib.bb"` is the ONLY multi-segment `load-file`
  target anywhere in `swarmforge/scripts/*.bb`."* That check missed the
  four `repo-root "swarmforge" "scripts" "X.bb"` targets — confirmed myself
  by running `loadFileDeps` over every `.bb` file in the tree and printing
  every multi-segment result; the sweep's premise (single-segment
  `path.basename` match) did not generalize to the two-literal-segment case.

## Remediation pointer

Whoever fixes this: `resolveDepPath` (or `loadFileDeps`) needs to recognise
that segments matching the scripts root's own path components
(`"swarmforge"`, `"scripts"`) mean "resolve from the scripts root", not
"resolve relative to the referring file's directory" — the two idioms
(`(fs/parent ...) "subdir" "name.bb"` vs. `repo-root "swarmforge" "scripts"
"name.bb"`) are semantically different anchors that happen to look
syntactically identical to a segments-before-the-filename heuristic. A
targeted fix: when the leading segments of a candidate dep are exactly
`["swarmforge", "scripts", ...]`, strip that prefix and resolve from the
scripts root (same as `dir === '.'`) rather than from the referrer's
directory. Add a fifth TDD case driving the real closure of
`test/cursor_seat_guard_lib_test_runner.bb` (or either of the other two)
before declaring the blast radius closed — the existing "real
`swarm_handoff.bb` closure" test proves the pattern works, it does not prove
every idiom in the tree is covered.

Owning role: **coder** (BL-1240's own producing role; this is the direct,
mechanical consequence of the same fix this bounce is reviewing). Do not
weaken or delete the four idiom-specific test cases already added — add a
fifth, do not replace.

By architect.
