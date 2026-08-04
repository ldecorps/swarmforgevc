# BL-536-provider-auth-error-auto-respawn — QA bounce evidence (2026-08-05)

## Inventory

### D1 — Architect design-review pass is missing entirely

- **Class:** behavior (absence-of-stage-output; per BL-575 precedent, "behavior" is
  the honest class for a missing stage pass — never `compile`).
- **Blamed role:** architect (earliest role whose deliverable is absent).
- **Commit checked:** `43c3111916` (documenter's forwarded commit, merged into
  QA at `d80a0955`).
- **Evidence:** Full ancestry path from the coder's commit to the documenter's
  commit contains no architect-authored or architect-merge commit:

  ```
  git log --oneline --ancestry-path 1ad84a21..43c3111916
  43c31119 BL-536: document provider auth-error auto-respawn
  12ec1b62 Merge commit 'da83fb6ab1' into swarmforge-cleaner
  da83fb6a BL-536: wire auth-class pane observe/respawn into handoffd's chase sweep
  ```

  `git log --all --oneline --grep="BL-536" -i` returns zero commits mentioning
  BL-536 from the architect stage. Compare to Article 4.1 gate 2 ("Architect –
  Design review passed") — never certified for this ticket.
- **Remediation pointer:** architect reviews the coder's diff (`da83fb6a`,
  `swarmforge/scripts/handoffd.bb` chase-sweep wiring +
  `swarmforge/scripts/provider_auth_observe_lib.bb` /
  `provider_respawn_env_lib.bb`) for design/security/pattern soundness, then
  forwards to **hardener** (not documenter — hardener's own pass is also
  missing, see D2).

### D2 — Hardener pass is missing entirely

- **Class:** behavior (absence-of-stage-output).
- **Blamed role:** hardener.
- **Evidence:** Same ancestry path — no hardener-authored or hardener-merge
  commit anywhere between coder's `da83fb6a` and documenter's `43c3111916`.
  Article 4.1 gate 3 ("Hardener – 100% test coverage, no surviving mutants,
  CRAP <= 6") never certified.
- **Mitigating context (not a waiver):** the `.bb` code this ticket touches
  already has real unit coverage
  (`provider_auth_observe_lib_test_runner.bb` — PASS),
  property coverage of both declared invariants
  (`provider_auth_observe_lib_property_runner.bb` — 500 runs/property, ALL
  PROPERTIES HOLD), and a live-wiring smoke test
  (`test_handoffd_auth_observe_wiring.sh` — 3/3 PASS, proves
  `observe-standing-role-auth!` is actually reached from `chase-sweep!` and
  issues a real `respawn-pane` with real provider-compat env args). Per
  `engineering.prompt`, Babashka mutation/CRAP/DRY tooling is not wired
  (BL-472, deliberately deferred), so the hardener's actual gate for `.bb`
  code today is the unit-test-gap fallback — and by that measure the content
  looks sound. That does not substitute for the hardener's own pass and
  certification actually happening; the gate is a role action, not an
  incidental outcome.
- **Remediation pointer:** hardener runs its normal `.bb` unit-test-gap pass
  over `provider_auth_observe_lib.bb` / `provider_respawn_env_lib.bb` /
  the `handoffd.bb` diff, confirms/extends coverage, then forwards to
  documenter (documenter's existing doc,
  `docs/how-to/BL-536-provider-auth-error-auto-respawn.md`, already reads as
  accurate and can very likely be forwarded unchanged once hardener has
  merged up — re-verify only if hardener's pass changes behavior).

## Checks run and their results (for completeness — not blocking, recorded per
Article 4.4 "run-or-blocked, never assumed-clean")

- Unit test runner (`provider_auth_observe_lib_test_runner.bb`): PASS.
- Property runner (`provider_auth_observe_lib_property_runner.bb`): PASS, 500
  runs/property, both declared invariants covered non-vacuously.
- Wiring smoke test (`test_handoffd_auth_observe_wiring.sh`): PASS, 3/3.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-536-provider-auth-error-auto-respawn.feature`): PASS, 3/3
  scenarios.
- `required_wiring` claim (`handoffd.bb::provider-auth`): verified live —
  `observe-standing-role-auth!` is called from `chase-sweep!` at line 1494.
- Full extension unit suite (`npm test`): 7 files / 11 tests failed on first
  run; re-run of just those 7 files in isolation reproduced 5 files / 7 tests
  still failing with `Test timed out in 20000ms` / empty-stdout subprocess
  assertions, plus a `[vitest-worker]: Timeout calling "onTaskUpdate"`
  unhandled error. Host load average at time of run: **254 (1-min), 4 CPUs**
  — sustained severe overload, same class of environment issue as the
  documented Stryker-dry-run-timeout-under-severe-load precedent. None of
  the failing files (`backfillTopicIconsCli`, `briefingDigestLineCli`,
  `dependencyGateCliReportsAndScope`, `dependencyGateCliStorageGlobals`,
  `mermaidRender`, `renderBriefingDiagramsCli`, `startBridgeHeadlessCli`)
  touch any file BL-536's diff changed. Treated as environmental, not a
  BL-536 regression — not included as a bounce item. Flagged separately to
  specifier/coordinator (see note sent alongside this bounce) since sustained
  load this severe is in Article 3.5 circuit-breaker territory regardless of
  this ticket.
- Backlog file integrity: confirmed the merge did not regress QA's own prior
  BL-802 closure (`backlog/done/M8/BL-802-babysitterd-macos-portability.yaml`
  unchanged in content, only a rename already consistent with QA's own
  earlier commit `e4addafe`).

## Expected vs observed

Expected: parcel arrives at QA having passed all four Article 4.1 gates
(specifier, architect, hardener, QA). Observed: architect and hardener gates
were never exercised for this ticket — the ancestry jumps directly from
coder's commit to a no-op cleaner merge to documenter's commit.
