'use strict';

// BL-1602: step handlers for "Acceptance drivers that send a git_handoff
// answer the self-audit challenge". Scenario 01 drives the REAL
// sendGitHandoffTwoCall over an injected fake sender thunk - the helper's
// own contract, isolated. Scenario 02 derives the git_handoff-drafting
// population from the real specs/pipeline/steps tree (the same
// content.includes('swarm_handoff.bb') && content.includes('git_handoff')
// census bl1541GitHandoffRunnersAnswerAuditSteps.js already established for
// its own directory) and checks each of the eleven pinned drivers by name -
// never a passthrough over whatever the scan happens to find. Scenario 03
// reads this ticket's own sweep evidence.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sendGitHandoffTwoCall } = require('./lib/sendGitHandoffTwoCall');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR_REL = 'specs/pipeline/steps';
const STEPS_DIR_ABS = path.join(REPO_ROOT, STEPS_DIR_REL);
const EVIDENCE_PATH = path.join(REPO_ROOT, 'backlog', 'evidence', 'BL-1602-coder-20260916.md');

const FEATURE = 'BL-1602 Acceptance drivers that send a git_handoff answer the self-audit challenge';

// ── Scenario 01: the helper's own contract over a fake sender thunk ────────

const FIRST_AUDIT_REQUIRED = { status: 1, stdout: 'AUDIT_REQUIRED\nHANDOFF_NOT_QUEUED\n', stderr: '' };
const SECOND_QUEUED = { status: 0, stdout: 'HANDOFF DELIVERED:/tmp/second.handoff\n', stderr: '' };
const FIRST_QUEUED = { status: 0, stdout: 'HANDOFF DELIVERED:/tmp/first.handoff\n', stderr: '' };
const FIRST_OTHER_REFUSAL = { status: 2, stdout: '', stderr: 'refused: some other reason\n' };

// Explicit known values per the Scenario Outline handler rule (engineering
// article): each <first>/<returned> is validated against the closed set the
// feature's own Examples use - never a passthrough.
const KNOWN_FIRST = {
  'answers AUDIT_REQUIRED and queues nothing': { first: FIRST_AUDIT_REQUIRED, second: SECOND_QUEUED },
  'queues the draft': { first: FIRST_QUEUED, second: undefined },
  'refuses for a reason other than the audit': { first: FIRST_OTHER_REFUSAL, second: undefined },
};

const KNOWN_RETURNED = {
  "the second call's result": (fixture) => fixture.second,
  "the first call's result, queued": (fixture) => fixture.first,
  "the first call's result, refused": (fixture) => fixture.first,
};

function requireKnown(map, key, label) {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error(`unknown <${label}>: "${key}" - known: ${Object.keys(map).join(' | ')}`);
  }
  return map[key];
}

// ── Scenario 02: population derivation and per-driver answer check ─────────

// Mirrors bl1541GitHandoffRunnersAnswerAuditSteps.js's own census exactly
// (content.includes('swarm_handoff.bb') && content.includes('git_handoff')),
// extended to the two file kinds this directory carries (top-level .js
// drivers, lib/*.sh drivers) - never a second, independently-tuned notion of
// what counts as a git_handoff-drafting driver.
function deriveGitHandoffDrivers(stepsDirAbs) {
  const found = [];
  for (const f of fs.readdirSync(stepsDirAbs)) {
    const full = path.join(stepsDirAbs, f);
    if (!fs.statSync(full).isFile() || !f.endsWith('.js')) continue;
    const content = fs.readFileSync(full, 'utf8');
    if (content.includes('swarm_handoff.bb') && content.includes('git_handoff')) {
      found.push(`${STEPS_DIR_REL}/${f}`);
    }
  }
  const libDirAbs = path.join(stepsDirAbs, 'lib');
  for (const f of fs.readdirSync(libDirAbs)) {
    const full = path.join(libDirAbs, f);
    if (!fs.statSync(full).isFile() || !f.endsWith('.sh')) continue;
    const content = fs.readFileSync(full, 'utf8');
    if (content.includes('swarm_handoff.bb') && content.includes('git_handoff')) {
      found.push(`${STEPS_DIR_REL}/lib/${f}`);
    }
  }
  return found.sort();
}

const KNOWN_DRIVERS = [
  'specs/pipeline/steps/bl1001DifficultyAwareSeatRoutingSteps.js',
  'specs/pipeline/steps/bl1004ReworkClaimSteps.js',
  'specs/pipeline/steps/bl1167SameModelSeatRoutingSteps.js',
  'specs/pipeline/steps/bl1185WorkNoteMissingTaskHeaderSteps.js',
  'specs/pipeline/steps/bl1317AdaptEffortSteps.js',
  'specs/pipeline/steps/bl606RequiredStagesRoutingSteps.js',
  'specs/pipeline/steps/bl623RoutingSkipTrailSteps.js',
  'specs/pipeline/steps/bl983StageQueueSteps.js',
  'specs/pipeline/steps/corruptHandoffNeverDispatchedSteps.js',
  'specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh',
  'specs/pipeline/steps/lib/bl1276AcceptanceExemptionCli.sh',
];

function requireKnownDriver(relPath) {
  if (!KNOWN_DRIVERS.includes(relPath)) {
    throw new Error(`unknown <driver>: "${relPath}" - known: ${KNOWN_DRIVERS.join(' | ')}`);
  }
  return relPath;
}

