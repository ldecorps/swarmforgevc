# BL-243 bounce evidence — 20260710

## Failing command

```
zsh -c "
  source 'swarmforge/scripts/swarmforge.sh' '<fixture-root>'
  CONFIG_FILE='<repo>/swarmforge/packs/seven-pack.conf'
  parse_config
"
```

Reproduced identically (same rejection, same exit code) against every one of
these real, shipped conf files — not test fixtures, the actual files this
repo ships and documents as the supported launch path:

- `swarmforge/packs/two-pack.conf`
- `swarmforge/packs/two-pack-mistral.conf`
- `swarmforge/packs/three-pack.conf`
- `swarmforge/packs/four-pack.conf`
- `swarmforge/packs/seven-pack.conf`
- `swarmforge/packs/resilience-min.conf`
- `swarmforge/profiles/stabilize-two-pack.conf` (referenced by
  `.vscode/launch.json`'s "Run Extension (two-pack stabilize · daemon on)")
- `swarmforge/profiles/cheap-copilot-seven-pack.conf`
- `swarmforge/scripts/test/connected/packs/connected-two-pack-claude.conf`
- `swarmforge/scripts/test/connected/packs/connected-two-pack-mistral.conf`
- `swarmforge/scripts/test/connected/packs/connected-two-pack-gpt.conf`

## Commit hash tested

`04fba266cb53d12402885a5457d64ba6f264c2d4` (documenter handoff, full BL-243
range starts at `1fa7e18a50` / promote at `63e4426`).

## First error excerpt

```
Error: coordinator is reserved infrastructure and may not be declared as a window in /home/carillon/swarmforgevc/.worktrees/QA/swarmforge/packs/seven-pack.conf (line 8) - it is always provisioned automatically.
EXIT CODE: 1
```

(Identical shape for every file listed above, each at its own `window
coordinator ...` line.)

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure — `npm test` (161/161 files
green) and the Gherkin acceptance run for
`specs/features/BL-243-coordinator-is-provisioned-infrastructure.feature`
(all 5 scenarios) both pass, because both exercise only **fresh fixture
confs written by the ticket's own test** (`test_coordinator_provisioned_infrastructure.sh`
and the Gherkin step handlers), never the real pack/profile files this repo
ships. This is an intent/behavior gap: the ticket's own wanted-behavior text
says "the conf declares the PACK ONLY... a conf without a coordinator is the
NORMAL launch path — not an edge case," which necessarily implies every conf
this repo ships and documents as a launch path (not just the one live
`swarmforge/swarmforge.conf`) needed the same migration `95583ac` gave the
live conf. The migration only touched `swarmforge/swarmforge.conf` — the
pack templates (`swarmforge/packs/*.conf`), profiles
(`swarmforge/profiles/*.conf`), and the connected-test pack fixtures were
never updated, so parse_config's new reserved-word rejection now hard-fails
every one of them at launch.

## Expected vs observed

Expected: `SWARMFORGE_TERMINAL=none ./swarm <target> --pack seven-pack`
(the pack file's own documented launch command, in its header comment) and
the VS Code "Run Extension (two-pack stabilize · daemon on)" launch config
both still launch successfully, coordinator auto-provisioned per BL-243's
own design. Observed: both — and every other pack/profile — now abort at
`parse_config` with "coordinator is reserved infrastructure," because each
still declares the now-forbidden `window coordinator ...` line BL-243 left
unmigrated outside the one live conf.

## Suggested fix scope

Remove the `window coordinator ...` line from every file listed above (the
same edit `95583ac` already made to the live `swarmforge/swarmforge.conf`),
and add a regression test that greps every `swarmforge/packs/*.conf` +
`swarmforge/profiles/*.conf` for a `window coordinator` line so a future
new pack/profile can't reintroduce this gap silently.
