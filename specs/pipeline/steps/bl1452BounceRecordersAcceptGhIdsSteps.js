'use strict';

// BL-1452: step handlers for "The bounce recorders and the sibling checker
// accept GitHub-seeded ticket ids". Every scenario shells out to the REAL
// compiled binaries (record-bounce.js, is_qa_ancestor.sh, qa-sibling-check.js)
// against a real fixture git repository - the recordBounceCli.test.js /
// bl635RecordBounceByRoleSteps.js pattern, never a reimplementation of any
// CLI's own validation or store logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const SWARMFORGE_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge');
const RECORD_BOUNCE_CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');
const QA_SIBLING_CLI = path.join(EXT_DIR, 'out', 'tools', 'qa-sibling-check.js');
const IS_QA_ANCESTOR = path.join(SWARMFORGE_DIR, 'scripts', 'is_qa_ancestor.sh');
const { readBounceRecords } = require(path.join(EXT_DIR, 'out', 'metrics', 'bounceStore'));

const FEATURE = 'BL-1452 The bounce recorders and the sibling checker accept GitHub-seeded ticket ids';

const KNOWN_IDS = new Set(['GH-24', 'BL-1452']);
const KNOWN_MALFORMED = new Set(['24', 'GH24', 'XX-24', 'BL-']);

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function ticketYamlPath(root, ticket) {
  return path.join(root, 'backlog', 'active', `${ticket}-fixture.yaml`);
}

function mkFixtureRepo(ticket) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1452-fixture-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  if (ticket) {
    fs.writeFileSync(ticketYamlPath(root, ticket), `id: ${ticket}\ntitle: "fixture ticket"\nstatus: active\nassigned_to: coder\n`);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed fixture repo');
  return root;
}

// A real, resolvable ten-hex-prefixed commit ON the fixture repo's own
// branch - record-bounce.js's own --commit flag is validated as non-empty
// only, but is_qa_ancestor.sh needs a sha that actually `git rev-parse`s.
function commitOnBranch(root) {
  fs.writeFileSync(path.join(root, 'work.txt'), `work ${Date.now()}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'a commit on the parcel branch');
  return git(root, 'rev-parse', 'HEAD');
}

function runRecordBounce(root, args) {
  const result = spawnSync('node', [RECORD_BOUNCE_CLI, ...args], { cwd: root, encoding: 'utf8' });
  return result;
}

function runQaSiblingCheck(root, args) {
  const result = spawnSync('node', [QA_SIBLING_CLI, ...args], { cwd: root, encoding: 'utf8' });
  return result;
}

function runIsQaAncestor(root, sha) {
  const result = spawnSync('bash', [IS_QA_ANCESTOR, sha], { cwd: root, encoding: 'utf8' });
  return result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^a fixture repository holding an active ticket (\S+) and a ten-hex commit on its branch$/, (ctx, id) => {
    if (!KNOWN_IDS.has(id)) {
      throw new Error(`bl1452: unrecognized <id> example value "${id}"`);
    }
    ctx.ticket = id;
    ctx.root = mkFixtureRepo(id);
    ctx.commit = commitOnBranch(ctx.root);
  });

  scoped(/^record-bounce\.js records a bounce for (\S+) against that commit$/, (ctx, id) => {
    assert.equal(id, ctx.ticket, `expected the Given/When to name the same ticket, got ${id} vs ${ctx.ticket}`);
    ctx.bounceResult = runRecordBounce(ctx.root, [
      '--ticket', ctx.ticket,
      '--role', 'coder',
      '--type', 'defect',
      '--class', 'behavior',
      '--commit', ctx.commit,
      '--by', 'architect',
      '--evidence', `backlog/evidence/${ctx.ticket}-bounce-20260907.md`,
    ]);
    assert.equal(ctx.bounceResult.status, 0, `expected record-bounce.js to succeed for ${ctx.ticket}, got: ${ctx.bounceResult.stdout}${ctx.bounceResult.stderr}`);
  });

  scoped(/^the month's JSONL store gains one record naming (\S+) and the commit$/, (ctx, id) => {
    const records = readBounceRecords(ctx.root).filter((r) => r.ticket === id);
    assert.ok(records.length >= 1, `expected at least one JSONL record for ${id}, got: ${JSON.stringify(readBounceRecords(ctx.root))}`);
    assert.ok(records.some((r) => ctx.commit.startsWith(r.commit) || r.commit.startsWith(ctx.commit.slice(0, r.commit.length))),
      `expected a record naming commit ${ctx.commit}, got: ${JSON.stringify(records)}`);
  });

  scoped(/^the ticket's bounce_history gains one entry naming the commit$/, (ctx) => {
    const yaml = fs.readFileSync(ticketYamlPath(ctx.root, ctx.ticket), 'utf8');
    assert.match(yaml, /bounce_history:/, `expected a bounce_history block, got:\n${yaml}`);
    const shortCommit = ctx.commit.slice(0, 10);
    assert.ok(yaml.includes(shortCommit) || yaml.includes(ctx.commit),
      `expected bounce_history to name the commit ${shortCommit}, got:\n${yaml}`);
  });

  scoped(/^is_qa_ancestor\.sh answers a clean no for that commit$/, (ctx) => {
    const result = runIsQaAncestor(ctx.root, ctx.commit);
    assert.equal(result.status, 1, `expected exit 1 (a clean no), got ${result.status}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /bounced:/, `expected a "bounced:" line naming the bounce, got: ${result.stderr}`);
  });

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  scoped(/^record-bounce\.js is given the ticket id (\S+)$/, (ctx, id) => {
    if (!KNOWN_MALFORMED.has(id)) {
      throw new Error(`bl1452: unrecognized malformed <id> example value "${id}"`);
    }
    ctx.root = mkFixtureRepo();
    ctx.malformedTicket = id;
    ctx.bounceResult = runRecordBounce(ctx.root, [
      '--ticket', id,
      '--role', 'coder',
      '--type', 'defect',
      '--class', 'behavior',
      '--commit', 'abc1234567',
      '--by', 'architect',
    ]);
  });

  scoped(/^it exits non-zero printing the usage$/, (ctx) => {
    assert.notEqual(ctx.bounceResult.status, 0, `expected a non-zero exit for malformed id ${ctx.malformedTicket}`);
    assert.match(ctx.bounceResult.stderr, /^Usage: record-bounce\.js/, `expected the usage text, got: ${ctx.bounceResult.stderr}`);
  });

  scoped(/^no store is written$/, (ctx) => {
    const records = readBounceRecords(ctx.root);
    assert.deepEqual(records, [], `expected no bounce records written for a malformed id, got: ${JSON.stringify(records)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a fixture repository holding an active ticket GH-24$/, (ctx) => {
    ctx.ticket = 'GH-24';
    ctx.root = mkFixtureRepo('GH-24');
  });

  scoped(/^qa-sibling-check\.js status runs for GH-24$/, (ctx) => {
    ctx.statusResult = runQaSiblingCheck(ctx.root, ['status', '--ticket', 'GH-24']);
  });

  scoped(/^it exits zero and prints the ticket's deferral status$/, (ctx) => {
    assert.equal(ctx.statusResult.status, 0, `expected exit 0, got ${ctx.statusResult.status}: ${ctx.statusResult.stdout}${ctx.statusResult.stderr}`);
    assert.match(ctx.statusResult.stdout, /GH-24/, `expected the status output to name GH-24, got: ${ctx.statusResult.stdout}`);
  });
}

module.exports = { registerSteps };
