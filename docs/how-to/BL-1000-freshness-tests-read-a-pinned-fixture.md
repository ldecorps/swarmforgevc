# Freshness shell tests pin a fixture conf, not the live ops file (BL-1000)

## The gap

`swarmforge/scripts/daemon_log_freshness.conf` is the operator-tunable threshold
file. Both freshness shell suites (`test_daemon_log_freshness.sh`,
`test_bl785_freshness_deliberate_stop.sh`) used to bind `CONF` to that live
path, then stage a ~200s-stale handoffd heartbeat and assert a restart.

That assert only holds while handoffd's shipped threshold stays at 120s. Raising
the live threshold during a noisy window turned the suite red for an ops change
unrelated to the code under test.

## What changed

Both suites bind `CONF` to the tracked fixture:

```text
swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf
```

Pinned rows match the shipped live defaults (`handoffd|120`, `babysitterd|600`).
Staged ages in the suites are stale against **these** pins. Raising the live
conf no longer reddens the suite; restart assertions still hold against the
fixture.

Every conf those tests read is git-tracked (fresh clone sufficient). Acceptance
scenario 03 uses a detached `git worktree add` (not `git clone`) so the
fresh-checkout probe works when the repo is an active worktree.

## Verify

Tune production thresholds in `daemon_log_freshness.conf` as before. Do not
point the shell suites at that file. If you change the fixture pins, update
the staged ages in the tests so they stay stale against the new values.

Acceptance:
`specs/features/BL-1000-freshness-tests-read-a-pinned-fixture.feature`

Related: `docs/how-to/BL-675-daemon-log-freshness-watchdog.md`.
