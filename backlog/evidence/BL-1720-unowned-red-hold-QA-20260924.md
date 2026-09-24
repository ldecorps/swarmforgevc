# BL-1720 - QA hold on unowned reds (Article 4.2), 2026-09-24

Parcel commit: d24e8d4b0c ("Merge documenter 6783b122b4 into QA."). One run per lane via
qa-gather.js. BL-1720 touches neither red file. Neither has a row in backlog/standing-reds.tsv.

1. extension/test/bl1703OllamaLaunchProbe.property.test.js (property, from BL-1703, landed
   d51983e4a9 today)
   `FAIL test/bl1703OllamaLaunchProbe.property.test.js > invariant: a never-answering endpoint
   refuses the launch and leaves no started process running, across wait/poll combinations`
   `AssertionError: expected pid 7123 to be stopped` (line 85: `fx.pidAlive(startedPid)` true).
   pid 7123 is the fixture's own started fake responder (read from its pid file). It was alive
   at the assertion and gone when QA checked a minute later. Not re-run (one run per lane).

2. swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh (shell, reached by
   qa_e2e step 2's babysitter runner sweep)
   `REFUSED project-root /tmp/tmp.gInNOieaZC: not inside a git checkout (git -C <arg> rev-parse
   --git-common-dir failed)`, exit 2. It reproduces identically on origin/main's own scripts
   (`git archive origin/main`, same REFUSED line), so it is pre-existing: the test's mkdtemp
   fixture root is not a git checkout, and operator_runtime.bb now refuses such a root.

Also in the property run: 9 unhandled errors, all the allowlisted BL-871
`[vitest-worker]: Timeout calling "onTaskUpdate"`.

BL-1720's own gates in the same pass: unit green; acceptance (the BL-1720 feature) green;
pre_qa_gate OK; sibling-check VERIFY. qa_e2e step 2: babysitter_assess/nudge/freshness/sweep
runners, test_babysitter_check.sh, test_babysitter_nudge_resident.sh, the census,
heartbeat and lifecycle tests, and test_retire_seat_stays_dropped.sh all pass (the watchdog test
is red 2 above). Step 3: `retire_seat.sh` with no argument prints usage and exits 1. With an
unknown seat, against a throwaway root holding a copy of roles.tsv, it refuses naming the seat,
exits 1, and changes no file. Step 4: scope is BL-1720's own, and suite-manifest.tsv adds only
its row.

By QA.
