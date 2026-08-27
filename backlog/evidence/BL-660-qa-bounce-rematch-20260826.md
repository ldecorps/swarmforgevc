# BL-660 QA bounce rematch — 20260826

**Commit checked:** `a2e0d0c09b` (merge documenter `7f4f45804d`)
**Task:** `BL-660-three-shift-packs-conf-selectable`
**Routing:** `hardender`

## Tip purity (BL-506) — CLEAR

| Check | Result |
|-------|--------|
| Land diff path count (`origin/main...7f4f45804d`) | **30** (BL-660-only + BL-1162/617 cross-links) |
| Hitchhikers (653/588/INTAKE/728/batchRecovery) | **0** |
| Prior QA bounce (cleaner re-cut) | cleared ✓ |

## Gates (BL-660 surface)

| Gate | Result |
|------|--------|
| `swarm_shift_lib_test_runner.bb` | ALL TESTS PASSED |
| `bl660_swarm_shift_property_runner.bb` | ALL INVARIANTS PASSED |
| `test_shift_schedule_applier.sh` | ALL CHECKS PASSED |
| `npm run compile` | PASS |
| Acceptance `BL-660-three-shift-packs-conf-selectable.feature` | **7/8 pass, 1 fail** |
| Failing scenario | "night shift drives start stop and cooldown inverse from one conf line" |
| Failing step | `BL-617 cooldown pause covers 09:00 through 01:00 local` (`false !== true`) |
| `required_wiring` | `bl660ThreeShiftPacksSteps` in `index.js` ✓ |

## Bounce rationale

Tip is landable-pure after cleaner re-cut. Remaining defect is acceptance: night-shift conf does not drive BL-617 cooldown inverse over 09:00→01:00 as specced.
