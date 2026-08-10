'use strict';

// BL-869: step handlers for "A close commit is validated and credited once
// per ticket it closes". Drives REAL production code throughout - no
// mocked git, no mocked guard logic:
//   - scenario 01 calls the real ticket-close-guard-lib/qa-approved-ticket?
//     via `bb -e` (same pattern bl576AgedNoteActionabilitySteps.js already
//     establishes for pure-function pipeline lib calls)
//   - scenarios 02-04 drive the REAL commit_integrity_cli.bb as a
//     subprocess against a real git fixture, same pattern
//     bl419SharedCheckoutCommitIntegritySteps.js and
//     test_commit_integrity_cli.sh already establish
//   - scenario 05 calls the real pipeline-stage-lib/extract-ticket-id
//
// The one substitution: record-lean-ledger!'s own downstream
// (extension/out/tools/lean-ledger-record.js, BL-819's TS ledger writer)
// is stubbed with a tiny fixture script that logs its own invocations -
// BL-819 owns that writer's correctness; this ticket's required_wiring
// only needs record-lean-ledger! to be CALLED once per closed ticket, not
// once per commit, and the stub proves exactly that call pattern without
// standing up BL-819's whole instrument chain.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS_DIR, 'commit_integrity_cli.bb');
const CLOSE_GUARD_LIB = path.join(SCRIPTS_DIR, 'ticket_close_guard_lib.bb');
const PIPELINE_STAGE_LIB = path.join(SCRIPTS_DIR, 'pipeline_stage_lib.bb');

const FEATURE_NAME = 'A close commit is validated and credited once per ticket it closes';

function q(s) {
  return JSON.stringify(s);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function idsFrom(text) {
  return text.split(',').map((s) => s.trim());
}

function ticketFixturePath(id, state) {
  return `backlog/${state}/${id}-fixture.yaml`;
}

function stubLeanLedgerRecorder(root) {
  const dir = path.join(root, 'extension', 'out', 'tools');
  mkdirp(dir);
  const stub = [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const path = require('path');",
    'const args = process.argv.slice(2);',
    'const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };',
    "const ticket = get('--ticket');",
    "const target = get('--target');",
    "fs.appendFileSync(path.join(target, 'lean-ledger-record-calls.jsonl'), JSON.stringify({ ticket, target }) + '\\n');",
    'console.log(JSON.stringify({ ticket, composed: 0, appended: 0, snapshot: null }));',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'lean-ledger-record.js'), stub);
}

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl869-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new'));
  mkdirp(path.join(root, 'architect', '.swarmforge', 'handoffs', 'inbox', 'new'));
  // git mv refuses to create the destination directory - it must already
  // exist before any active -> done move.
  mkdirp(path.join(root, 'backlog', 'done'));
  const rolesTsv = `${[
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    `architect\tarchitect-wt\t${path.join(root, 'architect')}\tswarmforge-architect\tArchitect\tclaude\ttask`,
  ].join('\n')}\n`;
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);
  stubLeanLedgerRecorder(root);
  return root;
}

