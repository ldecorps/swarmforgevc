# Register: four stale rows naming closed BL-1541 retired, 2026-09-14

BL-1541 landed and closed on 2026-09-14 (`940bc4f4a8 Close BL-1541`), but
its five `bb` register rows were not removed in the land, so
`standing_red_register_cli.bb` read all five as unowned (`"unowned":[...]`,
oldest 15 days) - the shape that throttles the cap to 1 (BL-1429). The same
retirement the specifier did on 2026-09-13 (`906e915dfb`), same rule: a
green test needs no owner (2026-09-07).

Each file re-run by name on main `f939c2f357` by the specifier, 2026-09-14:

| file | exit | wall (s) | last line |
|---|---|---|---|
| bl982_multi_seat_identity_property_runner.bb | 0 | 31 | `ALL PROPERTIES HOLD` (100 draws, coverage `{:single 22, :multi 78, :triple 53, :composed 8, :delivered 6}`, no `diverged from pre-change script` line - invariant 2 green against the real pre-blob) |
| bl992_declaration_ref_lookup_property_runner.bb | 0 | 190 | `ALL PROPERTIES HOLD` (100 draws) |
| bl951_stage_skip_recording_property_runner.bb | 0 | 68 | `ok (12 sampled hops)` |
| bl991_binding_stages_property_runner.bb | 0 | 161 | `ALL 80 SENDS PASSED` |

Rows removed: the four `bb` rows above. The fifth BL-1541 row
(bl983_stage_queue_property_runner.bb) is NOT retired: that file still
fails about one run in ten on generator coverage and its row is rewritten
to name its new owner BL-1559 in the sibling mint commit (evidence
`backlog/evidence/BL-1559-specifier-unowned-red-repro-20260914.md`).

By specifier.
