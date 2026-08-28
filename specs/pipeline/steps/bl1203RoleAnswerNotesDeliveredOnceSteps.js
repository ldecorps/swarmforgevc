'use strict';

// BL-1203: step handlers for "an answered question reaches a role once,
// and an answer pointer names that answer". Drives the REAL
// enqueueRoleAnswerNote (extension/src/tools/telegram-front-desk-bot.ts,
// compiled) against a real fixture git repo + roles.tsv, same discipline
// as bl1181BobStartingCastSteps.js - never a reimplementation of the
// function under test.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  enqueueRoleAnswerNote,
  roleAnswerFilePointerPath,
} = require('../../../extension/out/tools/telegram-front-desk-bot');
const { copyLiveScriptClosureInto } = require('../../../extension/test/helpers/pinnedRepoFixture');

const FEATURE = 'an answered question reaches a role once, and an answer pointer names that answer';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Mirrors telegramFrontDeskBotCli.test.js's own swarmHandoffFixture(): a
// real git repo + roles.tsv, plus the real swarm_handoff.bb + its
// dependency closure copied in (never the whole swarmforge/scripts tree -
// same BL-1038 discipline as that file).
function buildFixtureRoot() {
  const root = mkTmp('bl1203-acceptance-');
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1203@example.com']);
  git(root, ['config', 'user.name', 'bl1203']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);

  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['swarm_handoff.bb']);

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const tsv = [
    ['specifier', 'session', root, 'swarmforge-specifier', 'specifier', 'claude', 'task'].join('\t'),
    ['coordinator', 'session', root, 'swarmforge-coordinator', 'coordinator', 'claude', 'task'].join('\t'),
  ].join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${tsv}\n`);
  return root;
}

function outboxFileCount(ctx) {
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'outbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

function registerSteps(registry) {
  scoped(registry, /^an inbound answer for a role has already been delivered as a note$/, async (ctx) => {
    ctx.root = buildFixtureRoot();
    ctx.role = 'specifier';
    ctx.updateId = 12345;
    ctx.text = 'use staging please';
    const ok = await enqueueRoleAnswerNote(ctx.root, ctx.role, ctx.text, ctx.updateId);
    assert.equal(ok, true, 'the first delivery must succeed to set up this scenario');
    ctx.countAfterFirstDelivery = outboxFileCount(ctx);
    assert.equal(ctx.countAfterFirstDelivery, 1, 'expected exactly one note queued for the first delivery');
  });

  scoped(registry, /^the same inbound answer is processed again$/, async (ctx) => {
    ctx.reprocessOk = await enqueueRoleAnswerNote(ctx.root, ctx.role, ctx.text, ctx.updateId);
  });

  scoped(registry, /^the role's inbox gains no further note for that answer$/, (ctx) => {
    assert.equal(ctx.reprocessOk, true, 're-processing an already-captured answer must still report success');
    assert.equal(
      outboxFileCount(ctx),
      ctx.countAfterFirstDelivery,
      'the outbox must gain no additional note when the same inbound answer is re-processed'
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  scoped(registry, /^a role answer too long to carry inline$/, (ctx) => {
    ctx.root = buildFixtureRoot();
    ctx.role = 'specifier';
    ctx.updateId = 99;
    ctx.text = 'please use the staging environment for this deploy, not production, since we are still validating the migration'.repeat(2);
    assert.ok(ctx.text.length > 80, 'fixture must reproduce the over-the-cap case');
  });

  scoped(registry, /^the answer is delivered as a pointer note$/, async (ctx) => {
    ctx.deliverOk = await enqueueRoleAnswerNote(ctx.root, ctx.role, ctx.text, ctx.updateId);
  });

  scoped(registry, /^the file the note names holds that answer$/, (ctx) => {
    assert.equal(ctx.deliverOk, true);
    const stored = JSON.parse(fs.readFileSync(path.join(ctx.root, roleAnswerFilePointerPath(ctx.role)), 'utf8'));
    assert.equal(stored.text, ctx.text, 'the file the note points at must hold the exact answer the note announces');
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
