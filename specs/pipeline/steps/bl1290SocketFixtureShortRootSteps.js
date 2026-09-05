'use strict';

// BL-1290: step handlers for "a socket fixture is rooted short enough to
// bind". Drives the REAL shared modules - lib/socketFixtureRoot.js's
// mkSocketFixtureRoot (BL-948) and lib/socketFixtureRootGuard.js's
// findSocketFixtureRootViolation / scanForSocketFixtureRootViolations -
// never a re-statement of either. Scenario 03 measures the two files this
// ticket converts (bl1112StandingUnitRedsSteps.js,
// bl691AmbulanceWorkflowGapsSteps.js) against the real length limit, per the
// ticket's own approval_context: a green Linux run proves nothing here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach } = require('node:test');
const {
  mkSocketFixtureRoot,
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
} = require('./lib/socketFixtureRoot');
const {
  findSocketFixtureRootViolation,
  scanForSocketFixtureRootViolations,
} = require('./lib/socketFixtureRootGuard');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');

const FEATURE = 'A socket fixture is rooted short enough for the control socket to bind';

// The two call sites this ticket converts (description: "Two step files
// violate it today"), named directly so scenario 03 measures the actual
// converted prefixes rather than a stand-in.
const CONVERTED_PREFIXES = ['bl1112-stryker-', 'bl691-aps-'];

// Scenario Outline <base>/<verdict> validated against explicit lookups (the
// Outline rule: no passthrough/binary checks). Bodies are assembled by
// concatenation so THIS file's own text never contains the contiguous
// os.tmpdir()+socket-reference pattern the gate scans for - the same
// self-reference avoidance bl948SocketFixtureShortRootSteps.js uses.
const BASE_EXAMPLES = {
  'the OS temp directory': {
    body:
      "const root = fs.mkdtempSync(path.join(os." + "tmpdir(), 'gen-'));\n" +
      "fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'x');\n",
  },
  'the short socket-fixture root': {
    body:
      "const root = mkSocketFixtureRoot('gen-');\n" +
      "fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'x');\n",
  },
};

const VERDICT_EXAMPLES = {
  'reported as': true,
  'not reported as': false,
};

function knownBase(token) {
  if (!Object.prototype.hasOwnProperty.call(BASE_EXAMPLES, token)) {
    throw new Error(`unknown <base>: ${token}`);
  }
  return BASE_EXAMPLES[token];
}

function knownVerdict(token) {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_EXAMPLES, token)) {
    throw new Error(`unknown <verdict>: ${token}`);
  }
  return VERDICT_EXAMPLES[token];
}

let trackedRoots = [];
function track(root) {
  trackedRoots.push(root);
  return root;
}

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the socket-fixture scan over specs\/pipeline\/steps$/, (ctx) => {
    ctx.bl1290 = { scanDir: STEPS_DIR };
  });

  // ── Scenario Outline 01 ──────────────────────────────────────────────────
  scoped(/^a step file that builds a control socket rooted at (.+)$/, (ctx, base) => {
    const { body } = knownBase(base);
    const root = track(mkSocketFixtureRoot('bl1290-outline-'));
    ctx.bl1290.genFile = path.join(root, 'generatedSteps.js');
    fs.writeFileSync(ctx.bl1290.genFile, body);
  });

  scoped(/^the guard scans it$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl1290.genFile, 'utf8');
    ctx.bl1290.violation = findSocketFixtureRootViolation(ctx.bl1290.genFile, text);
  });

  scoped(/^the step file is (.+) a violation$/, (ctx, verdictToken) => {
    const expectFlagged = knownVerdict(verdictToken);
    const flagged = Boolean(ctx.bl1290.violation);
    assert.equal(
      flagged,
      expectFlagged,
      `expected flagged=${expectFlagged} for ${ctx.bl1290.genFile}, got: ${JSON.stringify(ctx.bl1290.violation)}`
    );
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^every step file under specs\/pipeline\/steps$/, (ctx) => {
    ctx.bl1290.scanDir = STEPS_DIR;
  });

  scoped(/^the guard scans the tree$/, (ctx) => {
    ctx.bl1290.treeViolations = scanForSocketFixtureRootViolations(ctx.bl1290.scanDir);
  });

  scoped(/^it reports no socket-fixture root violations at all$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1290.treeViolations,
      [],
      `expected zero violations under ${ctx.bl1290.scanDir}, got: ${JSON.stringify(ctx.bl1290.treeViolations)}`
    );
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  // The real converted prefixes, measured against the real limit - not a
  // green Linux run, per the ticket's own approval_context.
  scoped(/^a step file converted to the short socket-fixture root$/, (ctx) => {
    ctx.bl1290.convertedRoots = CONVERTED_PREFIXES.map((prefix) => track(mkSocketFixtureRoot(prefix)));
  });

  scoped(/^its control socket path is measured$/, (ctx) => {
    ctx.bl1290.socketPaths = ctx.bl1290.convertedRoots.map((root) => `${root}${WORST_CASE_SOCKET_SUFFIX}`);
  });

  scoped(/^the path is within the control socket length limit$/, (ctx) => {
    for (const socketPath of ctx.bl1290.socketPaths) {
      assert.ok(
        socketPath.length <= SOCKET_PATH_GUARD_LIMIT,
        `expected ${socketPath} (${socketPath.length} chars) within the ${SOCKET_PATH_GUARD_LIMIT}-char guard`
      );
    }
    assert.equal(ctx.bl1290.socketPaths.length, CONVERTED_PREFIXES.length);
  });
}

module.exports = { registerSteps };
