const assert = require('node:assert/strict');
const { MutationProgressReporter } = require('../out/mutation/mutationProgressReporter');

const START = new Date('2026-07-09T12:00:00Z').getTime();

function fakeDeps(overrides = {}) {
  const writes = [];
  return {
    writes,
    deps: {
      now: () => START,
      role: 'coder',
      filePath: '/fake/coder.json',
      write: (filePath, record) => writes.push({ filePath, record }),
      mutateFile: 'src/foo.ts',
      ...overrides,
    },
  };
}

function planReadyEvent(runPlanCount, earlyResultCount = 0) {
  const mutantPlans = [
    ...Array.from({ length: runPlanCount }, () => ({ plan: 'Run' })),
    ...Array.from({ length: earlyResultCount }, () => ({ plan: 'EarlyResult' })),
  ];
  return { mutantPlans };
}

test('onMutationTestingPlanReady writes an initial record with total = only Run-plan mutants', () => {
  const { deps, writes } = fakeDeps();
  const reporter = new MutationProgressReporter(deps);
  reporter.onMutationTestingPlanReady(planReadyEvent(5, 2));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, '/fake/coder.json');
  assert.equal(writes[0].record.total, 5);
  assert.equal(writes[0].record.tested, 0);
  assert.equal(writes[0].record.status, 'running');
  assert.equal(writes[0].record.file, 'src/foo.ts');
});

test('onMutantTested writes an updated record each time a mutant finishes', () => {
  const { deps, writes } = fakeDeps({ now: () => START + 1000 });
  const reporter = new MutationProgressReporter(deps);
  reporter.onMutationTestingPlanReady(planReadyEvent(2));
  reporter.onMutantTested({ status: 'Survived' });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].record.tested, 1);
  assert.equal(writes[1].record.survived, 1);
  assert.equal(writes[1].record.percent, 50);
});

test('onMutantTested before a plan is ready is a no-op (no crash, no write)', () => {
  const { deps, writes } = fakeDeps();
  const reporter = new MutationProgressReporter(deps);
  assert.doesNotThrow(() => reporter.onMutantTested({ status: 'Killed' }));
  assert.equal(writes.length, 0);
});

test('onMutationTestReportReady writes a final record with status done', () => {
  const { deps, writes } = fakeDeps();
  const reporter = new MutationProgressReporter(deps);
  reporter.onMutationTestingPlanReady(planReadyEvent(1));
  reporter.onMutantTested({ status: 'Killed' });
  reporter.onMutationTestReportReady();
  assert.equal(writes.length, 3);
  assert.equal(writes[2].record.status, 'done');
  assert.equal(writes[2].record.tested, 1);
});

test('onMutationTestReportReady before any plan is ready is a no-op', () => {
  const { deps, writes } = fakeDeps();
  const reporter = new MutationProgressReporter(deps);
  assert.doesNotThrow(() => reporter.onMutationTestReportReady());
  assert.equal(writes.length, 0);
});

test('defaults role from SWARMFORGE_ROLE and resolves the standard path when not overridden', () => {
  const previous = process.env.SWARMFORGE_ROLE;
  process.env.SWARMFORGE_ROLE = 'hardender';
  try {
    const writes = [];
    const reporter = new MutationProgressReporter({ now: () => START, write: (fp, r) => writes.push({ fp, r }) });
    reporter.onMutationTestingPlanReady(planReadyEvent(1));
    assert.equal(writes.length, 1);
    assert.match(writes[0].fp, /\.swarmforge[\\/]mutation-progress[\\/]hardender\.json$/);
  } finally {
    if (previous === undefined) {
      delete process.env.SWARMFORGE_ROLE;
    } else {
      process.env.SWARMFORGE_ROLE = previous;
    }
  }
});
