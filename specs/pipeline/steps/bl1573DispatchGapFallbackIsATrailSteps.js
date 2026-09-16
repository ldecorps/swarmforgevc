'use strict';

// BL-1573: step handlers for "the dispatch-gap note fallback is a dispatch
// trail". Drives the REAL pure functions in chase_sweep_lib.bb via `bb -e`
// (BL-1358 shape: in-process/subprocess seconds, never a real swarm) -
// never a reimplementation of dispatch-gap-draft-lines, dispatch-trail-
// ticket-id, dispatch-gap-items or extract-ticket-id.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1573 The dispatch-gap note fallback is a dispatch trail';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHASE_SWEEP_LIB = path.join(SCRIPTS_DIR, 'chase_sweep_lib.bb');
const RUNNER = path.join(SCRIPTS_DIR, 'test', 'dispatch_gap_test_runner.bb');

function bbEval(expr) {
  return execFileSync('bb', ['-e', `(load-file "${CHASE_SWEEP_LIB}") ${expr}`], { encoding: 'utf8' }).trim();
}

// dispatch-gap-draft-lines returns a vector of header-line strings (no
// commit -> the legacy soft-note form). JSON round-trip, never a
// reimplementation of the draft's own field order or content.
function buildDraft(id, assignedTo) {
  const json = bbEval(
    `(println (cheshire.core/generate-string (chase-sweep-lib/dispatch-gap-draft-lines {:id "${id}" :assigned-to "${assignedTo}"})))`
  );
  return JSON.parse(json);
}

function messageValue(draftLines) {
  const line = draftLines.find((l) => l.startsWith('message: '));
  assert.ok(line, `draft has no message: header: ${JSON.stringify(draftLines)}`);
  return line.slice('message: '.length);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the dispatch-gap draft for an active ticket BL-217 assigned to coder is built with no commit$/, (ctx) => {
    ctx.bl1573draft = buildDraft('BL-217', 'coder');
    ctx.bl1573message = messageValue(ctx.bl1573draft);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the dispatch trail predicate reads the draft's message header$/, (ctx) => {
    const out = bbEval(
      `(println (or (chase-sweep-lib/dispatch-trail-ticket-id {:task nil :message ${JSON.stringify(ctx.bl1573message)}}) "nil"))`
    );
    ctx.bl1573trailId = out;
  });

  scoped(/^it answers BL-217$/, (ctx) => {
    assert.equal(ctx.bl1573trailId, 'BL-217', `expected the trail predicate to answer BL-217, got: ${ctx.bl1573trailId}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^that draft sits as the only handoff in the coordinator's outbox$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1573-acceptance-');
    ctx.bl1573root = root;
    const activeDir = path.join(root, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(
      path.join(activeDir, 'BL-217-demo.yaml'),
      'id: BL-217\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n'
    );
    const outboxDir = path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, '00_test.handoff'), `${ctx.bl1573draft.join('\n')}\n\nbody\n`);
    ctx.bl1573activeDir = activeDir;
    ctx.bl1573outboxDir = outboxDir;
  });

  scoped(/^the dispatch-gap sweep lists the tickets needing a route$/, (ctx) => {
    const json = bbEval(
      `(println (cheshire.core/generate-string (mapv :id (chase-sweep-lib/dispatch-gap-items "${ctx.bl1573activeDir}" ["${ctx.bl1573outboxDir}"]))))`
    );
    ctx.bl1573gapIds = JSON.parse(json);
    try {
      releaseSocketFixtureRoot(ctx.bl1573root);
      fs.rmSync(ctx.bl1573root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup, never masks the assertion below
    }
  });

  scoped(/^BL-217 is not listed$/, (ctx) => {
    assert.ok(!ctx.bl1573gapIds.includes('BL-217'), `expected BL-217 to be silenced, still listed: ${JSON.stringify(ctx.bl1573gapIds)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the draft's message header is measured$/, () => {
    // ctx.bl1573message is already set by the Background step; nothing to
    // compute here, mirrors the bl1580/bl1589 pattern of a no-op Given/When
    // that exists so the scenario reads naturally.
  });

  scoped(/^it is at most 80 characters$/, (ctx) => {
    assert.ok(ctx.bl1573message.length <= 80, `message is ${ctx.bl1573message.length} chars, over the 80-char limit: "${ctx.bl1573message}"`);
  });

  scoped(/^extract-ticket-id resolves it to BL-217$/, (ctx) => {
    const out = bbEval(`(println (or (chase-sweep-lib/extract-ticket-id ${JSON.stringify(ctx.bl1573message)}) "nil"))`);
    assert.equal(out, 'BL-217', `expected extract-ticket-id to resolve BL-217, got: ${out}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^swarmforge\/scripts\/test\/dispatch_gap_test_runner\.bb runs$/, (ctx) => {
    const result = require('node:child_process').spawnSync('bb', [RUNNER], { encoding: 'utf8' });
    ctx.bl1573runnerResult = result;
  });

  scoped(/^it exits zero$/, (ctx) => {
    const r = ctx.bl1573runnerResult;
    assert.equal(r.status, 0, `expected the runner to exit 0, got ${r.status}:\n${r.stdout}${r.stderr}`);
  });
}

module.exports = { registerSteps };
