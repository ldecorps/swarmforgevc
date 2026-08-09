const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-643 hardening pass: the two property tests already cover the checker
// functions against every row the real reference table contains, but a
// handful of guard clauses in the step-handler module only fire on a
// MALFORMED input (a repo drift, a blank cell) that the real table never
// has - so they have no coverage from either property test or the
// acceptance run. Each one here is a real invariant this ticket's own
// scope cares about (an agent silently omitted, a path recalled instead
// of checked), not incidental code.
const {
  discoverNonPipelineAgents,
  extractLinkTargets,
  extractBacktickSpans,
  isDeliberatelyAbsent,
  resolveDocLink,
  checkPathColumn,
  REF_TABLE_PATH,
} = require('../../specs/pipeline/steps/bl643NonPipelineAgentsSteps');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const BABYSITTER_LAUNCHER = path.join(SCRIPTS_DIR, 'start_babysitterd.sh');

let readdirSpy;
let existsSpy;

afterEach(() => {
  readdirSpy?.mockRestore();
  existsSpy?.mockRestore();
  readdirSpy = undefined;
  existsSpy = undefined;
});

test('discoverNonPipelineAgents throws when a launch_*.sh script has no known agent-name mapping', () => {
  const realReaddirSync = fs.readdirSync;
  readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((dir, ...rest) => {
    const real = realReaddirSync(dir, ...rest);
    if (dir === SCRIPTS_DIR) {
      return [...real, 'launch_ghost_agent.sh'];
    }
    return real;
  });
  assert.throws(
    () => discoverNonPipelineAgents(),
    /found launch_\*\.sh script\(s\) with no known agent-name mapping.*launch_ghost_agent\.sh/,
    'an unmapped launch_*.sh script should be surfaced, not silently dropped from the enumeration'
  );
});

test('discoverNonPipelineAgents throws when an irregular agent names a launcher that does not exist', () => {
  const realExistsSync = fs.existsSync;
  existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    if (p === BABYSITTER_LAUNCHER) {
      return false;
    }
    return realExistsSync(p);
  });
  assert.throws(
    () => discoverNonPipelineAgents(),
    /irregular-launch agent "Babysitter" names a launcher that does not exist/,
    'a stale irregular-launcher path should fail loudly, not be recalled as still valid'
  );
});

test('extractLinkTargets returns real link targets and excludes anchor-only ("#...") links', () => {
  assert.deepEqual(
    extractLinkTargets('[a](./real/path.sh) and [b](#some-anchor) and [c](../other.md#frag)'),
    ['./real/path.sh', '../other.md#frag']
  );
  assert.deepEqual(extractLinkTargets('no links here'), []);
});

test('extractBacktickSpans returns every backtick-delimited span in order', () => {
  assert.deepEqual(extractBacktickSpans('`.swarmforge/operator/runtime.log` and also `foo.log`'), [
    '.swarmforge/operator/runtime.log',
    'foo.log',
  ]);
  assert.deepEqual(extractBacktickSpans('no backticks here'), []);
});

test('isDeliberatelyAbsent recognizes only the "— none —" convention', () => {
  assert.equal(isDeliberatelyAbsent('— none —'), true);
  assert.equal(isDeliberatelyAbsent('[`x`](./x.sh)'), false);
  assert.equal(isDeliberatelyAbsent(''), false);
});

test('resolveDocLink resolves relative to the reference table\'s own directory and strips any fragment', () => {
  const resolved = resolveDocLink('../../swarmforge/scripts/support_runtime.bb#anchor');
  assert.equal(resolved, path.resolve(path.dirname(REF_TABLE_PATH), '../../swarmforge/scripts/support_runtime.bb'));
});

test('checkPathColumn throws when a cell names no path and is not marked "— none —"', () => {
  assert.throws(
    () => checkPathColumn({ Agent: 'Fixture Agent', Launcher: 'unknown, not a link, not the deliberate-absence marker' }, 'Launcher'),
    /names no resolvable path and is not marked/,
    'a blank/malformed cell must not silently pass as "deliberately absent"'
  );
});
