# Portable tab anchors instead of GNU `grep -P` (BL-989)

Three shell-test helpers used `grep -P` / `-qP` only to match a literal TAB
after a roles.tsv key. Stock macOS **BSD grep** rejects `-P`, so BL-343's
routing break-even acceptance failed with `grep: invalid option -- P` when
the suite ran under a real userland (Claude Code's agent shell often shadows
`grep`, which hid the red).

## Fix

Replace PCRE with a portable pattern built by `printf`:

```bash
# before (GNU-only)
grep -qP "^$2\t" …

# after (stock macOS / Linux)
pat=$(printf '^%s\t' "$2")
grep -q "$pat" …
```

Same sites in:

- `test_role_lifecycle_cli.sh` (`roles_tsv_has` / `roles_tsv_lacks`)
- `test_backlog_depth_pack_override.sh`
- `test_coordinator_provider_configurable.sh`

Property regression: `specs/pipeline/test/bl989PortableGrepTabAnchor.property.test.js`
(locks source shape + `/usr/bin/grep` portable pattern; tree sweep excludes `pgrep`).

## Operator check

```bash
# Must not rely on GNU -P in these helpers:
grep -n 'grep -.*P' swarmforge/scripts/test/test_role_lifecycle_cli.sh \
  swarmforge/scripts/test/test_backlog_depth_pack_override.sh \
  swarmforge/scripts/test/test_coordinator_provider_configurable.sh
# → no hits

node --test specs/pipeline/test/bl989PortableGrepTabAnchor.property.test.js
```

Acceptance (unchanged feature path):
`specs/features/BL-343-routing-break-even-measurement.feature`

## Related

BL-343 routing break-even measurement; stock-macOS userland invariant.
