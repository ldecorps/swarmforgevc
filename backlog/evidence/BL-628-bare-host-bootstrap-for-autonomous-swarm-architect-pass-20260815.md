# BL-628 architect pass — 2026-08-15

## Scope

Received from cleaner as `merge_and_process cleaner e9cef3c94b` (cleaner
forwarded the coder's commit unchanged — no cleanup needed). Reviewed commit
`e9cef3c94b` ("BL-628: bare-host bootstrap for an autonomous swarm", by
coder) fresh, from scratch, against Article 1.5 / architect.prompt's Review
Order. `required_stages: [coder, cleaner, architect, hardender, documenter,
qa]` — full chain, nothing skipped; the ticket's own note calls this pass a
"design constraint" review by construction (the split between the two
provisioners).

Files reviewed (`git show --stat e9cef3c94b`):
- `swarmforge/deploy/lib/host_bootstrap.sh` (new — shape-agnostic bootstrap library)
- `swarmforge/deploy/provision_autonomous_host.sh` (new — autonomous shape)
- `swarmforge/deploy/generate_autonomous_conf.sh` (new)
- `swarmforge/deploy/generate_systemd_units.sh` (1-line description text change only)
- `swarmforge/packs/autonomous-swarm.conf` (new template, full 7-window pack)
- `extension/test/bl628AutonomousHostBootstrapInvariants.property.test.js` (new)
- `specs/pipeline/steps/bl628AutonomousHostBootstrapSteps.js` (new)
- `specs/pipeline/steps/index.js` (registration, 1 line)
- 4 new shell test suites under `swarmforge/scripts/test/`

`provision_secondary_host.sh` (the BL-101 script this ticket must not
change per invariant 2) has ZERO byte diff — confirmed by `git diff
efe0043dc2 e9cef3c94b -- swarmforge/deploy/provision_secondary_host.sh`
producing no output.

## Dependency check (BL-622 prerequisite)

The ticket's own `depends_on: [BL-622]` calls BL-622 (Telegram token
separation) "a PREREQUISITE for this ticket being safe to use... do not
ship this without it." Verified `backlog/done/BL-622-onboarding-telegram-token-separation.yaml`
exists and BL-622's landing commit (`cfe616c4`) is an ancestor of the
commit under review (`git merge-base --is-ancestor cfe616c4 HEAD` →
ancestor). `provision_autonomous_host.sh`'s own closing instructions
explicitly name BL-622 and tell the operator to give the new box its own
Telegram token before starting the swarm (step 2 of "Remaining MANUAL
steps") — the prerequisite is both satisfied on `main` and actively
surfaced to the operator at the point of use.

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate (BL-259 hard gate)** — ran against the property
   test file (the only changed file under `extension/`): "Dependency-rule
   gate PASSED: no forbidden edges." The shell scripts and step-handler
   file sit outside `extension/`'s scan root — same structural N/A as
   every other non-TS parcel (e.g. BL-891, BL-806's own architect passes).
2. **Co-change coupling (BL-255)** — ran against all 6 changed
   deploy/pack/step files. All "SUSPECTED COUPLING" hits are either (a)
   within this ticket's own new file family (1 co-change each — expected
   for brand-new files) or (b) `generate_systemd_units.sh`'s pre-existing
   broad hub coupling (its own test file, the other unit-consuming step
   handlers, `provision_secondary_host.sh`) — unaffected by this ticket's
   one-line description-text change to that file. Nothing crosses into
   unrelated modules.
3. **Two-layer boundary / webview / secrets** — not applicable: no
   `extension/src` or `media/` code touched. This is fork-maintenance
   tooling under `swarmforge/deploy/` (local-engineering Architecture Rule
   2), same class of exception as prior deploy/scripts-only architect
   passes.
4. **Design-constraint review (the ticket's own stated architect-pass
   purpose): the shape split.**
   - `host_bootstrap.sh` correctly isolates exactly the shape-agnostic
     half (packages, pinned substrate via `bootstrap_lock_value` reading
     `swarmforge.lock.json`, `DISABLE_AUTOUPDATER`, clone) — verified every
     install function reads its version from the lock file, never a
     hardcoded or floating string.
   - Every mutating action in both the library and
     `provision_autonomous_host.sh` is gated behind
     `bootstrap_is_dryrun`/`BOOTSTRAP_DRYRUN` (library) or an inline
     `bootstrap_is_dryrun` check (script) — traced every `sudo`/`curl`/
     `git clone`/`apt-get` call site, none is unconditional.
   - **Conf/unit rendering is deliberately NOT dry-run-gated** (writes to
     `$PROJECT_ROOT/swarmforge/packs/*.conf` and a scratch `$UNIT_TMP_DIR`,
     default `/tmp`). Checked this against invariant 1's literal "file
     write" wording and confirmed it is not a violation: this is the EXACT
     existing precedent `provision_primary_host.sh` (BL-359, already
     merged, already architect-reviewed) already established — read that
     file directly (`swarmforge/deploy/provision_primary_host.sh:38-42,
     90-94`) and confirmed byte-for-byte the same pattern (unit generation
     to `/tmp` unconditional; only `sudo mv`/`sudo systemctl`/`sudo
     install`/`sudo touch`/`sudo chmod` gated via its own `run()` helper).
     The invariant's own rationale ("mutates nothing ON THE HOST... the
     operator inspects an internet-facing box on its word") is about
     persistent, privileged system state — a scratch/tmp render or a
     write inside the checkout the operator just cloned is neither
     persistent nor privileged, and rendering FOR REAL is a stronger
     transparency guarantee than a printed description (the operator can
     read the exact file that would be installed). Every write that
     touches real host state outside the checkout (`~/.claude/settings.json`,
     `/etc/swarmforge/*.env`, `/etc/systemd/system/*.service`) IS
     correctly gated — traced each one.
   - Scenario 07 (no unit content authored outside the generator): grepped
     both `provision_autonomous_host.sh` and `provision_secondary_host.sh`
     for `[Unit]`/`[Service]` — neither appears; every unit call routes
     through the existing `generate_systemd_units.sh`, whose only change
     in this commit is the cosmetic `Description=` string ("SwarmForge
     secondary swarm" → "SwarmForge swarm") — `--unit=front-desk` support
     already existed (BL-351), not added by this ticket.
   - Front-desk unit: confirmed `provision_autonomous_host.sh` renders and
     enables all three units (swarm, operator, front-desk) via the shared
     generator, closing the "exactly as dark as no unit at all" gap the
     ticket describes for the NEW shape only — confirmed
     `provision_secondary_host.sh` still renders exactly its original two
     (swarm, operator), never front-desk.
   - `packs/autonomous-swarm.conf` carries no `config swarm_mode` line
     (relies on `swarmforge.sh`'s own autonomous default) — matches the
     template's own header comment and is exercised directly by
     `test_autonomous_swarm_pack.sh`'s primacy-validation check.
5. **TypeScript compiles clean** — `npm run compile` (from `extension/`) →
   no errors.

## Invariants Review (BL-633/654) — both declared invariants

1. Dry-run mutates nothing on the host (package install / file write / unit
   enable).
2. Nothing the autonomous path adds changes what the secondary path does.

- Both have coder-authored, non-vacuous property tests in
  `bl628AutonomousHostBootstrapInvariants.property.test.js` (architect
  verifies existence/non-vacuity, does not author them — correctly rests
  with coder). Both drive the REAL `provision_autonomous_host.sh` as a real
  subprocess (`PROVISION_AUTONOMOUS_DRYRUN=1`), never a reimplementation.
- **Invariant 1**: scans real subprocess stdout/stderr across 6 random
  swarm names for any unprefixed `sudo`/`curl`/`git clone`/`apt-get` line,
  AND independently confirms via `fs.existsSync` that the real systemd unit
  path was never created — external proof, not just output-text trust.
  Also confirms the conf/unit render genuinely happened (proving the
  dry-run branch is not a wholesale no-op) — consistent with the design
  read in check #4 above. Non-vacuity: a synthetic broken-output string
  with one leaked real `sudo` line is shown to fail the same filter.
- **Invariant 2**: two static property tests over the real
  `provision_secondary_host.sh` source — one checks it carries none of 6
  BL-628-only symbols (`host_bootstrap.sh`, `BOOTSTRAP_DRYRUN`,
  `PROVISION_AUTONOMOUS`, `generate_autonomous_conf`, `--unit=front-desk`,
  `front-desk`), the other confirms exactly the same 2
  `generate_systemd_units.sh` calls (swarm + operator, no front-desk) and
  no new dry-run env var reference. Non-vacuity: a synthetic
  `PROVISION_AUTONOMOUS`-referencing string is shown to trip the marker
  check.
- No violation found on either. No missing or vacuous property test found.

## Property Testing pass (own section)

The declared-invariant properties above already cover every pure/testable
seam this commit introduces in a property-shaped way (dry-run fidelity,
secondary-path non-coupling). `generate_autonomous_conf.sh`'s own
validation logic (name format, placeholder refusal, collision refusal) is
example-based-tested exhaustively by `test_generate_autonomous_conf.sh`
(8 scenarios, including a same-template-different-unit-dir case) — no
additional undeclared-property gap found for this parcel.

## Tests re-run independently (all green)

- `npx vitest run --config vitest.properties.config.mjs bl628` (from
  `extension/`, after `npm run compile`) → 5/5 tests passed (1 property
  test for invariant 1, 2 property tests for invariant 2, 2 non-vacuity
  companions).
- `bash swarmforge/scripts/test/test_host_bootstrap.sh` → ALL PASS (13
  scenarios, including a real non-vacuity clone with `BOOTSTRAP_DRYRUN`
  unset).
- `bash swarmforge/scripts/test/test_generate_autonomous_conf.sh` → ALL
  PASS (8 scenarios).
- `bash swarmforge/scripts/test/test_provision_autonomous_host.sh` → ALL
  PASS (8 scenarios).
- `bash swarmforge/scripts/test/test_autonomous_swarm_pack.sh` → ALL PASS
  (4 scenarios).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature`
  → 15/16 scenarios PASS. The 1 failure (autonomous-bootstrap-08, "the
  runbook says where the onboarding ceremony happens") is EXPECTED at this
  stage: it asserts `docs/how-to/BL-628-autonomous-swarm-bringup.md`
  exists, which the ticket's own `required_stages` and design note
  explicitly assign to the DOCUMENTER stage (not yet run). Confirmed the
  file does not exist yet (`ls docs/how-to/ | grep 628` → none) — this is
  correctly deferred work, not a defect in the reviewed commit. Per Article
  4.3, a doc-only gap routes to the documenter, which is exactly where this
  parcel is headed next (via hardener).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. The one acceptance scenario not yet green is explicitly and
correctly the documenter's still-pending work, not a defect in this
commit. Clean pass — Article 4.4 explicit-NONE evidence, committed per the
BL-806 review-forward-evidence gate. Forwarding to hardener.

By architect.
