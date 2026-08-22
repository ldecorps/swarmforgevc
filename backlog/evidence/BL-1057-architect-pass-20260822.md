# BL-1057 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `12ccabe785` (cleaner, straight merge with no changes of its
own on top of coder `6f4c92ef87`) into the architect worktree. Merged first
(`git merge --no-ff 12ccabe785`), then read the ticket and coder evidence.

## Scope

New: `swarmforge/scripts/host_switchover_doctor.bb` (CLI, thin wrapper),
`swarmforge/scripts/host_switchover_doctor_lib.bb` (all decisions),
`swarmforge/scripts/test/host_switchover_doctor_lib_test_runner.bb`,
`swarmforge/scripts/test/bl1057_host_switchover_doctor_property_runner.bb`,
`specs/pipeline/steps/bl1057HostSwitchoverDoctorSteps.js` (+ registration in
`specs/pipeline/steps/index.js`), `docs/how-to/BL-1057-host-switchover-doctor.md`
(+ link in `docs/index.md`). Zero `extension/` files touched — this ticket's
approved form is a standalone Babashka script (see ticket `approval_context`),
so the extension host/webview boundary rules are not in play for this parcel.

## Architecture

- **Read-only by construction.** The lib's only IO seams are `exists?*`,
  `read-file*`, `list-dir*` — three reads, no write seam exists to inject.
  Confirmed by reading the whole file: nothing in `run-doctor`/`verdict-for`
  calls `spit` or any mutating `babashka.fs` function. Matches invariant 1
  ("the doctor never writes... a durable property, not a slice boundary").
- **Integrate-not-fork / maintained-fork boundary**: this adds a checker to
  `swarmforge/scripts/` following the existing `*_lib.bb` + thin CLI +
  `test/*_lib_test_runner.bb` shape (`babysitter_check.bb`,
  `master_checkout_drift_lib.bb`) — the same pattern this swarm's own
  development already uses throughout `swarmforge/`. Not a copy or
  modification of upstream `unclebob/swarm-forge` source; it is new tooling
  in this project's own maintained fork. No `./swarm doctor` subcommand was
  added (ticket `approval_context` explicitly rules that out for later).
- **CLI is a thin wrapper**: `host_switchover_doctor.bb`'s `-main` is
  argument parsing, env/`$HOME` reads via `System/getenv`, and print/exit only
  — every verdict, every path resolution, and the report text live in the
  lib. Confirmed by reading both files side by side.
- **`$HOME`-rooted paths are env-seamed**: `SWARMFORGE_TUNNEL_REGISTRY_DIR`
  and `SWARMFORGE_CLOUDFLARED_DIR`, following the `tunnel_ownership_lib.sh`
  precedent the ticket names; `context` takes `:env` as an injected plain map,
  never reads the process env itself — only the CLI wrapper does.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

This parcel touches no file under `extension/`, so there is nothing of this
parcel's for the gate to check. Ran it two ways to confirm:

- Full-repo scan (no args): reports the same pre-existing
  `telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
  `telegramCursorOperatorLiveness.ts` `acyclic` cycle every recent architect
  pass has reported (BL-1066, BL-1058, BL-1036). Already tracked as **BL-759**
  (paused) — re-verified against the ticket file itself before relying on
  memory, per [[architect-grep-exact-filenames-before-worth-a-ticket-note]].
  None of this parcel's files.
- Scoped run against the two changed `.js` files: the tool errors immediately
  (`Can't open '...' for reading`) because `depcruise` runs with `extension/`
  as its working root and these paths live outside it — confirms the ruleset
  has no surface area over this parcel at all, not merely "zero violations".

## Co-change (`node extension/out/tools/co-change-report.js`)

