# BL-685 hardener pass — 2026-08-19

## Reviewed commit
`9d4687cd21` ("BL-685: architect pass - required wiring confirmed
reachable, declared invariant property-tested with proven reachability,
forwarding to hardener"), merged into hardener as this parcel. No bounce.

## Scope, precisely
`git show --stat 7f3413a530` — 6 files: the new acceptance step handler
(`bl685StrandedResidentDetectionSteps.js`), `index.js`'s registry line,
`babysitter_check.bb` (the gatherer), `babysitterd_sweep_lib.bb` (the
pure check), and two new bb test/property runners.

## Tooling scope check
No `extension/src/*.ts` or `extension/test/` touched. Stryker/CRAP/DRY
inapplicable. All production logic is Babashka — gated by its own unit
runner + property runner + acceptance feature.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load hit **113 on 4 cores**
   (28x cores) — the most extreme this session has seen. All Babashka
   suites below are pure-logic, no daemon spawn, and ran in seconds
   regardless. The acceptance feature DOES spawn a real tmux fixture
   (scenario 04's fake coordinator pane); ran it via `run_in_background`
   + `Monitor` rather than a blocking foreground call to avoid this
   sandbox's ~120s cap under the load — completed in ~104s wall clock,
   9/9 pass, no stall.
2. **Independent re-run of both bb suites**:
   - `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`
     — ok (14 new BL-685 rows).
   - `bb swarmforge/scripts/test/bl685_resident_stranded_property_runner.bb`
     — ok, **2000 runs, 14 fire shapes reached**.
3. **Acceptance, independently re-run** (backgrounded given the load):
   `specs/features/BL-685-stranded-resident-detection.feature` —
   **9/9 PASS**, matching the architect's report exactly.
4. **Full independent read of both wiring halves** (own hardening
   judgment, beyond re-running suites — warranted given the ticket's own
   explicit warning that the obvious implementation is silently dead):
   - `check-resident-stranded` (`babysitterd_sweep_lib.bb:248-268`): read
     the full `and` chain directly. Every conjunct fails closed on nil
     (`resident-active-role-mtime-ms now-ms` in the chain means a
     missing mtime or clock short-circuits the whole predicate to nil,
     never a false-positive fire).
   - `babysitter_check.bb:584,613-623`: confirmed `:resident-active-role`
     is populated straight from `(active-role-marker)` — a genuinely
     separate top-level snapshot key, NOT derived from `(gather-rotate-note)`
     at line 603 (`:rotate-note`), which is exactly the trap the ticket's
     own "Wiring findings" section names (a check wired to
     `:rotate-note`'s `:active-role` would read nil on every real Class B
     occurrence and never fire — dead in production, green in every test
     built over fakes).
   - **Traced a subtlety beyond what either evidence file called out**:
     `:resident-pane-busy? (boolean (get busy-by-role resident-home))`
     reads busy-ness keyed by `resident-home` (the pane's own identity
     from `roles.tsv`), not by `resident-active-role` (the persona the
     resident is currently impersonating). Confirmed this is correct,
     not a mismatch: in a mono-router pack there is exactly ONE physical
     pane for the resident, registered under its home slot; there is no
     separate pane keyed under whatever role it is currently acting as,
     so `busy-by-role` could never be looked up by
     `resident-active-role` in the first place. `resident-mailbox-empty?`
     and `dispatch-note-pending?`, by contrast, correctly take
     `active-role` — mailboxes ARE per-persona, unlike panes.
   - Read `resident-mailbox-empty?`/`dispatch-note-pending?`
     (`babysitter_check.bb:499-524`): both use the nested-aware
     `{,**/}inbox/...` glob the commit message credits to the BL-807
     idiom (needed for the master-resident specifier's nested mailbox
     shape) — confirmed present in both functions, not just one.
5. **Required wiring**: `bl685StrandedResidentDetectionSteps` confirmed
   registered in `specs/pipeline/steps/index.js` (grepped directly).
6. **Out-of-scope / read-only discipline**: `grep -n 'send-keys\|tmux
   send'` across the parcel's own diff — zero hits outside the fixture
   setup itself (which starts a FAKE coordinator pane for the test, not
   a remediation action). Matches the ticket's read-only constraint and
   scenario 05.
7. **Leak/process check**: 0 leaked `bl685`-prefixed fixture dirs; no
   stray tmux servers after the acceptance run; `git status --short`
   clean.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. Both bb suites
and the acceptance feature (run safely under extreme host load via a
backgrounded + monitored invocation) reconfirmed green. Independently
traced both required_wiring halves through the actual code, including a
subtlety (pane-busy keyed by home role, not active role) neither prior
evidence file called out explicitly, and confirmed it is correct by
reasoning about mono-router pack topology rather than assuming it.

Forwarding to documenter.

By hardener.
