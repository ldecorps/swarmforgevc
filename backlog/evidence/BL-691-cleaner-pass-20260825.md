# BL-691 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `ae97c35c99` only
  (`dels_on_origin=0`).
- Extracted `notify-delivered-recipient!` / `write-parcel-to-recipients!`
  from `deliver-parcel!` (ambulance hold early-return kept).
- Telegram engage refusal guards undefined folder label (`unknown`).
- `bl691_ambulance_gaps_test_runner.bb`, `ambulance_lib_test_runner.bb`,
  `bl691AmbulanceEngageActiveOnly.test.js` green.
- Commit may use `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` once (BL-1124
  recovery on this host).

By cleaner.
