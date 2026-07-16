# BL-427 QA bounce — 2026-07-16

1. **Failing command** (exactly as run, from `extension/`, matching this
   project's own established Stryker-invocation convention — see
   `f2b7ffffcb`'s commit message and `swarm_profile*.conf`/cleaner sessions,
   which invoke Stryker via `npm exec stryker run ...`):

   ```
   node out/tools/profile-mutation-workers.js --interval-ms 2000 --reserve-mb 2048 \
     -- npx stryker run --mutate "out/metrics/mutationWorkerRss.js,out/tools/profile-mutation-workers.js"
   ```

2. **Commit hash checked out and tested**: `2561df9f93` (QA worktree HEAD,
   `documenter` merge of `3575dd3fec`).

3. **First error excerpt** — there is no thrown error; the command exits 0
   and prints a plausible-looking but factually wrong report:

   ```
   {
     "exitCode": 0,
     "perWorkerPeakRssBytes": {
       "3661370": 1093632
     },
     "maxPeakRssBytes": 1093632,
     "recommendedConcurrency": 20
   }
   ```

   `ps` confirms the real Stryker worker processes were alive and busy at
   the same time, each holding 700-800MB RSS (verified directly:
   `ps -o pid,pcpu,pmem,cmd -p <worker-pids>` showed 4
   `child-process-proxy-worker.js` processes at 38-90% CPU, ~720-800MB RSS
   each, for the run's full ~28-minute duration). None of that is reflected
   in the report. PID `3661370` is the intermediate `sh -c "stryker run
   ..."` shell that `npm exec` spawns — its own trivial ~1MB RSS is what
   got recorded as the sole "worker."

   Re-running the identical scenario against the direct Stryker binary
   (bypassing the npm/npx wrapper) on the same commit correctly captures
   the real workers:

   ```
   node out/tools/profile-mutation-workers.js --interval-ms 2000 --reserve-mb 2048 \
     -- node node_modules/.bin/stryker run --mutate "out/metrics/mutationWorkerRss.js,out/tools/profile-mutation-workers.js"
   ```
   ```
   {
     "exitCode": 0,
     "perWorkerPeakRssBytes": {
       "8202": 116908032,
       "8226": 117510144,
       "8227": 806535168,
       "8304": 118042624,
       "8305": 108724224
     },
     "maxPeakRssBytes": 806535168,
     "recommendedConcurrency": 12
   }
   ```

4. **Failure class**: `behavior`. The code compiles, unit tests pass, and
   the CLI exits 0 with well-formed JSON — the defect is that the JSON is
   wrong, not that anything crashes.

5. **Expected vs observed**: Expected — the harness reports each real
   Stryker mutation worker's peak RSS (hundreds of MB, matching the
   processes actually doing the mutation testing) regardless of how the
   wrapped command reaches the real `stryker` process. Observed — when the
   wrapped command is invoked the way this project actually invokes Stryker
   everywhere else (`npx stryker run ...` / `npm exec stryker run ...`,
   e.g. `f2b7ffffcb`'s hardener commit message), the harness silently
   samples the intermediate `npm exec` → `sh -c` shell wrapper instead of
   the real workers, because `sampleWorkerChildrenOnce` /
   `listChildPidsReal` (`ps --ppid <parentPid>`) only lists **direct**
   children of the spawned process, never recurses into grandchildren. The
   resulting report (~1MB peak, "recommend 20 workers") is not a measurement
   error at the margins — it is off by roughly 3 orders of magnitude and
   would feed a completely wrong default into the named adaptive-concurrency
   follow-up ticket this ticket exists to inform. Root-cause: the sampler
   needs to walk the full descendant process tree (or otherwise resolve the
   real Stryker parent PID) instead of assuming the spawned command *is*
   the real parent — true only when the wrapped command has no shell/npm/npx
   indirection in front of it, which is not how this project runs Stryker
   anywhere else.