The four new `host_switchover_doctor*`/`bl1057*` files co-change only with
each other, the ticket's own evidence file, and its own docs entry — exactly
the expected shape for a brand-new, self-contained feature. `specs/pipeline/steps/index.js`
shows dozens of "SUSPECTED COUPLING" entries at high frequency, but that is
the shared step-registry file every feature's step-handler registration
touches (same pattern noted in BL-1066's and earlier passes) — structural,
not a hidden coupling introduced by this ticket. Nothing flagged needs
action.

## Invariants review (BL-633/BL-654) — 3 declared, all encoded, non-vacuous

All three checked as a **distinct pass**, not folded into the correctness
read:

1. **The doctor never writes.** `bl1057_host_switchover_doctor_property_runner.bb`
   fingerprints a real temp filesystem (path, dir/file marker, size, mtime,
   content hash) before and after every one of 60 generated runs and asserts
   equality. I independently re-ran the doctor live against this actual host
   (`bb swarmforge/scripts/host_switchover_doctor.bb`, twice, once with a
   nonexistent injected root) and confirmed `git status --porcelain` carried
   no new change either time (only the pre-existing untracked BL-724 stray
   file, unrelated).
2. **Every declared check appears exactly once, exactly one verdict; BLOCKED
   never omitted/assumed OK.** `run-doctor` maps 1:1 over the inventory
   (report length == inventory length by construction), `worst` collapses a
   multi-key settings row to one verdict via a severity order that puts
   `:blocked` highest specifically so it can never be masked by a cleaner
   sibling verdict. The property runner asserts set-equality of ids, no
   duplicates, and every verdict drawn from the declared set, over a
   generator whose four-way per-location state set (`:healthy :absent :stale
   :unreadable`) is explicit specifically so BLOCKED is reached as often as
   the others (a naive existence-only draw would essentially never produce
   it) — reach floors asserted (`>= 10` for stale/missing/blocked, `>= 20` for
   ok) and met on my own re-run: `{:ok 221 :blocked 81 :missing 89 :stale 29}`.
3. **A non-OK finding names both the location and the fix.** Every inventory
   row carries `:remediation` as data; `verdict-for` always resolves a
   concrete `:path` (falling back to the row's own `:id` when no path was
   gathered, so "no path resolved yet" can never read as blank). Property
   runner asserts both are non-blank for every non-OK finding, and that the
   rendered report text actually contains the remediation string (not just
   the in-memory struct).

**Non-vacuity**: the coder's evidence documents five targeted breaks (one per
invariant-relevant code path: `verdict-for` returning `:ok` on a failed read,
`run-doctor` filtering `:ok` out, `describes-root?` dropping its `/`
separator, a finding missing `:remediation`, a `slurp`-then-`spit` read seam)
applied to the lib, run, and reverted, each catching in the expected
invariant. I did not re-apply the breaks myself (the runner's assertions and
generator-reach floors are exactly what would have to fail, and I traced each
assertion back to the invariant it encodes rather than taking the claim on
faith) — re-ran the property suite clean (below) and the reach counts match
the coder's own recorded run exactly, which is itself evidence the generator
is deterministic and the claim reproducible, not cherry-picked.

The generator's oracle (`expected-verdict`, derived from exactly how
`build-host!` materializes each drawn state) is what makes invariant 2's
"BLOCKED never assumed OK" bite rather than just check shape — I traced
`describes-root?`'s `/`-separator role through `stale-root`'s two
near-miss transforms (`<root>-old`, and the actual old Mac path this swarm
moved off) and confirm a prefix-only comparison with the separator dropped
would indeed pass every *structural* assertion while failing only the
oracle check — matching the coder's own documented "one reach gap found and
closed" note.

No invariant violation found. No missing or vacuous property test.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

`host_switchover_doctor_lib.bb` is the only pure/testable module this parcel
touches, and its interesting properties are exactly the three declared
invariants above — round-trip/idempotence is not a natural shape here (the
command is a one-shot inspection, not a transform with an inverse), and
`extract-setting`/`matches-pattern?`/`normalize-root`/`describes-root?` are
each already exercised directly by the unit runner's example-based cases
(JSONC comments, trailing commas, commented-out settings, the `-old` sibling
near-miss, `/` vs no-`/` prefix). Nothing undercovered. Nothing added.

