'use strict';

// BL-1066: step handlers for "a metrics poll tick never stacks on one still
// running".
//
// Every scenario drives the REAL compiled modules - computeMeanTicketTime and
// createMetricsTickGate out of extension/out - against a REAL git repository
// built for the scenario. Nothing here restates what the computation does.
//
// Cost is measured by putting a shim named `git` first on PATH (the extension
// lane's own gitSpawnCounter helper), so what is counted is git PROCESSES,
// not calls through one particular API that a later change could sidestep.
// Reaping is measured on this process's own direct children only, never a
// host-wide process pattern.
//
// The fixture and counting helpers are REQUIRED from extension/test/helpers
// rather than restated here: two copies of "what a closed-ticket corpus looks
// like" could drift into modelling different backlogs, and the lane that
// mattered would be the one that drifted.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { afterEach } = require('node:test');

const EXTENSION_DIR = require('node:path').join(__dirname, '..', '..', '..', 'extension');
const { countGitSpawns } = require(`${EXTENSION_DIR}/test/helpers/gitSpawnCounter`);
const { childPids, childProcesses, defunctChildren } = require(`${EXTENSION_DIR}/test/helpers/childProcesses`);
const {
  buildClosedTicketCorpus,
  TICKET_DURATION_MS,
} = require(`${EXTENSION_DIR}/test/helpers/backlogCorpusFixture`);
const { sweepPendingTmpDirs } = require(`${EXTENSION_DIR}/test/helpers/tmpDir`);
const {
  computeMeanTicketTime,
  computeSwarmMetricsOnTick,
  MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
  MEAN_TICKET_TIME_REFRESH_INTERVAL_MS,
} = require(`${EXTENSION_DIR}/out/metrics/swarmMetrics`);
const { createMetricsTickGate } = require(`${EXTENSION_DIR}/out/metrics/metricsTickGate`);

const FEATURE = 'BL-1066 a metrics poll tick never stacks on one still running';

// Explicit known values per the Scenario Outline handler rule: a corpus size
// the handlers do not know is a hard failure, never a passthrough. 10 is an
// ordinary backlog; 800 is the live corpus that made one computation ~102
// seconds of git.
const KNOWN_CORPUS_SIZES = new Set(['10', '800']);

// The default corpus for a scenario that names no repo of its own (03 opens
// straight on its When).
const DEFAULT_CORPUS_SIZE = 10;

// The extension lane's mkTmpDir records rather than removes; its sweep is
// normally driven by a Vitest setup file, which this lane does not run.
afterEach(() => {
  sweepPendingTmpDirs();
});

function corpusFor(ctx, count) {
  ctx.doneTickets = count;
  ctx.repo = buildClosedTicketCorpus(count, { prefix: 'sfvc-bl1066-acceptance-' });
  return ctx.repo;
}

