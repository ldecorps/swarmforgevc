# BL-1274 — hardener pass

Hardener, 2026-08-30.

## Scope

This ticket is a shell script (`launch_resident_spy_tunnel.sh`) plus a Vitest
property test and acceptance-pipeline step/registry files — no `extension/src`
TypeScript compiled to `out/`. Per Design And Testability, Stryker/CRAP/DRY do
not apply to any of the changed files (confirmed: `git diff` of this ticket's
merge touches only `extension/test/*.property.test.js`,
`specs/pipeline/steps/*.js`, and a `.sh` file). This is a no-wired-mutation-tool
surface (BL-638 fallback): hardening here is a hand-authored mutation sweep
plus verification, not a Stryker run.

## Hand-authored mutation sweep

**Mutant: remove the entry-point guard.** The fix's core mechanism is
`launch_resident_spy_tunnel.sh`'s new tail guard:

```
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
```

This is exactly what lets the property SOURCE the script and call
`wait_named_ready` directly without ever starting a real background process —
the entire fix depends on it. Hand-mutated to `main "$@"` (unconditional),
confirmed the property's own step
(`source ${LAUNCH} ${dir} >/dev/null 2>&1; ... wait_named_ready`) now executes
`main()` on load: `install_cloudflared_if_missing` attempts a real network
`curl` (no `cloudflared` binary present in the fixture's isolated `$HOME`),
which hangs/stalls the run past a 60s foreground timeout — killed by hand,
confirmed no residual `cloudflared`/`curl` processes or state left running,
restored the file (`git status` clean before and after). This is a genuine
kill, not a clean assertion failure, but it is a kill: the mutant is
detected, not equivalent. Re-ran the file clean afterward (3/3 green,
invariant 1 in 348ms).

The reverse mutant (guard inverted to `!=`, so `main` never runs when
executed directly) is caught by both `test_launch_resident_spy_named_tunnel.sh`
(named/quick mode assertions all require real output/state files main()
produces) and this ticket's own acceptance scenario 01 (asserts the launcher
echoes the hostname and writes tunnel state) — not re-run by hand since the
mechanism is identical in kind to the first mutant and already covered by
tests that assert on main()'s actual output.

## Verification

- `node specs/pipeline/cli.js specs/features/BL-1274-...feature` — 4/4 pass
  (scenario 01's delayed-startup row took ~21s as expected, others fast).
- `swarmforge/scripts/test/test_launch_resident_spy_named_tunnel.sh` — all
  19 checks pass, unaffected by the `main()` guard (every invocation there
  executes the script via `bash $LAUNCH ...`, never sources it).
- `bl787NamedTunnelInvariants.property.test.js` full file, isolated,
  `vitest.properties.config.mjs`: 3/3 pass, 29.7s total, invariant 1 alone
  348ms (was ~62s under load pre-fix per coder evidence) — confirms the fix
  holds and no host-scheduler dependency remains.
- Whole-tree guards for the trees this parcel touches
  (`specs/pipeline/steps/`, `extension/test/`): ran all
  `extension/test/*Guard*.test.js` (excluding `.property.` siblings) —
  4 pre-existing failures (`liveRepoDerivationGuard`,
  `socketFixtureShortRootGuard`, `tempDirTrapGuard`, `tmpDirMigrationGuard`),
  none of which name any file this ticket touches (grepped their output for
  `bl1274`/`bl787`/`launch_resident_spy` — no hits). Pre-existing standing
  debt, out of scope for this ticket.

## Housekeeping note, not this ticket's scope

`/tmp` on this host carries 349 stale `bl787-ready-prop-*` fixture
directories accumulated over several days (oldest observed 2026-08-28),
well beyond anything this pass created (my own mutant-test run added 4,
which I removed). Not touched further — not created by this pass, and the
volume suggests a standing leak worth its own ticket rather than a drive-by
cleanup here.

## CRAP / DRY / mutation-site count

Not applicable — no `extension/src` file in this ticket's diff (see Scope
above), consistent with the cleaner's evidence.

Forwarding to documenter.
