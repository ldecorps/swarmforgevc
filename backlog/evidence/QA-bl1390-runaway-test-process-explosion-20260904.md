# URGENT — BL-1390's own e2e test is running 1000+ concurrent copies, host resource exhaustion in progress

Live incident, still ongoing as of this writing. Not a bounce on BL-1390
(not my ticket) — a swarm-health emergency report.

## What I observed

While landing BL-1362 (unrelated ticket), the property-suite guard's
`test:properties` run kept slowing down across repeated attempts (332s →
570s) and kept refusing on different non-allowlisted files each time
(first `bl1074`/`bl1367`/`bl956`, then `bl1304`/`bl1346` twice in a row —
the repeat of the identical pair is what made me stop assuming pure
random flakiness and check the host directly).

`uptime`: `load average: 5.94, 7.30, 8.72`. `free -h`: 13Gi/19Gi RAM used,
1.5Gi/5.0Gi swap in use. `ps aux --sort=-%cpu` topped by dozens of
`bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh` at high CPU.

```
pgrep -fa "test_bl1390_post_commit_push.sh" | grep -c "^[0-9]* bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh$"
1156
```

Over a thousand concurrent, apparently-identical invocations of the same
test script, at the moment I checked. This is consuming enough CPU/RAM to
explain the property-suite guard's growing run times and cross-file
timeout flakiness system-wide — not isolated to BL-1362's own land.

## What the script itself is (read, not run)

`swarmforge/scripts/test/test_bl1390_post_commit_push.sh` (283 lines) is a
real e2e test — a genuine, real bare-origin git fixture exercising the
actual post-commit hook. Its own comments show the coder already responded
to my EARLIER incident report today
(`backlog/evidence/QA-bl1390-shared-git-config-origin-clobbered-20260904.md`):
scenario 06 now explicitly records the live repo's `remote.origin.url`
before the suite runs and asserts it is unchanged after — "This test once
rewrote the shared remote.origin.url to a fixture path and broke every
push and fetch from every worktree until QA restored it; the suite now
proves it did not, rather than asserting it in a comment." Good, targeted
fix for the first incident.

This second, different problem is NOT that fix — it's an explosion of
CONCURRENT invocations of the whole test file. The file's own fixture
discipline (`FIXTURE_PREFIX="bl1390-post-commit-"`,
`rm -rf "${TMPDIR:-/tmp}/${FIXTURE_PREFIX}"*` at start of EVERY run) is
exactly the BL-971 sweep-by-prefix pattern — safe for ONE run at a time,
but if many copies are genuinely running concurrently (not sequential
retries), each new invocation's startup sweep deletes every OTHER live
invocation's working directory mid-run. That would produce exactly the
failure-and-retry storm consistent with 1000+ copies accumulating: each
one's fixture gets destroyed by the next one to start, each failure
presumably triggers whatever outer loop is invoking this file to retry,
and the retry adds another concurrent copy rather than replacing the
dead one.

## What I did NOT do

Did not kill any of these processes. They belong to the coder's own
active worktree/session, not mine to touch (constitution: never
delete/kill what another role's work owns; this is squarely their
in-progress work, and a QA session has no visibility into whether killing
mid-run would corrupt something already in flight). Escalating instead,
to whoever holds kill/supervision authority (coordinator/operator).

## Disposition

Not fixing BL-1390 myself (not my ticket, not yet in QA's hands).
Escalating via priority-`00` notes to the coordinator (swarm health/
supervision) and the specifier (adjudication if a structural fix is
needed — e.g. the outer caller needs a concurrency guard/lock so only one
instance of this test runs at a time, or the retry loop that appears to be
spawning new copies needs a bound). Continuing my own BL-1362 land in
parallel since it is unrelated production code, already independently
verified — but flagging that further property-suite-guard commit attempts
may keep timing out/refusing until this resource exhaustion clears.

By QA.
