'use strict';

// BL-1405: step handlers for "a hand-built land records its land
// approval". Drives the REAL record_land_approval.bb CLI and the REAL
// is_qa_ancestor.sh predicate against a real throwaway git fixture - the
// same "shell out to the real script" convention this guard family's
// other acceptance handlers use, since the defect (no CLI reachable to
// call the land step's own writer) lives entirely in that missing
// wiring, not in anything a reimplementation could stand in for.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1405 A hand-built land records its land approval';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'record_land_approval.bb');
const PREDICATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'is_qa_ancestor.sh');

function git(root, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function verdict(root, sha) {
  const r = spawnSync('bash', [PREDICATE, sha], { cwd: root, encoding: 'utf8' });
  return r.status;
}

function runCli(root, args) {
  const r = spawnSync('bb', [CLI, root, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function ensureState(ctx) {
  if (!ctx.bl1405) {
    const root = mkProcessTmpDir('bl1405acc-');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'approved parcel work']);
    const source = git(root, ['rev-parse', 'HEAD']);
    git(root, ['branch', 'swarmforge-QA']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'hand-built replay']);
    const replay = git(root, ['rev-parse', 'HEAD']);
    ctx.bl1405 = { root, source, replay };
  }
  return ctx.bl1405;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a QA ref, an approved source commit, and a hand-built replay of it on main$/, (ctx) => {
    ensureState(ctx);
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the approval predicate answers no for the replay$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(verdict(st.root, st.replay), 1, 'expected the fixture replay to genuinely read unapproved before recording');
  });

  scoped(/^the land-approval CLI records the replay against the source for ticket "([^"]+)"$/, (ctx, ticket) => {
    const st = ensureState(ctx);
    st.result = runCli(st.root, [st.replay, st.source, ticket]);
    assert.equal(st.result.status, 0, `expected the CLI to succeed: ${st.result.out}`);
  });

  scoped(/^the shared land-approval store gains one line naming the replay, the source and the ticket$/, (ctx) => {
    const st = ensureState(ctx);
    const files = fs.readdirSync(path.join(st.root, '.swarmforge', 'land-approvals'));
    const text = fs.readFileSync(path.join(st.root, '.swarmforge', 'land-approvals', files[0]), 'utf8');
    assert.match(text, new RegExp(`"commit":"${st.replay.slice(0, 10)}"`), `missing replay commit: ${text}`);
    assert.match(text, new RegExp(`"source":"${st.source.slice(0, 10)}"`), `missing source: ${text}`);
    assert.match(text, /"ticket":"BL-9009"/, `missing ticket: ${text}`);
  });

  scoped(/^the approval predicate answers approved for the replay$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(verdict(st.root, st.replay), 0, 'expected the predicate to now approve the replay');
  });

  // ── 02 (Scenario Outline) ─────────────────────────────────────────────
  scoped(/^the land-approval CLI is run with (.+) omitted$/, (ctx, missing) => {
    const st = ensureState(ctx);
    const args = missing === 'the replay' ? ['', st.source] : missing === 'the source' ? [st.replay, ''] : (() => {
      throw new Error(`unknown missing value: ${missing}`);
    })();
    st.result = runCli(st.root, args);
  });

  scoped(/^the CLI exits non-zero naming what is missing$/, (ctx) => {
    const st = ensureState(ctx);
    assert.notEqual(st.result.status, 0, `expected a non-zero exit: ${st.result.out}`);
  });

  scoped(/^the shared land-approval store is unchanged$/, (ctx) => {
    const st = ensureState(ctx);
    const dir = path.join(st.root, '.swarmforge', 'land-approvals');
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'expected no land-approval record to have been written');
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^an unapproved second source commit$/, (ctx) => {
    const st = ensureState(ctx);
    git(st.root, ['checkout', '-q', '-b', 'other']);
    git(st.root, ['commit', '-q', '--allow-empty', '-m', 'never reviewed']);
    st.unapprovedSource = git(st.root, ['rev-parse', 'HEAD']);
    git(st.root, ['checkout', '-q', 'main']);
  });

  scoped(/^the land-approval CLI records the replay against the unapproved source for ticket "([^"]+)"$/, (ctx, ticket) => {
    const st = ensureState(ctx);
    st.result = runCli(st.root, [st.replay, st.unapprovedSource, ticket]);
    assert.equal(st.result.status, 0, `expected the write itself to succeed: ${st.result.out}`);
  });

  scoped(/^the approval predicate still answers no for the replay$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(verdict(st.root, st.replay), 1, 'a record naming an unapproved source must grant nothing');
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the land-approval CLI records the replay against the source for ticket "([^"]+)" twice$/, (ctx, ticket) => {
    const st = ensureState(ctx);
    const first = runCli(st.root, [st.replay, st.source, ticket]);
    assert.equal(first.status, 0, `expected the first call to succeed: ${first.out}`);
    st.result = runCli(st.root, [st.replay, st.source, ticket]);
    assert.equal(st.result.status, 0, `expected the second call to succeed: ${st.result.out}`);
  });

  scoped(/^the shared land-approval store holds exactly one line for the replay$/, (ctx) => {
    const st = ensureState(ctx);
    const files = fs.readdirSync(path.join(st.root, '.swarmforge', 'land-approvals'));
    const text = fs.readFileSync(path.join(st.root, '.swarmforge', 'land-approvals', files[0]), 'utf8');
    const lines = text.split('\n').filter((l) => l.includes(`"commit":"${st.replay.slice(0, 10)}"`));
    assert.equal(lines.length, 1, `expected exactly one line for the replay, got: ${JSON.stringify(lines)}`);
  });
}

module.exports = { registerSteps };
