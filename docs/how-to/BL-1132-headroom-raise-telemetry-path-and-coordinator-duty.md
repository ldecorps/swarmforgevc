# Headroom raise telemetry path + coordinator duty (BL-1132)

BL-1128 shipped `headroom_cap_raise_cli`, but live `raise` always returned
`{"action":"noop","reason":"pressure"}` while chaser telemetry showed
plenty of headroom. Two residuals:

1. **Broken `telemetry-path`.** YearMonth formatting used a bare
   `DateTimeFormatter/ofPattern` interop that threw; the reader failed
   closed to empty ratios → false `pressure`. Fixed with
   `(DateTimeFormatter/ofPattern "yyyy-MM")` then `.format` on
   `YearMonth/now`. Path remains
   `.swarmforge/telemetry/chaser-YYYY-MM.jsonl` (or
   `SWARMFORGE_HEADROOM_TELEMETRY_PATH`).
2. **Coordinator never called raise.** The role prompt now names
   `bb …/headroom_cap_raise_cli.bb <root> raise` as the designed path
   when `active/` is at configured cap and headroom allows — never
   hand-edit `active_backlog_max_depth` as standing recovery. Ceiling,
   cooldown, and throttle still apply.

## Related

- [BL-1128 raise on headroom](BL-1128-raise-active-cap-on-host-headroom.md)

Acceptance:
`specs/features/BL-1132-headroom-raise-telemetry-path-and-coordinator-duty.feature`
