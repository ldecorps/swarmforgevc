'use strict';

// BL-1085: push-sweep caches its refusal and gathers the ahead range once.
// Drives the REAL test_push_sweep_ahead_range.sh (lib + CLI + wiring) —
// never a parallel reimplementation.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_push_sweep_ahead_range.sh'
);
const FEATURE =
  'push-sweep caches its refusal and gathers the ahead range once';

function runFixture(ctx) {
  if (ctx.bl1085?.out) return ctx.bl1085.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 120000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1085 = { out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_push_sweep_ahead_range.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(out, marker) {
  assert.match(out, new RegExp(`PASS: ${marker}`), `missing PASS: ${marker}\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^local main is ahead of origin\/main by 5 commits$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^one ahead commit is not QA-approved$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^a push-sweep tick runs$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the ahead range is enumerated$/, (ctx) => {
    const out = runFixture(ctx);
    assert.match(
      out,
      /PASS: 01: first refusing tick enumerates|PASS: 03: tip move|PASS: 04: incomplete gather/,
      out
    );
  });

  scoped(/^the sweep refuses with "non-qa-ancestor"$/, (ctx) => {
    const out = runFixture(ctx);
    assert.match(out, /non-qa-ancestor/, out);
  });

  scoped(/^a push-sweep tick has already refused with "non-qa-ancestor"$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the ahead range is not enumerated$/, (ctx) => {
    requirePass(runFixture(ctx), '02: unchanged inputs replay without enumerating');
  });

  scoped(/^a new commit is added to local main$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^origin\/main advances so the ahead set shrinks$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the ahead set is reordered without changing its length$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the previous tick's gather did not complete$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the ahead range is enumerated exactly once$/, (ctx) => {
    requirePass(runFixture(ctx), '05: gathering tick walks ahead range exactly once');
  });

  scoped(/^the noop-merge gate and the QA gate both decide from that one fact set$/, (ctx) => {
    requirePass(runFixture(ctx), '05: gathering tick walks ahead range exactly once');
  });

  scoped(/^the ahead range contains (.+)$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^a push-sweep tick runs with the cache enabled$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^a push-sweep tick runs with the cache disabled$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^both ticks reach the same verdict$/, (ctx) => {
    requirePass(runFixture(ctx), '06: cached verdict equals full re-gather');
  });
}

module.exports = { registerSteps };
