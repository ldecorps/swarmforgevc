# BL-1911 — coder bounce-fix evidence (2026-10-07)

QA bounce (bounce_count 1, backlog/evidence/BL-1911-QA-20261007.md, commit
f9c57000c3): 4 defects, all in `extension/src/tools/localSeatRepoRead.ts`.
This is an omission/insufficiency bounce — nothing reverted. No file
outside `localSeatRepoRead.ts` and its two test files changed.

## D1 — six real secret names leaked

`isSecretRelPath` matched only `basename === "bridge-token"` or
`basename.endsWith(".env")`. Fixed two ways:

1. `.swarmforge/operator/` is refused wholesale — a file new to that
   directory (the operator's own secrets and credentials: the bridge
   token, vscode-cli tokens, swarm.env backups) is a secret by
   convention, not by name. Catches both `.../vscode-cli/data/token.json`
   and `.../vscode-cli/data/agent-host-token`.
2. `.env`-ness is now a whole dot-delimited component of the basename
   (`lowerBasename.split('.').includes('env')`), not a suffix — catches
   `swarm.env.bak-before-bob-20260901T0940Z`, `qwen.env.disabled`,
   `openrouter.env.bak-anthropic-20260730`, and `.env.local`, while still
   leaving `environment.txt`/`environment-setup.ts` alone (component, not
   substring).

Six QA-named leaks now blocked: `.swarmforge/swarm.env.bak-before-bob-20260901T0940Z`,
`.swarmforge/qwen.env.disabled`, `.swarmforge/openrouter.env.bak-anthropic-20260730`,
`.swarmforge/operator/vscode-cli/data/token.json`,
`.swarmforge/operator/vscode-cli/data/agent-host-token`, `.env.local`.

## D2 — case sensitivity

`isSecretRelPath` now lower-cases the whole relative path before every
check (the directory-prefix check, the basename set lookup, and the
component check), so `.swarmforge/operator/BRIDGE-TOKEN`,
`.swarmforge/SWARM.ENV` and `extension/.ENV` all match — matters because
macOS's default APFS volume is case-insensitive, so `statSync`/
`readFileSync` would still open the real secret under a differently-cased
name.

## D3 — symlinks

`readSnippetForPathToken` ran the containment check and the secret filter
against the LEXICAL path, then let `statSync`/`readFileSync` follow
symlinks regardless. Fixed by resolving both the repository root and the
candidate through `fs.realpathSync` before either check runs, and
re-deriving the relative path (for the secret filter) from the two real
paths rather than the lexical ones. An outward symlink (`vendor ->
../outside`) now fails the real-path containment check; a symlink to a
secret under an innocuous name (`docs/notes.txt -> ../.swarmforge/operator/bridge-token`)
now fails `isSecretRelPath` on its real relative path. The existing cheap
lexical `../`-escape check in `resolveWithinRepo` stays as a first filter
(unchanged, still catches the no-fs-call case before any `realpathSync`
call).

## D4 — nested done/ and GH-<n> ids

`TICKET_ID_PATTERN` widened to `\b(?:BL|GH)-\d+\b` (GH-sourced tickets are
a real backlog id shape). `findTicketFile` now calls
`deprecate-check.ts`'s `findTicketYamlPath` for paused/active/done
(BL-1811: call the module that owns this domain answer — it already walks
`done/<milestone>/` subdirectories recursively, closing the 49%-missed
gap without this module re-deriving a walk). Guarded against the shared
function's own looser match (plain `startsWith(id)`, no trailing
separator — QA's own note: it would wrongly return a real
`BL-1911-....yaml` for a question naming `BL-19`) by re-checking the
precise `${id}-` prefix this module always matched on before accepting
its result; falling through to this module's own flat check otherwise.
`hold/` and `archive/` (not `findTicketYamlPath`'s domain — it never reads
them) stay this module's own flat, top-level fallback check, unchanged
from before this bounce.

## Tests added

- `extension/test/bl1911LocalSeatRepoRead.test.js`: the six D1 names, an
  `environment.txt`/`environment-setup.ts` non-match case, four D2
  upper-case cases, two D3 symlink cases (outward escape, symlink-to-secret),
  a D4 nested-`done/<milestone>/` case, a D4 `GH-<n>` case, and a case
  proving a shorter id is never satisfied by a longer id's file (the
  shared-lookup collision QA's note flagged).
- `extension/test/bl1911LocalSeatRepoReadInvariants.property.test.js`
  (invariant 1): the same six D1 names, the D2 upper-case path, and both
  D3 symlink cases added as new candidates in the existing
  construct-by-fixture property, each drawn to the same reach floor (15)
  as the pre-existing candidates. Non-vacuity: QA's own bounce evidence
  (backlog/evidence/BL-1911-QA-20261007.md) already proves every one of
  these exact cases failed against the pre-fix commit f9c57000c3 via its
  two repro scripts (`tmp/bl1911-secret-repro.js`,
  `tmp/bl1911-symlink-repro.js`), reproduced here as the new test/property
  cases against the fix.

## Verification at this commit

| check | result |
|---|---|
| `npm run compile` | clean |
| `npx vitest run test/bl1911LocalSeatRepoRead.test.js` | 30/30 (22 pre-existing + 8 new) |
| `npx vitest run --config vitest.properties.config.mjs test/bl1911LocalSeatRepoReadInvariants.property.test.js` | 2/2 |
| `run_acceptance.sh` BL-1911 feature | 6/6, unchanged |
| `run_acceptance.sh` BL-1682 feature (regression) | 3/3, unchanged |
| `npx vitest run bl1235LocalQwenSeatLive` (regression) | 23/23, unchanged |
| `npm test` (full unit lane) | 656 files / 11259 tests, 0 failed; node:test lane 360/360 |
| `npm run test:properties` (full property lane) | 526 files / 1450 tests, 0 failed; 4 unhandled errors, all the allowlisted BL-871 `onTaskUpdate` timeout, `dangerouslyIgnoreUnhandledErrors: true` |

By coder.
