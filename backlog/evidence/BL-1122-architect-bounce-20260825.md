# BL-1122 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `6b06538aa7` (coder `b73887ea0` + DRY `maybe-emit-alarm!`)
on `origin/main`=`cb12bfd8ba` lineage.

## Scope

`origin/main...6b06538aa7` = **7 paths**, BL-1122-only. Hitchhike CLEAN.

## Architecture — PASS (with property-encoding gap under D1)

- Mute lives in `master_checkout_drift_lib.bb` (`commit-in-flight?` via
  `.git/index.lock` + pure `should-alarm-on-result?`) — required_wiring met;
  not a parallel mute in handoffd alone.
- Shared `maybe-emit-alarm!` keeps unknown-main and per-file paths on one gate.
- Read-only observation (`fs/exists?`); no sticky mute state across sweeps.
- No extension/webview. Dep-gate N/A (Babashka parcel).

## Acceptance / units (advisory — do not hand-verify invariants without encoding)

- APS BL-1122 → **5/5**
- `master_checkout_drift_lib_test_runner.bb` → ALL PASSED (BL-839 suite; no
  new `should-alarm-on-result?` / `commit-in-flight?` cases in tip)
- `test_handoffd_master_checkout_drift_wiring.sh` → ALL PASSED
- `bl839_master_checkout_drift_property_runner.bb` → ok (unchanged; no BL-1122
  properties)

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

Three declared invariants; tip adds **no** property runner / `*.property.test.js`
encoding them. APS scenarios exercise the shapes but are not the property-test
obligation (architect.prompt / BL-633). Existing BL-839 property runner was
not extended.

Encode (non-vacuous; RED when deliberately broken):

1. Durable `:staged-for-reversion` with `in-flight?` false still alarms;
   mute never swallows that BL-839 shape.
2. Detecting in-flight is read-only (no git write side effects from the mute
   path / `commit-in-flight?`).
3. Mute is not sticky — after lock clears, next classification alarms again
   for the same durable staged reversion.

Prefer a babashka property runner over pure `should-alarm-on-result?` (+
in-flight injection on `check-master-checkout-drift`) following the BL-839 /
BL-1120 runner shape.

## Property-testing support (undeclared) — BLOCKED BY D1

Pure `should-alarm-on-result?` is property-shaped; declared encoding first.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | invariant-unencoded | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.
