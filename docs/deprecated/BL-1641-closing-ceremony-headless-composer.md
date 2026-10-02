# Retired: the closing ceremony composes a headless briefing at its hard deadline (BL-1641)

**Retired by:** BL-1836 (2026-10-02).
**Superseded by:** [BL-658's closing-ceremony how-to](../how-to/BL-658-briefing-trigger-derived-from-closure-schedule.md), step 5 ("Briefing").

## What this used to do

BL-1641 (2026-09-21) gave the closing ceremony a forced-briefing behavior at
its hard deadline, so a missing briefing was never simply left absent:

1. Land the documenter branch's own newest commit touching that day's
   `docs/briefings/<day>.md`, but only when that commit's whole diff was
   that one path (a pure add) — recorded as `briefing-landed-from-documenter`.
2. Otherwise, **compose a thin, no-agent "headless" briefing** (first line
   `Closing ceremony - headless briefing for <day>`) through
   `swarmforge/scripts/compose_banked_briefing_cli.bb` — a second caller of
   `banked_briefing_lib.bb`'s `compose-and-write-banked-briefing!`, the same
   lib `handoffd.bb`'s hibernated-mode sweep already called — and commit it
   itself, recorded as `briefing-composed-headless`.
3. If neither was possible, `briefing-missing, swarm-stopped` with a loud
   `closing-briefing-missing` surface, same as before BL-1641.

`night-closing-ceremony-run.ts`'s `applyEnsureBriefing` and
`composeHeadlessBriefing` implemented step 2 and 3; `compose_banked_briefing_cli.bb`
and its shell test were the CLI step 2 shelled out to.

## Why it was retired

From 2026-09-23 the ceremony routinely reached its hard deadline before the
documenter's own briefing existed, so every morning email for about a week
was this headless composer's thin dump instead of the documenter's authored
briefing — not a bug in the composer itself, but a product decision the
human reversed: they ruled (2026-09-30) that the ceremony should instead
**wait for the documenter** and, only if it genuinely cannot finish before
the swarm must sleep, stop with no briefing at all and let the documenter
write it right after the restart, rather than ever substituting a headless
dump for the documenter's authored one.

BL-1836 implements that ruling: at the hard deadline, nothing is composed.
A briefing already on `main` ends the ceremony quietly; none on `main` and
none on the documenter's own branch ends it loud
(`briefing-missing, swarm-stopped`) exactly as it did before BL-1641 ever
existed. Step 1 above (landing the documenter's own pure-add commit the
moment it exists, on any tick, not only at the deadline) is unchanged and
is not part of this retirement.

## What was removed

- `night-closing-ceremony-run.ts`'s `composeHeadlessBriefing` and
  `applyEnsureBriefing`, and `nightClosingCeremonyLive.ts`'s `ensure-briefing`
  action.
- `swarmforge/scripts/compose_banked_briefing_cli.bb` and
  `swarmforge/scripts/test/test_compose_banked_briefing_cli.sh` (no other
  caller remained).
- BL-1641's feature file's scenarios (the file itself stays as a
  scenario-less tombstone naming BL-1836), its step handler, and its
  property test.

`swarmforge/scripts/banked_briefing_lib.bb` and the hibernated-mode caller
(`handoffd.bb`'s `swarm-hibernated?` sweep) are **unchanged** — that caller
predates BL-1641 (BL-308) and is not part of this retirement.
