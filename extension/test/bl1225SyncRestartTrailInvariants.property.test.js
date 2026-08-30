const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1225 declared invariants:
// 1. No sync-initiated restart discards log lines written before it.
// 2. A daemon start is attributed to build-freshness in the start audit if
//    and only if a sync initiated it.
//
// Both are properties of shell/Babashka behaviour, so each case drives the
// REAL production artefacts: build_freshness_lib.bb's own spawn-options for
// invariant 1, and the REAL start_handoff_daemon.sh for invariant 2. No
// re-declaration of either.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'build_freshness_lib.bb');
const START_DAEMON = path.join(SCRIPTS, 'start_handoff_daemon.sh');
const CALLER = 'build_freshness_cli';

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1225-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Log content that a restart must not discard. Deliberately includes the
// empty file and multi-line content: "appends" and "truncates" agree on an
// empty prior log, so a generator that only ever drew empty content would
// pass against the defect.
const PRIOR_LOG = () =>
  fc.oneof(
    { arbitrary: fc.constant(''), weight: 1 },
    {
      arbitrary: fc
        .array(fc.stringMatching(/^[A-Za-z0-9 _.:-]{1,40}$/), { minLength: 1, maxLength: 6 })
        .map((lines) => `${lines.join('\n')}\n`),
      weight: 6,
    }
  );

const NEW_OUTPUT = () => fc.stringMatching(/^[A-Za-z0-9_.:-]{1,30}$/);

// Spawns a trivial command through the PRODUCTION spawn options, so what is
// under test is build_freshness_lib.bb's own opts map, not a copy of it.
function spawnThroughProductionOpts(root, logFile, line) {
  const script = `
(require '[babashka.fs :as fs] '[babashka.process :as process])
(load-file ${JSON.stringify(LIB)})
(let [opts (build-freshness-lib/operator-log-spawn-opts ${JSON.stringify(logFile)} ${JSON.stringify(root)})]
  @(process/process opts "bash" "-c" ${JSON.stringify(`printf '%s\\n' ${JSON.stringify(line)}`)}))
`;
  return spawnSync('bb', ['-e', script], { encoding: 'utf8', cwd: root });
}

test('property (invariant 1): a sync-initiated restart never discards a log line written before it', () => {
  let emptyPrior = 0;
  let nonEmptyPrior = 0;
  fc.assert(
    fc.property(PRIOR_LOG(), NEW_OUTPUT(), (prior, line) => {
      if (prior === '') emptyPrior += 1;
      else nonEmptyPrior += 1;
      withRoot((root) => {
        const logFile = path.join(root, 'runtime.log');
        fs.writeFileSync(logFile, prior);
        const result = spawnThroughProductionOpts(root, logFile, line);
        assert.equal(result.status, 0, `bb spawn failed: ${result.stderr}`);
        const after = fs.readFileSync(logFile, 'utf8');
        assert.ok(
          after.startsWith(prior),
          `the restart discarded earlier log content.\nbefore: ${JSON.stringify(prior)}\nafter:  ${JSON.stringify(after)}`
        );
        assert.ok(
          after.includes(line),
          `the replacement's own output is missing: ${JSON.stringify(after)}`
        );
        assert.ok(after.length > prior.length, 'nothing was appended at all');
      });
    }),
    { numRuns: 24 }
  );
  assert.ok(nonEmptyPrior > 0, 'generator never produced a non-empty prior log - the only case that can detect truncation');
  assert.ok(emptyPrior > 0, 'generator never produced the empty prior log');
});

test('property (invariant 1): repeated restarts keep growing the log rather than resetting it', () => {
  let cases = 0;
  fc.assert(
    fc.property(fc.array(NEW_OUTPUT(), { minLength: 2, maxLength: 4 }), (lines) => {
      cases += 1;
      withRoot((root) => {
        const logFile = path.join(root, 'runtime.log');
        fs.writeFileSync(logFile, 'PRE-EXISTING\n');
        let previousLength = fs.statSync(logFile).size;
        for (const line of lines) {
          const result = spawnThroughProductionOpts(root, logFile, line);
          assert.equal(result.status, 0, `bb spawn failed: ${result.stderr}`);
          const size = fs.statSync(logFile).size;
          assert.ok(size > previousLength, 'the log shrank or reset across restarts');
          previousLength = size;
        }
        const after = fs.readFileSync(logFile, 'utf8');
        assert.ok(after.startsWith('PRE-EXISTING\n'), 'the original line was lost after repeated restarts');
        for (const line of lines) {
          assert.ok(after.includes(line), `a restart's own output is missing: ${line}`);
        }
      });
    }),
    { numRuns: 8 }
  );
  assert.ok(cases > 0);
});

// A start is either sync-initiated (the env build_freshness_lib.bb hands to
// the script) or it is not. Both branches must be reached: an "if and only
// if" that only ever generates one side proves half of itself.
const START_KIND = () =>
  fc.constantFrom('sync', 'direct', 'other-caller');

function startDaemon(root, kind) {
  const stub = path.join(root, 'stub.bb');
  fs.writeFileSync(stub, '#!/usr/bin/env bb\n(System/exit 0)\n', { mode: 0o755 });
  const env = {
    ...process.env,
    HANDOFFD_BB: stub,
    HANDOFFD_SUPERVISOR_BB: stub,
    PID_WAIT_ATTEMPTS: '1',
  };
  delete env.SWARMFORGE_DAEMON_START_CALLER;
  if (kind === 'sync') {
    // The value the sync itself sets, read from the production lib rather
    // than hardcoded here.
    env.SWARMFORGE_DAEMON_START_CALLER = syncCaller();
  } else if (kind === 'other-caller') {
    env.SWARMFORGE_DAEMON_START_CALLER = 'some_other_entry_point';
  }
  spawnSync('bash', [START_DAEMON, root], { encoding: 'utf8', env, cwd: root });
  const auditPath = path.join(root, '.swarmforge', 'daemon', 'daemon-start-audit.log');
  return fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';
}

let cachedCaller;
function syncCaller() {
  if (cachedCaller === undefined) {
    const result = spawnSync(
      'bb',
      ['-e', `(load-file ${JSON.stringify(LIB)}) (print build-freshness-lib/daemon-start-caller)`],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, `could not read the sync caller from the lib: ${result.stderr}`);
    cachedCaller = result.stdout.trim();
  }
  return cachedCaller;
}

test('property (invariant 2): the audit names build-freshness if and only if a sync initiated the start', () => {
  const seen = { sync: 0, direct: 0, 'other-caller': 0 };
  fc.assert(
    fc.property(START_KIND(), (kind) => {
      seen[kind] += 1;
      withRoot((root) => {
        const audit = startDaemon(root, kind);
        const startLine = audit
          .split('\n')
          .find((l) => l.includes('start_handoff_daemon invoked'));
        assert.ok(startLine, `no start-audit line was written for a ${kind} start: ${JSON.stringify(audit)}`);
        assert.equal(
          startLine.includes(`caller=${CALLER}`),
          kind === 'sync',
          `a ${kind} start was attributed wrongly: ${startLine}`
        );
        if (kind === 'direct') {
          assert.match(startLine, /caller=unknown/, `an unattributed start lost its fallback: ${startLine}`);
        }
      });
    }),
    { numRuns: 18 }
  );
  for (const kind of Object.keys(seen)) {
    assert.ok(seen[kind] > 0, `generator never reached a ${kind} start: ${JSON.stringify(seen)}`);
  }
  assert.equal(syncCaller(), CALLER, 'the lib and this test disagree on the caller label');
});
