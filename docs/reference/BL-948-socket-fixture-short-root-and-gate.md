# BL-948: Socket-Fixture Short Root and Its Gate

Acceptance step files that build or reference a control socket now take
their fixture root from a shared helper rooted at a SHORT base (`/tmp`),
never `os.tmpdir()`. A standing gate refuses any step file that references
a control socket while rooting a fixture at the long base, deciding scope
by inspection rather than from a checked-in list.

**Last Updated:** 2026-08-20

## Background

`swarm_socket_lib.bb` refuses to bind a unix socket whose path exceeds 100
characters — a deliberate fail-closed guard under the 104/108 `sun_path`
limits (BL-367). On macOS `os.tmpdir()` resolves under
`/var/folders/<hash>/<hash>/T/`, so a fixture root created there plus
`<root>/.swarmforge/tmux/<hash>.sock` overruns 100 easily; the measured
case reached 107.

The guard fires correctly — but it fires BEFORE the script under test
reaches the behavior the scenario means to exercise, so the scenario fails
for a reason unrelated to what it asserts. In
`specs/features/BL-368-control-loss-is-not-agent-death.feature`, "A role
whose process is still alive is never relaunched" never reached the
still-alive check at all: `role_lifecycle.sh unpark` refused on socket path
length first.

Three separate step files hit this on 2026-08-19 (BL-817, BL-938, and the
defect BL-944's coder recorded rather than patching a third time). Three
identical local patches is the signal that the fix belongs one level up.
Scale, measured the same day: 301 step files call `mkdtempSync` and 297 root
at `os.tmpdir()`, but only 43 also build or reference a control socket — and
only those can hit the guard. The other ~254 are unaffected and are
deliberately left alone.

**The guard itself is untouched.** It is correct; the fixtures were wrong.
Relaxing the limit, raising it, or adding a test-only bypass are all out of
scope by the ticket's own constraints.

## How It Works

### The helper — `specs/pipeline/steps/lib/socketFixtureRoot.js`

`mkSocketFixtureRoot(prefix)` creates a root under `SHORT_FIXTURE_BASE`
(`/tmp`) with `mkdtempSync`, so uniqueness per scenario is unchanged —
shortening never collapses two concurrent fixtures onto one path.

Before handing the root back it ASSERTS headroom: it appends
`WORST_CASE_SOCKET_SUFFIX` (`/.swarmforge/tmux/4294967295.sock`) and throws
if the result exceeds `SOCKET_PATH_GUARD_LIMIT` (100), naming the offending
length and prefix. A too-long prefix therefore fails loudly at creation
instead of dying downstream on the guard's refusal. The worst-case hash is
not a guess: `project_socket_id_lib.sh` derives the socket id with `cksum`
(CRC32), whose upper bound is exactly `4294967295`.

Every root handed out is tracked. A `process.on('exit')` hook removes any
straggler, reaping a fixture tmux server by SOCKET PATH first through the
shared `fixtureReaper` (BL-817/BL-458 hygiene — never by session name). An
adopter's own `afterEach`/`finally` cleanup stays correct and welcome; this
hook is the backstop for THROW paths, where 236 of 287 step files had no
`finally` at all when it was measured on 2026-08-18.
`releaseSocketFixtureRoot(root)` exists for adopters that remove a root
themselves mid-run; it is idempotent with the exit hook.

### The gate — `specs/pipeline/steps/lib/socketFixtureRootGuard.js`

The gate decides the adoption set BY INSPECTION of each file's own text at
gate time. There is no checked-in roster of paths: a roster goes stale on
the next step file and reproduces exactly the one-at-a-time patching this
ticket exists to end. A file is flagged if and only if BOTH hold:

1. its comment-stripped code references a control socket (`.swarmforge/tmux`,
   `tmux-socket`, or a `.sock` path), and
2. it roots a fixture at the long base.

Full-line comments are stripped before the socket check, so prose about
sockets never pulls a file into scope; string literals are KEPT there,
because that is where real socket paths live.

For the long-base check the rule keys on the base itself rather than on how
it was spelled. `rootsAtLongBase` slices each `mkdtempSync(` call's own
argument text by paren balance and looks for a `tmpdir()` call of any
receiver, resolving a local alias bound from `tmpdir()`. All six realistic
spellings are caught — the direct
`mkdtempSync(path.join(os.tmpdir(), …))` form, a hoisted
`const base = os.tmpdir()`, a destructured `tmpdir`, a template-literal
interpolation, string concatenation, and an inline `require('os').tmpdir()`.
Quoted-string CONTENTS are blanked for this check only: real code never
spells `os.tmpdir()` inside a quoted string, so a file that does is carrying
an example (this feature's own acceptance step file does). Template literals
are deliberately left intact, since `` `${os.tmpdir()}` `` is a real
spelling whose call is an expression, not text.

The remedy for a flagged file is always the same: take its root from
`mkSocketFixtureRoot` instead.

### Where it is enforced

`extension/test/socketFixtureShortRootGuard.test.js` runs the scan over the
real tree as part of the standing suite every parcel runs — the same shape
as BL-459/872's `tempDirTrapGuard.js` and BL-817's `tmuxReaperGuard.js`.
`extension/test/bl948SocketGuardLimitParity.test.js` closes the BL-897
mirrored-constant risk from the other direction: both `SOCKET_PATH_GUARD_LIMIT`
and the shape behind `WORST_CASE_SOCKET_SUFFIX` are hand-mirrored across a
language boundary no import can bridge, so the parity test reads
`swarm_socket_lib.bb`'s `max-safe-socket-path-len` and `primary-socket-path`
literals directly and fails on drift — a "kept in sync" comment is not a
gate. A further test asserts the socket id is still derived with `cksum`, so
the worst case is re-derived rather than assumed if that ever changes.
Generative coverage lives in
`extension/test/bl948SocketFixtureInvariants.property.test.js`, run in the
property lane, not the unit lane.

## Adoption and Scope

54 files take their roots from the helper: 51 step files plus three under
`specs/pipeline/steps/lib/`. Non-socket fixtures were left untouched, per
the ticket's explicit churn constraint.

Two blind spots between the two mechanisms are worth knowing, because one of
them was found live: the gate only catches LONG-base roots, and the helper
only cleans roots it handed out — so a SHORT-base root created directly with
`mkdtempSync` gets neither. `bl817FixtureTmuxServersReapedSteps.js` did
exactly that and stranded three `/tmp/sfvc-bl817-loc-*` directories on disk;
it now routes through the helper. **If you build a socket fixture, take the
root from `mkSocketFixtureRoot` even when your own base is already short.**

## Known Not Covered

- `$TMPDIR` holds a large historical accumulation of `sfvc*` fixture
  directories (2374 when measured on 2026-08-20) from the ~254 non-socket
  fixtures. That is the shared engineering rule's `finally` problem, out of
  scope here and left to the ticket that owns it.
- `swarmforge.sh` reporting the socket refusal on stdout — which is why the
  original failure read as "no output at all" — is BL-947, independent.
- The shell-surface sibling, where shell-test fixtures overrun the same
  guard at `swarmforge.sh` source time and die silently, is BL-974.

## Human-Facing Surface

None. This closes a defect in the acceptance test harness itself — no
extension command, setting, or UI changes, and no `.bb` file was modified.