## Correctness read-through

Read `verdict-for`, `settings-verdict`, `absent-verdict`, `resolve-path`,
`context`, and `main-checkout-root` end to end. Confirmed:

- `main-checkout-root`'s worktree resolution is correct and live-tested: run
  from this very `.worktrees/architect` checkout with no `<repo-root>` arg,
  the doctor reported `repo root: /home/carillon/swarmforgevc` (the main
  checkout), not this worktree's own path — a naive implementation would
  report every role worktree's own two settings files as false STALE.
- `describes-root?`'s prefix check is separator-guarded
  (`str/starts-with? value (str root "/")`), so a sibling checkout at
  `<root>-old` cannot read as living inside `<root>` — verified by reading
  the regex/string logic directly, and it is exactly what the property
  generator's near-miss stale roots exercise.
- `:present-any`'s BLOCKED path (directory unlistable) vs its MISSING path
  (directory listable, no matching entry) are correctly distinguished by
  `(:ok? entries)`, not conflated.
- One minor, non-blocking observation: if a `:present-any` row's directory
  path were somehow a regular file rather than a directory, `list-dir*`
  would throw and the row would report BLOCKED with message "the directory
  could not be listed" — technically imprecise (it's not a directory at
  all) but still the correct verdict (unreadable-as-declared, non-OK,
  actionable), and not a state any of this ticket's real inventory rows can
  reach on their own (the base dirs are always created before this check
  runs). Not bounce-worthy; noting only in case a future inventory row adds
  a `:present-any` check on a location that could plausibly be a file.

## Verification re-run live (not trusted from the commit message)

- `bb swarmforge/scripts/test/host_switchover_doctor_lib_test_runner.bb` →
  **ALL TESTS PASSED**.
- `bb swarmforge/scripts/test/bl1057_host_switchover_doctor_property_runner.bb`
  → **ALL 60 RUNS PASSED**, reach counts
  `{:ok 221 :blocked 81 :missing 89 :oracle-ok 221 :oracle-blocked 81
  :oracle-missing 89 :stale 29 :oracle-stale 29}` — matches the coder's
  recorded run exactly.
- `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature →
  **11/11**.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature → parses cleanly.
- `required_wiring` (`bl1057HostSwitchoverDoctorSteps` registered in
  `specs/pipeline/steps/index.js`) → confirmed present.
- Live host re-run (`bb swarmforge/scripts/host_switchover_doctor.bb`, no
  args): all 7 locations OK, exit 0 — matches the coder's note that
  `qa_e2e` steps 2/3 (expecting the tunnel MISSING/exit-1 state) have
  drifted because the live Error 1033 casualty was hand-repaired between
  ticket-authoring and this parcel; that MISSING/exit-1 behavior is instead
  covered by the acceptance scenarios and the property runner's generated
  `:absent` states, which I independently confirmed produce the documented
  verdicts.
- Live STALE re-check with an injected non-existent root: the tunnel
  registry row correctly flips to STALE quoting the real root it found
  (`~/.swarmforge/tunnels/operator-root` names
  `/home/carillon/swarmforgevc`), confirming `describes-root?`/root-text
  comparison against a live filesystem, not only fixtures.
- Babashka lane, per engineering.prompt's Startup Tools: no mutation/CRAP/DRY
  tooling wired for this lane. The two runners above plus the acceptance
  lane are its gate. No mutation/CRAP/DRY result is claimed — none was run,
  matching the coder's own recorded tooling-fallback note.

## Verdict

**NONE.** No architecture violation, no invariant gap or vacuous property
test, no correctness defect in the parcel. Forwarding to hardener.

— By architect.