// A driver answers the audit either by routing through the shared JS
// helper, by the bash send_once idiom (bl1240's own, adopted verbatim), or -
// for a driver that never actually spawns swarm_handoff.bb as a live
// subprocess at all (corruptHandoffNeverDispatchedSteps.js writes a
// deliberately corrupt handoff FILE directly, to exercise handoffd's own
// quarantine, never the sender's audit gate) - by having no audit call site
// to protect in the first place. Exempt by construction, never by omission:
// this still requires proving the absence of a real spawnSync/execFileSync
// call whose script argument is swarm_handoff.bb.
function answersAuditOrUsesHelper(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  const content = fs.readFileSync(abs, 'utf8');
  if (relPath.endsWith('.sh')) {
    return content.includes('send_once') && content.includes('AUDIT_REQUIRED');
  }
  if (content.includes('sendGitHandoffTwoCall')) {
    return true;
  }
  const spawnsSwarmHandoffBb = /spawn(?:Sync)?\(\s*['"]bb['"][\s\S]{0,200}?swarm_handoff\.bb/.test(content);
  return !spawnsSwarmHandoffBb;
}

// ── Scenario 03: the sweep evidence ─────────────────────────────────────

// "green" is a fully clean re-run; "green (audit)" records that this
// ticket's own concern - the driver no longer fails on AUDIT_REQUIRED - is
// resolved, for the one feature (BL-1185) whose single remaining failure is
// a pre-existing, unrelated defect (never audit-related to begin with: its
// own send drafts type: note, which the audit challenge never gates) raised
// separately as its own unowned-red note per the ticket's own instruction
// (never folding a second fix into this parcel).
const SWEEP_ROW = /^\|\s*(BL-\S+)\s*\|\s*(\d+)\s*\|\s*(green(?: \(audit\))?)\s*\|$/gm;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a sender thunk whose first call (.+)$/, (ctx, firstText) => {
    ctx.fixture = requireKnown(KNOWN_FIRST, firstText, 'first');
    ctx.calls = [];
    ctx.spawnFn = (bb, args) => {
      ctx.calls.push({ bb, args });
      if (ctx.calls.length === 1) return ctx.fixture.first;
      if (ctx.calls.length === 2 && ctx.fixture.second !== undefined) return ctx.fixture.second;
      throw new Error(`sender thunk called unexpectedly (call #${ctx.calls.length})`);
    };
  });

  scoped(/^the two-call helper sends one git_handoff draft through it$/, (ctx) => {
    const args = ['swarm_handoff.bb', 'draft.txt'];
    ctx.result = sendGitHandoffTwoCall('bb', args, {}, ctx.spawnFn);
    ctx.sentArgs = args;
  });

  scoped(/^the thunk was called exactly (\d+) times? with the same draft$/, (ctx, callsStr) => {
    const expected = Number(callsStr);
    assert.equal(ctx.calls.length, expected, `expected ${expected} call(s), got ${ctx.calls.length}`);
    for (const call of ctx.calls) {
      assert.equal(call.bb, 'bb');
      assert.deepEqual(call.args, ctx.sentArgs, 'every call must use the identical draft/args');
    }
  });

  scoped(/^the helper returns (.+)$/, (ctx, returnedText) => {
    const resolve = requireKnown(KNOWN_RETURNED, returnedText, 'returned');
    assert.deepEqual(ctx.result, resolve(ctx.fixture));
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^the drivers under "([^"]+)" that draft a git_handoff and invoke swarm_handoff\.bb are derived$/,
    (ctx, dirRel) => {
      assert.equal(dirRel, STEPS_DIR_REL, `unknown <dir>: "${dirRel}" - known: ${STEPS_DIR_REL}`);
      ctx.derived = deriveGitHandoffDrivers(STEPS_DIR_ABS);
    }
  );

  scoped(/^the derived set contains "([^"]+)"$/, (ctx, relPath) => {
    requireKnownDriver(relPath);
    assert.ok(
      ctx.derived.includes(relPath),
      `expected "${relPath}" in the derived set (${ctx.derived.length} entries), got:\n${ctx.derived.join('\n')}`
    );
  });

  scoped(/^"([^"]+)" sends through the two-call helper or answers AUDIT_REQUIRED itself$/, (ctx, relPath) => {
    requireKnownDriver(relPath);
    assert.ok(answersAuditOrUsesHelper(relPath), `"${relPath}" neither routes through the shared helper nor exempts itself`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the parcel's evidence for the sweep is read$/, (ctx) => {
    assert.ok(fs.existsSync(EVIDENCE_PATH), `evidence file not found: ${EVIDENCE_PATH}`);
    ctx.evidenceText = fs.readFileSync(EVIDENCE_PATH, 'utf8');
  });

  scoped(/^it lists exactly (\d+) features? with a pre-fix failing-step count and a post-fix green run each$/, (ctx, countStr) => {
    const expected = Number(countStr);
    SWEEP_ROW.lastIndex = 0;
    const rows = [];
    let m;
    while ((m = SWEEP_ROW.exec(ctx.evidenceText)) !== null) {
      rows.push({ feature: m[1], preFixFailingSteps: Number(m[2]), postFixRun: m[3] });
    }
    assert.equal(rows.length, expected, `expected ${expected} sweep rows, found ${rows.length}:\n${JSON.stringify(rows, null, 2)}`);
    for (const row of rows) {
      assert.ok(row.preFixFailingSteps > 0, `${row.feature}: pre-fix failing-step count must be > 0`);
      assert.ok(row.postFixRun.startsWith('green'), `${row.feature}: post-fix run must read "green" (or "green (audit)")`);
    }
  });
}

module.exports = { registerSteps };
