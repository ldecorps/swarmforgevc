const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { countGitSpawns } = require('./helpers/gitSpawnCounter');
const {
  buildClosedTicketCorpus,
  newRepo,
  git,
  writeTicket,
  move,
  TICKET_DURATION_MS,
} = require('./helpers/backlogCorpusFixture');
const {
  computeMeanTicketTime,
  computeSwarmMetricsOnTick,
  MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
  MEAN_TICKET_TIME_REFRESH_INTERVAL_MS,
} = require('../out/metrics/swarmMetrics');
const { createMetricsTickGate } = require('../out/metrics/metricsTickGate');

// BL-1066: mean ticket time used to shell one `git log --follow` per closed
// ticket - 794 walks, ~102 seconds of git, on a 2-second poll tick. These
// tests pin the two properties the rewrite has to hold: the cost of one
// computation stays a fixed, tiny number of git processes whatever the corpus
// does, and the DURATIONS it reports stay the ones `--follow` was reading.

const HOUR_MS = 60 * 60 * 1000;

test('one computation spawns the same tiny number of git processes whatever the corpus size', () => {
  // Fixtures are built OUTSIDE the counted region - the count must be of the
  // computation's own git, not of the scaffolding that set the corpus up.
  const smallRepo = buildClosedTicketCorpus(3);
  const largeRepo = buildClosedTicketCorpus(40);
  const small = countGitSpawns(() => computeMeanTicketTime(smallRepo));
  const large = countGitSpawns(() => computeMeanTicketTime(largeRepo));

  assert.equal(small.result.sampleCount, 3);
  assert.equal(large.result.sampleCount, 40);
  assert.equal(small.gitCalls.length, large.gitCalls.length);
  assert.ok(
    large.gitCalls.length <= MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
    `expected at most ${MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND} git process(es), got ${large.gitCalls.length}: ${JSON.stringify(large.gitCalls)}`
  );
});

test('a re-open whose commits sit on a merged side branch is still measured from its LAST activation', () => {
  // The shape that broke a naive shared walk on the live repo: the re-open and
  // re-close net out to the tree the mainline already had, so git's default
  // history simplification prunes both commits and the computation silently
  // reports the FIRST cycle instead of the last one.
  const repo = newRepo();
  writeTicket(repo, 'active', 'BL-575.yaml');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'promote BL-575'], '2026-07-25T08:00:00');
  move(repo, 'active', 'done', 'BL-575.yaml');
  git(repo, ['commit', '-q', '-m', 'close BL-575'], '2026-07-25T12:00:00');

  git(repo, ['checkout', '-q', '-b', 'reopen']);
  move(repo, 'done', 'active', 'BL-575.yaml');
  git(repo, ['commit', '-q', '-m', 'reopen BL-575'], '2026-07-25T13:00:00');
  move(repo, 'active', 'done', 'BL-575.yaml');
  git(repo, ['commit', '-q', '-m', 'reclose BL-575'], '2026-07-25T14:00:00');

  git(repo, ['checkout', '-q', 'main']);
  git(repo, ['merge', '-q', '--no-ff', '-m', 'merge reopen', 'reopen'], '2026-07-25T15:00:00');

  const result = computeMeanTicketTime(repo);

  assert.equal(result.sampleCount, 1);
  assert.equal(result.meanMs, 1 * HOUR_MS);
});

test('a ticket re-filed twice INSIDE done/ is still traced back to its activation', () => {
  // The live backlog's own shape: closed flat, then moved under a milestone,
  // then moved again when the milestone was renamed. Two rename hops sit
  // between the file's current path and the commit that activated it.
  //
  // The measured END is the file's LATEST arrival at its current done path -
  // here the milestone rename, not the close. That is the pre-BL-1066
  // semantics exactly (the old per-file `--follow` read the newest arrival at
  // the same path), preserved deliberately: this ticket is about what the
  // computation COSTS, and changing what it means is a separate decision.
  const repo = newRepo();
  writeTicket(repo, 'active', 'BL-019.yaml');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'promote BL-019'], '2026-07-01T08:00:00');
  move(repo, 'active', 'done', 'BL-019.yaml');
  git(repo, ['commit', '-q', '-m', 'close BL-019'], '2026-07-01T13:00:00');
  move(repo, 'done', 'done/M3', 'BL-019.yaml');
  git(repo, ['commit', '-q', '-m', 'file BL-019 under M3'], '2026-07-02T09:00:00');
  move(repo, 'done/M3', 'done/M3-traceability', 'BL-019.yaml');
  git(repo, ['commit', '-q', '-m', 'rename the milestone'], '2026-07-03T09:00:00');

  const result = computeMeanTicketTime(repo);

  assert.equal(result.sampleCount, 1);
  assert.equal(result.meanMs, 49 * HOUR_MS);
});