function ensureRepo(ctx) {
  return ctx.repo || corpusFor(ctx, DEFAULT_CORPUS_SIZE);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // --- scenario 01: a tick arriving mid-computation ---

  // A synchronous computation can only be reached mid-flight from inside its
  // own call stack, so "already in flight" is established by arming a gate
  // whose computation fires the next tick from within itself. That is the
  // real re-entrancy shape, not a simulation of one.
  scoped(/^a metrics computation is already in flight$/, (ctx) => {
    const repo = ensureRepo(ctx);
    ctx.nowMs = 0;
    ctx.gate = createMetricsTickGate({ minIntervalMs: MEAN_TICKET_TIME_REFRESH_INTERVAL_MS, now: () => ctx.nowMs });
    ctx.computationsStarted = 0;
    ctx.gitCallsAtTick = null;
    ctx.tickOutcome = null;

    ctx.armed = () =>
      ctx.gate.run(() => {
        ctx.computationsStarted += 1;
        assert.equal(ctx.gate.isInFlight(), true, 'the gate reported idle while its own computation was running');
        if (ctx.fireTickDuringFlight) {
          ctx.gitCallsBeforeTick = ctx.readGitCalls();
          ctx.tickOutcome = ctx.gate.run(() => {
            ctx.computationsStarted += 1;
            return computeMeanTicketTime(repo);
          });
          ctx.gitCallsAfterTick = ctx.readGitCalls();
        }
        return computeMeanTicketTime(repo);
      });
  });

  scoped(/^the next poll tick fires$/, (ctx) => {
    assert.ok(ctx.armed, 'no computation was armed before the tick fired');
    ctx.fireTickDuringFlight = true;
    const { gitCalls } = countGitSpawns(() => {
      // Readable from inside the in-flight computation: the shim's log is a
      // file, so the count is observable at the instant the tick arrives.
      ctx.readGitCalls = () => readShimLog();
      ctx.armed();
    });
    ctx.gitCalls = gitCalls;
    assert.notEqual(ctx.tickOutcome, null, 'the mid-computation tick never reached the gate');
  });

  scoped(/^no second computation is started$/, (ctx) => {
    assert.equal(
      ctx.tickOutcome,
      'in-flight',
      `a tick arriving mid-computation was told "${ctx.tickOutcome}" instead of being refused`
    );
    assert.equal(
      ctx.computationsStarted,
      1,
      `${ctx.computationsStarted} computations ran where one tick stacked on another would have`
    );
  });

  scoped(/^the number of git children in flight does not increase$/, (ctx) => {
    assert.ok(Array.isArray(ctx.gitCallsBeforeTick), 'the git count was never read at the moment the tick arrived');
    assert.equal(
      ctx.gitCallsAfterTick.length,
      ctx.gitCallsBeforeTick.length,
      `the refused tick still spawned git: ${ctx.gitCallsBeforeTick.length} -> ${ctx.gitCallsAfterTick.length}`
    );
    // And the whole re-entrant episode still cost one walk, not two.
    assert.equal(ctx.gitCalls.length, MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND);
  });

  // --- scenarios 02/03/04: one computation ---

  scoped(/^a target repo with (.+) closed tickets$/, (ctx, count) => {
    assert.ok(
      KNOWN_CORPUS_SIZES.has(count),
      `unknown corpus size "${count}" - the handlers know ${[...KNOWN_CORPUS_SIZES].join(', ')}`
    );
    corpusFor(ctx, Number(count));
  });

  // Scenario 04's corpus is the same builder: every ticket in it was promoted
  // and closed at fixed, known instants, so the durations it should report are
  // known exactly rather than merely plausible.
  scoped(/^a target repo whose closed tickets have known active-to-done durations$/, (ctx) => {
    corpusFor(ctx, DEFAULT_CORPUS_SIZE);
    ctx.knownDurationMs = TICKET_DURATION_MS;
  });

  scoped(/^metrics are computed once$/, (ctx) => {
    const repo = ensureRepo(ctx);
    ctx.childrenBefore = childPids();
    const gate = createMetricsTickGate({ minIntervalMs: MEAN_TICKET_TIME_REFRESH_INTERVAL_MS, now: () => 0 });
    // Through the panel's own entry point, not the bare computation - what
    // the ticket is about is what a TICK costs.
    const { result, gitCalls } = countGitSpawns(() => computeSwarmMetricsOnTick(gate, repo, [], null, 0));
    ctx.metrics = result;
    ctx.gitCalls = gitCalls;
    ctx.childrenAfter = childPids();
    ctx.defunctAfter = defunctChildren();
  });

  scoped(/^the number of git subprocesses spawned stays within the declared bound$/, (ctx) => {
    assert.ok(
      ctx.gitCalls.length <= MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
      `${ctx.doneTickets} closed tickets cost ${ctx.gitCalls.length} git processes, over the declared bound of ${MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND}`
    );
    // A bound met by computing nothing would be no fix at all.
    assert.equal(ctx.metrics.ticketSampleCount, ctx.doneTickets);
  });

  scoped(/^every git child the computation spawned has been reaped$/, (ctx) => {
    assert.ok(ctx.gitCalls.length > 0, 'the computation spawned no git at all - there is nothing to have reaped');
    assert.deepEqual(
      ctx.childrenAfter,
      ctx.childrenBefore,
      `the computation left a surviving child: ${JSON.stringify(childProcesses())}`
    );
  });

  scoped(/^no defunct git process remains$/, (ctx) => {
    assert.deepEqual(ctx.defunctAfter, [], `a defunct child survived the computation: ${JSON.stringify(ctx.defunctAfter)}`);
  });

  scoped(/^the reported mean ticket time matches those known durations$/, (ctx) => {
    assert.equal(ctx.metrics.meanTicketTimeMs, ctx.knownDurationMs);
  });

  scoped(/^the reported sample count matches the number of closed tickets$/, (ctx) => {
    assert.equal(ctx.metrics.ticketSampleCount, ctx.doneTickets);
  });
}

// The counting shim writes one JSON line per git process to the file named by
// its own env var; reading it mid-computation is how scenario 01 observes the
// count at the instant the refused tick arrives.
function readShimLog() {
  const logPath = process.env.SFVC_GIT_SPAWN_LOG;
  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

module.exports = { registerSteps };
