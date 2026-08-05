# BL-813 hardener review — clean pass, NONE

**Ticket:** BL-813 — handoffd death email must attach the written failure log
(the operator was off-box and could only see an on-disk path), and
`ambulance_lib.bb::ticket-has-file?` must not crash on the glob-then-vanish
race that actually killed handoffd (a ticket promoted `active/` → `done/`
between `fs/glob` listing it and the slurp reading it).
**Reviewed commit:** 134f6bbc6a (architect, merge_and_process into hardener).
**Role:** hardener.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Tooling scope (engineering.prompt Startup Tools).** Diff touches only
   `.bb` (`daemon_alarm_lib.bb`, `handoffd_supervisor.bb`, `ambulance_lib.bb`),
   their `.bb`/`.sh` test fixtures, one pipeline step-handler `.js` file, and
   spec/backlog/evidence files — zero `extension/src` or `extension/media`
   TypeScript (confirmed via `git diff --stat 3236f454^ 134f6bbc6a`). Stryker/
   CRAP/jscpd are TS-only and do not apply; `.bb` mutation/CRAP/DRY tooling is
   not wired (documented gap, BL-472). Gate is the `.bb` unit-test suite plus
   a hand-authored surgical mutation sweep (BL-638 pattern), both below.

2. **Merge ancestry.** `git merge-base --is-ancestor 134f6bbc6a HEAD` holds
   after `git merge 134f6bbc6a` — clean merge, no conflicts, nothing reset.

3. **Host-load check.** `uptime` showed load avg ~185-196 on 4 cores at
   session start — a Stryker-timeout-class condition per the load-bypass
   rule, but this ticket has zero TS/Stryker surface. Every `.bb`/subprocess
   run below is lightweight (sub-30s each, one full-suite run at ~80s) and
   ran anyway with no timeouts or hangs.

4. **Independent re-run of every test the coder/architect listed, all green:**
   - `test_daemon_alarm_lib.sh` — ALL PASS (incl. `BL-813 attach-01`)
   - `ambulance_lib_test_runner.bb` — ALL PASS
   - `test_ambulance_cli.sh` — ALL PASS (pre-existing unrelated `tmp_cleanup.sh`
     unbound-variable warning after completion, confirmed pre-existing to
     BL-459 per architect's evidence, untouched by this parcel)
   - `bl813_daemon_alarm_lib_property_runner.bb` — 500/500, ALL PROPERTIES HOLD
   - `bl813_ambulance_vanish_safety_property_runner.bb` — 500/500, ALL
     PROPERTIES HOLD
   - `bl813_supervisor_alarm_attachment_wiring_test.bb` — ALL PASS
   - `test_handoffd_supervisor.sh` — full regression suite, ALL PASS (incl.
     `04: no silent auto-restart remains`)
   - Acceptance (`run_acceptance.sh` on the BL-813 feature) — 3/3 scenarios
     pass, driving the real `.bb` libraries via the step handlers

5. **Gherkin mutation (BL-113/BL-638).** The feature has 3 plain `Scenario:`
   blocks, no `Scenario Outline:`/`Examples:` anywhere — ran
   `run_gherkin_mutation.sh` anyway per BL-638: reported `outcome:
   "inapplicable"` (0 mutants), a real tool run, not a skip. Manifest stamp
   committed in the feature file. Per BL-638, an inapplicable Gherkin-mutation
   run is not a substitute for hardening — see the hand-authored surgical
   mutation sweep below, which covers exactly this parcel's own behavior
   change.

6. **Hand-authored surgical mutation sweep (BL-638 pattern — no `.bb`
   mutation tool wired), independently re-broken and re-verified by this
   role, not merely re-read from the coder's own header-comment claims:**
   - **Mutant A** — `daemon_alarm_lib.bb`'s `alarm-and-halt!`: reverted
     `(send-email! subject text attachments)` to `(send-email! subject text
     nil)` (the exact pre-fix call shape). Killed by
     `bl813_daemon_alarm_lib_property_runner.bb` (P1 failed on the very
     first generated cases — "expected attachments to be a seq, got nil")
     and by `test_daemon_alarm_lib.sh` (hard Python traceback in the
     attach-01 assertion). Reverted; both suites re-confirmed green after
     restore.
   - **Mutant B** — `ambulance_lib.bb`'s `ticket-has-file?`: removed the
     per-candidate `try/catch`, restoring the pre-fix unguarded
     `(some #(= ticket-id ...) (fs/glob ...))`. Killed by
     `bl813_ambulance_vanish_safety_property_runner.bb` (P1 threw
     `FileNotFoundException` — the exact live-incident crash, reproduced on
     demand) and by `ambulance_lib_test_runner.bb` (hard crash with a
     matching stack trace). Reverted; both suites re-confirmed green after
     restore.
   - **Mutant C** — `handoffd_supervisor.bb`'s `send-configured-alarm-email!`:
     changed the forwarded `attachments` arg to a hardcoded `nil` (the
     "mentions the file path but silently drops attachments" defect the
     ticket names). Killed by `bl813_supervisor_alarm_attachment_wiring_test.bb`
     ("expected: [...] actual: nil"). Reverted; suite re-confirmed green
     after restore.
   - All three restores confirmed byte-identical via `git diff --stat`
     showing no residual diff on the three production files before moving
     on.

7. **Required wiring (all 3 ticket YAML items) — re-confirmed live, not just
   read.** Same three call sites the mutation sweep above exercises are
   exactly the three `required_wiring` entries in BL-813's ticket YAML;
   killing a mutant at each site is direct proof the wiring is load-bearing,
   not merely present.

8. **No orphaned processes.** `pgrep -fl 'node --test|stryker|bb .*bl813|bb
   .*ambulance|bb .*daemon_alarm'` clean before and after this pass; every
   run above (including the three broken-then-restored runs) terminated on
   its own.

9. **Out-of-scope compliance.** No `extension/`, webview, or upstream
   SwarmForge source touched. This pass's own diff is limited to the
   `run_gherkin_mutation.sh`-stamped manifest header in the feature file
   (tool-written, not hand-edited) plus this evidence file.

## Disposition

No hardening changes needed to the production `.bb` files — the coder's
property tests (BL-654, all 3 declared invariants) plus the deterministic
unit/wiring suites already catch every single-edit regression at all 3
required-wiring sites, independently re-verified by breaking and restoring
each site in this pass. Forwarding to documenter.
