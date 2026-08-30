# Triage — QA report "fresh-clone daemon fixtures miss extension/out/, flaky failures"

**Reported:** QA note, 2026-08-29T16:40:50Z (priority 50, message-only — no
evidence file accompanied it).
**Triaged by:** specifier, 2026-08-30. **Not minted:** the report names a
fixture CLASS but no fixture, and the search below did not identify one.

## Why this is not yet a ticket

Naming the wrong integration point in a ticket's Scope sends the coder to
instrument code that is not the live path. The reported invariant is
plausible and worth fixing — `extension/out/` is gitignored, so a fixture
that stands a project root up with `git clone` inherits no compiled node
tools, and a daemon run against that root then fails on a missing build
artifact rather than on the behaviour under test. But a ticket needs the
failing fixture, not the theory.

## What was searched and ruled out

Every shell fixture under `swarmforge/scripts/test/` that calls `git clone`:

- `test_operator_file_question.sh` — clones only to assert a committed file
  is visible; runs nothing against the clone.
- `test_remote_wakeup_periodic_pull.sh` — clones a synthetic upstream; drives
  `remote_wakeup_periodic_pull` only.
- `test_handoffd_master_main_reconcile_wiring.sh`,
  `test_briefing_marker_commit.sh`, `test_swarm_heal_push_before_reset.sh` —
  clone synthetic repos, not this project; no `extension/out/` consumer.
- `test_host_bootstrap.sh` — its clone is DRYRUN-printed, never executed.

Related mechanisms that already handle the same hazard, and so are probably
NOT the gap:

- `swarmforge/scripts/node_tool_bringup_lib.bb` (BL-1010) already turns a
  missing compiled tool into a message naming the bring-up step; `handoffd.bb`
  uses it.
- `extension/test/helpers/sharedRepoFixture.js` deliberately uses a recursive
  filesystem copy rather than `git clone`, and says so at its head — a
  fixture following that pattern keeps whatever the source tree had.

Not swept exhaustively: the ~14 `specs/pipeline/steps/*.js` handlers that
clone. If the failing fixtures are there, naming them is a one-line answer
from whoever saw the failure.

## What is needed to mint

1. The fixture file name(s) that failed.
2. One failure transcript, or the run in which it was flaky.
3. Whether the failure is a missing `extension/out/...` module error, or
   something else that merely correlates with a fresh clone.

With those, this is a small, gateable slice. Without them it would be a
verification-only chore with no executable gate.

## Sweep completed — disposition: NOT MINTED, closed (specifier, 2026-08-30)

The last unswept surface is now swept. Three surfaces, all clear:

1. `swarmforge/scripts/test/*.sh` — specifier, above.
2. `specs/pipeline/steps/*.js` (all 14 clone-using handlers) — QA,
   `backlog/evidence/fresh-clone-out-qa-sweep-20260830.md`.
3. `extension/test/**` clone-using files — specifier, this pass:
   - `bl628AutonomousHostBootstrapInvariants.property.test.js` — "git clone"
     appears only as a string pattern asserted against DRYRUN output.
   - `onboarderState.test.js` — clone strings are onboarding prompt TEXT;
     its `require('../out/onboarding/onboarderState')` is this repo's build.
   - `contractPhaseRealAdapters.test.js` — requires this repo's
     `../out/tools/...`; its clone is a target-repo adapter fixture, and the
     real `git clone` path is deliberately not exercised.
   - `pilotAcceptanceGateCli.test.js` — `CLI_PATH` is
     `path.join(__dirname, '..', 'out', ...)`, i.e. absolute into THIS repo;
     only `cwd` is the fixture. Same safe shape as the specs handlers.
   - `bl1236ReconcileConflictPredictionInvariants.property.test.js` — no
     `out/` dependency at all.
   - `helpers/sharedRepoFixture.js` — recursive filesystem copy by design,
     documented at its head; inherits whatever the source tree had.

**No fixture on any swept surface stands a project root up with `git clone`
and then executes compiled node output from inside that clone.** The
reported symptom has no reproducer in the tree.

### Why this is closed rather than minted

The three mint prerequisites listed above are all unavailable and cannot be
recovered: QA has no transcript and no record of the producing run (the
originating note went out message-only). Minting now would produce a
verification-only chore with no executable gate — the failure it would
assert against does not exist to be gated.

The underlying hazard remains real but is already handled: `extension/out/`
is gitignored, and `swarmforge/scripts/node_tool_bringup_lib.bb` (BL-1010)
already converts a missing compiled tool into a message naming the bring-up
step. A pre-emptive guard against a fixture pattern with zero occurrences
would fail INVEST-V (no observable outcome) and rot the way hand-enumerated
closure-guard membership does.

**If the symptom recurs: capture the failing fixture name and the transcript
in the same turn.** With those this becomes a small, gateable slice; without
them it is unmintable, and this sweep should not be repeated.

By specifier.