function writeQaApprovalNote(root, idsText) {
  const ids = idsFrom(idsText);
  const message = `QA approved ${idsText} @ 0bae185f9b, landed on main. Bookkeep all ${ids.length}.`;
  const content = `id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: note\nmessage: ${message}\n\nbody\n`;
  fs.writeFileSync(path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new', '00_qa.handoff'), content);
}

function seedInFlightHandoffs(root, idsText) {
  const ids = idsFrom(idsText);
  const dir = path.join(root, 'architect', '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(dir);
  ids.forEach((id, idx) => {
    const filename = `2${idx}_${id}.handoff`;
    const content = `id: x\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\ntask: ${id}-fixture\ncommit: a1b2c3d4e5\n\nbody\n`;
    fs.writeFileSync(path.join(dir, filename), content);
  });
}

function bbEval(loadPath, expr) {
  const code = `(load-file ${q(loadPath)}) (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function seedActiveTicketsAndCommit(root, ids) {
  for (const id of ids) {
    const rel = ticketFixturePath(id, 'active');
    const abs = path.join(root, rel);
    mkdirp(path.dirname(abs));
    fs.writeFileSync(abs, `id: ${id}\ntitle: fixture\nstatus: active\n`);
    git(root, ['add', '--', rel]);
  }
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `seed ${ids.join(',')}`]);
}

function buildClosePaths(ids, orderText) {
  const active = ids.map((id) => ticketFixturePath(id, 'active'));
  const done = ids.map((id) => ticketFixturePath(id, 'done'));
  if (orderText && orderText.startsWith('interleaved')) {
    assert.equal(ids.length, 2, 'interleaved ordering fixture is only defined for exactly two tickets');
    // First active and first done deliberately name DIFFERENT tickets -
    // the exact shape that used to defeat `(first (filter active))` /
    // `(first (filter done))`'s same-id check (BL-869 fault B).
    return [active[0], active[1], done[1], done[0]];
  }
  const paths = [];
  for (let i = 0; i < ids.length; i += 1) {
    paths.push(active[i], done[i]);
  }
  return paths;
}

function runClose(ctx, idsText, orderText) {
  const ids = idsFrom(idsText);
  seedActiveTicketsAndCommit(ctx.root, ids);
  const paths = buildClosePaths(ids, orderText);
  for (const id of ids) {
    git(ctx.root, ['mv', ticketFixturePath(id, 'active'), ticketFixturePath(id, 'done')]);
  }
  const args = [CLI, ctx.root, '--message', `Close ${idsText}: move to done`];
  for (const p of paths) {
    args.push('--path', p);
  }
  const res = spawnSync('bb', args, { encoding: 'utf8' });
  ctx.closeResult = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  ctx.closedIds = ids;
}

function combined(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(/^a coordinator mailbox holding no handoffs$/, (ctx) => {
    ctx.root = mkFixtureRoot();
  }, FEATURE_NAME);

  // ── Given ────────────────────────────────────────────────────────────
  registry.defineScoped(/^a note from QA to the coordinator approving "([^"]+)"$/, (ctx, idsText) => {
    writeQaApprovalNote(ctx.root, idsText);
  }, FEATURE_NAME);

  registry.defineScoped(/^an in-flight handoff for "([^"]+)"$/, (ctx, idsText) => {
    seedInFlightHandoffs(ctx.root, idsText);
  }, FEATURE_NAME);

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the close guard is asked whether "([^"]+)" is QA-approved$/, (ctx, ticketId) => {
    const out = bbEval(CLOSE_GUARD_LIB, `(boolean (ticket-close-guard-lib/qa-approved-ticket? ${q(ctx.root)} ${q(ticketId)}))`);
    ctx.approved = out === 'true';
  }, FEATURE_NAME);

  registry.defineScoped(
    /^a close commit moves "([^"]+)" from active to done with its paths "([^"]+)"$/,
    (ctx, idsText, orderText) => {
      runClose(ctx, idsText, orderText);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(/^a close commit moves "([^"]+)" from active to done$/, (ctx, idsText) => {
    runClose(ctx, idsText, null);
  }, FEATURE_NAME);

  registry.defineScoped(/^one ticket id is extracted from "([^"]+)"$/, (ctx, text) => {
    ctx.extractedId = bbEval(PIPELINE_STAGE_LIB, `(pipeline-stage-lib/extract-ticket-id ${q(text)})`);
  }, FEATURE_NAME);

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the close guard answers "(yes|no)"$/, (ctx, expected) => {
    assert.equal(ctx.approved, expected === 'yes', `expected the close guard to answer "${expected}", got: ${ctx.approved}`);
  }, FEATURE_NAME);

  registry.defineScoped(/^the close is (allowed|blocked)$/, (ctx, outcome) => {
    const out = combined(ctx.closeResult);
    if (outcome === 'allowed') {
      assert.equal(ctx.closeResult.status, 0, `expected the close to be allowed (exit 0), got exit ${ctx.closeResult.status}: ${out}`);
    } else {
      assert.notEqual(ctx.closeResult.status, 0, `expected the close to be blocked (non-zero exit), got exit 0: ${out}`);
      assert.match(out, /CLOSE BLOCKED/, `expected a CLOSE BLOCKED message, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the close guard reports the closed tickets as "([^"]+)"$/, (ctx, idsText) => {
    const expected = idsFrom(idsText);
    assert.equal(ctx.closeResult.status, 0, `expected the multi-ticket close to succeed, got: ${combined(ctx.closeResult)}`);
    const lastJsonLine = ctx.closeResult.stdout.trim().split('\n').reverse().find((line) => line.startsWith('{'));
    assert.ok(lastJsonLine, `expected a JSON result line, got: ${combined(ctx.closeResult)}`);
    const result = JSON.parse(lastJsonLine);
    assert.equal(result.success, true, `expected success:true, got: ${JSON.stringify(result)}`);
    assert.deepEqual(
      result['closed-ticket-ids'],
      expected,
      `expected closed-ticket-ids to name every closed ticket in order, got: ${JSON.stringify(result)}`,
    );
  }, FEATURE_NAME);

  registry.defineScoped(/^the block reason names "([^"]+)"$/, (ctx, ticketId) => {
    const out = combined(ctx.closeResult);
    assert.ok(out.includes(`CLOSE BLOCKED for ${ticketId}`), `expected the block reason to name ${ticketId}, got: ${out}`);
    for (const otherId of ctx.closedIds.filter((id) => id !== ticketId)) {
      assert.ok(!out.includes(`CLOSE BLOCKED for ${otherId}`), `expected the block reason NOT to also name ${otherId}, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the in-flight handoffs abandoned name "([^"]+)"$/, (ctx, idsText) => {
    const expected = idsFrom(idsText);
    const newDir = path.join(ctx.root, 'architect', '.swarmforge', 'handoffs', 'inbox', 'new');
    const abandonedDir = path.join(ctx.root, 'architect', '.swarmforge', 'handoffs', 'inbox', 'abandoned');
    const remaining = fs.existsSync(newDir) ? fs.readdirSync(newDir) : [];
    assert.equal(remaining.length, 0, `expected no in-flight handoffs left in new/, found: ${remaining.join(', ')}`);
    const abandoned = fs.existsSync(abandonedDir) ? fs.readdirSync(abandonedDir) : [];
    assert.equal(
      abandoned.length,
      expected.length,
      `expected ${expected.length} abandoned handoff(s), found: ${abandoned.join(', ')}`,
    );
    for (const id of expected) {
      assert.ok(abandoned.some((f) => f.includes(id)), `expected an abandoned handoff naming ${id}, found: ${abandoned.join(', ')}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the lifecycle ledger records a close for "([^"]+)"$/, (ctx, idsText) => {
    const expected = idsFrom(idsText);
    const logPath = path.join(ctx.root, 'lean-ledger-record-calls.jsonl');
    assert.ok(fs.existsSync(logPath), `expected the lean-ledger stub to have been invoked, no log at ${logPath}`);
    const recordedIds = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).ticket);
    for (const id of expected) {
      assert.ok(recordedIds.includes(id), `expected record-lean-ledger! to be called for ${id}, calls were: ${JSON.stringify(recordedIds)}`);
    }
    assert.equal(
      recordedIds.length,
      expected.length,
      `expected exactly one ledger call per closed ticket, calls were: ${JSON.stringify(recordedIds)}`,
    );
  }, FEATURE_NAME);

  registry.defineScoped(/^the extracted id is "([^"]+)"$/, (ctx, id) => {
    const expected = id === '(none)' ? 'nil' : q(id);
    assert.equal(ctx.extractedId, expected, `expected extracted id ${expected}, got: ${ctx.extractedId}`);
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