test('a repo configured with rename detection off still yields durations', () => {
  const repo = buildClosedTicketCorpus(2);
  git(repo, ['config', 'diff.renames', 'false']);

  const result = computeMeanTicketTime(repo);

  assert.equal(result.sampleCount, 2);
  assert.equal(result.meanMs, TICKET_DURATION_MS);
});

test('a ticket COPIED into done and only later deleted from active is still measured from its activation', () => {
  // Not hypothetical: closes done this way appear in the live backlog, and
  // git records them as an Add with no rename to follow back.
  const repo = newRepo();
  writeTicket(repo, 'active', 'BL-027.yaml');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'promote BL-027'], '2026-06-30T08:00:00');

  writeTicket(repo, 'done', 'BL-027.yaml');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'copy BL-027 into done'], '2026-06-30T11:00:00');

  fs.rmSync(path.join(repo, 'backlog', 'active', 'BL-027.yaml'));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'drop the active copy'], '2026-06-30T12:00:00');

  const result = computeMeanTicketTime(repo);

  assert.equal(result.sampleCount, 1);
  assert.equal(result.meanMs, 3 * HOUR_MS);
});

test('a whole refresh interval of ticks walks git once, and the metric is published on every one of them', () => {
  const repo = buildClosedTicketCorpus(3);
  let nowMs = 1_000_000;
  const gate = createMetricsTickGate({
    minIntervalMs: MEAN_TICKET_TIME_REFRESH_INTERVAL_MS,
    now: () => nowMs,
  });

  const ticks = [];
  const { gitCalls } = countGitSpawns(() => {
    // The panel's own 2-second stage poll, run right up to the refresh edge.
    for (let elapsed = 0; elapsed < MEAN_TICKET_TIME_REFRESH_INTERVAL_MS; elapsed += 2000) {
      ticks.push(computeSwarmMetricsOnTick(gate, repo, [], null, nowMs));
      nowMs += 2000;
    }
  });

  assert.ok(ticks.length > 100, `expected the interval to cover many ticks, got ${ticks.length}`);
  assert.equal(gitCalls.length, MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND);
  // Cheap must not mean absent (qa_e2e_procedure step 7): every tick still
  // carries the metric, it is just no longer recomputed on every one.
  for (const metrics of ticks) {
    assert.equal(metrics.meanTicketTimeMs, TICKET_DURATION_MS);
    assert.equal(metrics.ticketSampleCount, 3);
  }
});

test('re-pointing the tick at another repo recomputes at once instead of serving the first repo stale', () => {
  const first = buildClosedTicketCorpus(3);
  const second = buildClosedTicketCorpus(5);
  let nowMs = 1_000_000;
  const gate = createMetricsTickGate({
    minIntervalMs: MEAN_TICKET_TIME_REFRESH_INTERVAL_MS,
    now: () => nowMs,
  });

  const firstMetrics = computeSwarmMetricsOnTick(gate, first, [], null, nowMs);
  nowMs += 2000;
  const secondMetrics = computeSwarmMetricsOnTick(gate, second, [], null, nowMs);

  assert.equal(firstMetrics.ticketSampleCount, 3);
  assert.equal(secondMetrics.ticketSampleCount, 5);
});

test('the tick after the refresh interval elapses walks git again', () => {
  const repo = buildClosedTicketCorpus(2);
  let nowMs = 1_000_000;
  const gate = createMetricsTickGate({
    minIntervalMs: MEAN_TICKET_TIME_REFRESH_INTERVAL_MS,
    now: () => nowMs,
  });

  const { gitCalls } = countGitSpawns(() => {
    computeSwarmMetricsOnTick(gate, repo, [], null, nowMs);
    nowMs += MEAN_TICKET_TIME_REFRESH_INTERVAL_MS;
    computeSwarmMetricsOnTick(gate, repo, [], null, nowMs);
  });

  assert.equal(gitCalls.length, 2 * MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND);
});
