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
