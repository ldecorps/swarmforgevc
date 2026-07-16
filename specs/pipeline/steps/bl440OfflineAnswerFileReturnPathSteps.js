'use strict';

// BL-440: step handlers for "The human answers the swarm offline via
// committed ANSWER files, gated on a live premise". Drives the REAL
// compiled drain-answer-files.js against a real git repo fixture - the
// archive move is a real commit and the routing is a real
// blTopicStore.ts append, never fakes standing in for either (mirrors
// negotiate-onboarding-contract's own real-git-fixture convention).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { drainAnswerFiles } = require(path.join(EXT_DIR, 'out', 'tools', 'drain-answer-files'));
const { readRecord } = require(path.join(EXT_DIR, 'out', 'concierge', 'blTopicStore'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const TICKET_ID = 'BL-100';

function writeTicket(repoRoot, folder, id, status) {
  const dir = path.join(repoRoot, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}-fixture.yaml`);
  fs.writeFileSync(filePath, `id: ${id}\nstatus: ${status}\ntitle: "fixture"\n`);
  execFileSync('git', ['-C', repoRoot, 'add', '--', filePath]);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'fixture ticket'], { cwd: repoRoot });
}

function writeAnswerFile(repoRoot, content) {
  fs.mkdirSync(path.join(repoRoot, 'backlog'), { recursive: true });
  const filePath = path.join(repoRoot, 'backlog', 'ANSWER-2026-07-15.md');
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['-C', repoRoot, 'add', '--', filePath]);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'human answer'], { cwd: repoRoot });
  return filePath;
}

// BL-440 offline-answer-file-return-path-02 (Scenario Outline): an explicit
// KNOWN_VALUES lookup per the engineering article's own Scenario Outline
// rule - each example row gets its OWN real, distinct fixture setup, all of
// which the production checkPremiseLive gate correctly reports as
// not-live, rather than a bare passthrough/ternary a mutated example value
// could slip through undetected.
const DRIFT_FIXTURES = new Map([
  ['already shipped', (ctx) => writeTicket(ctx.repoRoot, 'done', TICKET_ID, 'done')],
  ['its question retracted', () => {
    /* no ticket file written anywhere - a withdrawn/never-materialized reference */
  }],
  ['its decision superseded', (ctx) => writeTicket(ctx.repoRoot, 'active', TICKET_ID, 'done')],
]);

function knownDriftFixture(drift) {
  if (!DRIFT_FIXTURES.has(drift)) {
    throw new Error(`bl440-offline-answer-file-return-path: unrecognized <drift> example value "${drift}"`);
  }
  return DRIFT_FIXTURES.get(drift);
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^an ANSWER-\*\.md file committed at the backlog root referencing an ask or ticket$/, (ctx) => {
    ctx.repoRoot = mkTmp('bl440-acceptance-');
    execFileSync('git', ['init'], { cwd: ctx.repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ctx.repoRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: ctx.repoRoot });
    // The actual answer file content/reference is finalized by each
    // scenario's own more specific Given step below - the Background only
    // establishes the repo itself.
  });

  function drain(ctx) {
    ctx.results = drainAnswerFiles(ctx.repoRoot);
    ctx.result = ctx.results[0];
  }

  // ── offline-answer-file-return-path-01 ──────────────────────────────
  registry.define(/^the referenced ask is still open and its premise is unchanged$/, (ctx) => {
    writeTicket(ctx.repoRoot, 'active', TICKET_ID, 'todo');
    ctx.answerPath = writeAnswerFile(ctx.repoRoot, `Re ${TICKET_ID}: yes, go ahead with the plan as proposed.\n`);
  });
  registry.define(/^the swarm drains the answer file$/, (ctx) => drain(ctx));
  registry.define(/^the answer is routed to the referenced ask$/, (ctx) => {
    const record = readRecord(ctx.repoRoot, TICKET_ID);
    assert.equal(record.messages.length, 1, `expected the answer routed as a topic message, got: ${JSON.stringify(record)}`);
    assert.equal(record.messages[0].type, 'inbound');
    assert.match(record.messages[0].text, /go ahead with the plan/);
  });
  registry.define(/^it is acted on$/, (ctx) => {
    assert.equal(ctx.result.disposition, 'acted-on', `expected disposition acted-on, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── offline-answer-file-return-path-02 (Outline) ────────────────────
  registry.define(/^the referenced ticket has "([^"]+)"$/, (ctx, drift) => {
    knownDriftFixture(drift)(ctx);
    ctx.answerPath = writeAnswerFile(ctx.repoRoot, `Re ${TICKET_ID}: please proceed with the change.\n`);
    ctx.expectedDrift = drift;
  });
  registry.define(/^the answer is not acted on$/, (ctx) => {
    assert.notEqual(ctx.result.disposition, 'acted-on', `expected the answer NOT acted on, got: ${JSON.stringify(ctx.result)}`);
    const record = readRecord(ctx.repoRoot, TICKET_ID);
    assert.ok(
      !record.messages.some((m) => m.type === 'inbound'),
      `expected no inbound message ever recorded for a not-live premise, got: ${JSON.stringify(record.messages)}`
    );
  });
  registry.define(/^an "arrived late, not executed" report names what changed$/, (ctx) => {
    assert.equal(ctx.result.disposition, 'arrived-late');
    assert.match(ctx.result.report, /arrived late, not executed/);
    assert.ok(ctx.result.report.length > 'arrived late, not executed - '.length, `expected the report to name what changed, got: ${ctx.result.report}`);
  });

  // ── offline-answer-file-return-path-03 ──────────────────────────────
  registry.define(/^the referenced ask is still open$/, (ctx) => {
    writeTicket(ctx.repoRoot, 'active', TICKET_ID, 'todo');
    ctx.answerPath = writeAnswerFile(ctx.repoRoot, `Re ${TICKET_ID}: approved, please proceed.\n`);
  });
  registry.define(/^the swarm has drained the answer file$/, (ctx) => drain(ctx));
  registry.define(/^the answer file is moved to the archive$/, (ctx) => {
    const archivedPath = path.join(ctx.repoRoot, 'backlog', 'answers-archive', path.basename(ctx.answerPath));
    assert.ok(fs.existsSync(archivedPath), `expected the answer file in the archive, got nothing at ${archivedPath}`);
  });
  registry.define(/^it is not deleted$/, (ctx) => {
    const archivedPath = path.join(ctx.repoRoot, 'backlog', 'answers-archive', path.basename(ctx.answerPath));
    assert.match(fs.readFileSync(archivedPath, 'utf8'), /go ahead with the plan|please proceed/);
  });

  // ── offline-answer-file-return-path-04 ──────────────────────────────
  registry.define(/^the answer omits some optional fields but carries a resolvable reference and the human's words$/, (ctx) => {
    writeTicket(ctx.repoRoot, 'active', TICKET_ID, 'todo');
    // No header/field syntax at all - just prose mentioning the ticket, the
    // exact "composed on a plane" shape the ticket's own schema note names.
    ctx.answerPath = writeAnswerFile(ctx.repoRoot, `hey about ${TICKET_ID} - lets just do the simple thing\n`);
  });
  registry.define(/^the referenced ask is resolved from the answer$/, (ctx) => {
    assert.equal(ctx.result.reference, TICKET_ID, `expected the reference resolved despite the missing optional fields, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── offline-answer-file-return-path-05 ──────────────────────────────
  registry.define(/^the answer references an ask or ticket that cannot be resolved$/, (ctx) => {
    ctx.answerPath = writeAnswerFile(ctx.repoRoot, 'Sounds good, please go ahead with what we discussed.\n');
  });
  registry.define(/^the answer is surfaced as unresolved$/, (ctx) => {
    assert.equal(ctx.result.disposition, 'unresolved', `expected disposition unresolved, got: ${JSON.stringify(ctx.result)}`);
  });
  registry.define(/^it is not silently dropped$/, (ctx) => {
    assert.ok(ctx.result.report && ctx.result.report.length > 0, 'expected a non-empty surfaced report');
    // BL-311's own "still there means undrained" signal - never archived or
    // deleted when nothing could even be resolved.
    assert.ok(fs.existsSync(ctx.answerPath), 'expected the unresolved answer file left in place at the backlog root');
  });
}

module.exports = { registerSteps };
