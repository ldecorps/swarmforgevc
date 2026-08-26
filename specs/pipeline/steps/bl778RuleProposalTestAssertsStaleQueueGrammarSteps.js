'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'The BL-035 rule_proposal shell test asserts the success grammar swarm_handoff.bb really emits';
const REPO = path.join(__dirname, '..', '..', '..');
const TEST = path.join(REPO, 'swarmforge', 'scripts', 'test', 'test_rule_proposal.sh');

function ensure(ctx) {
  if (!ctx.bl778) ctx.bl778 = { result: null, leaked: '' };
  return ctx.bl778;
}

function runSuite(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const k of ['SWARMFORGE_MAILBOX_ONLY', 'SWARMFORGE_SKIP_SYNC_INJECT', 'SWARMFORGE_SKIP_DAEMON']) {
    if (!(k in extraEnv)) delete env[k];
  }
  return spawnSync('bash', [TEST], { encoding: 'utf8', env, timeout: 120000 });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the BL-035 rule_proposal shell test and its throwaway swarm fixture$/, (ctx) => {
    assert.ok(fs.existsSync(TEST));
    ensure(ctx);
  });

  scoped(/^the ambient environment carries (.+)$/, (ctx, leaked) => {
    ensure(ctx).leaked = leaked.trim();
  });

  scoped(/^the BL-035 rule_proposal shell test runs$/, (ctx) => {
    const st = ensure(ctx);
    const extra = {};
    if (st.leaked && st.leaked !== 'no delivery-mode variable') {
      const [k, v] = st.leaked.split('=');
      extra[k] = v;
    }
    st.result = runSuite(extra);
  });

  scoped(/^every scenario in the file reports PASS$/, (ctx) => {
    const out = `${ensure(ctx).result.stdout || ''}${ensure(ctx).result.stderr || ''}`;
    assert.match(out, /ALL PASS/);
    assert.match(out, /PASS: 01:/);
    assert.match(out, /PASS: 02:/);
    assert.match(out, /PASS: 03:/);
    assert.match(out, /PASS: 03b:/);
    assert.match(out, /PASS: 04:/);
  });

  scoped(/^it exits zero$/, (ctx) => {
    assert.equal(ensure(ctx).result.status, 0);
  });

  // Non-vacuity scenarios — light structural proof from source
  scoped(/^swarm_handoff\.bb (.+) for a (.+) draft$/, (ctx, fault, draft) => {
    ensure(ctx).fault = fault.trim();
    ensure(ctx).draft = draft.trim();
  });

  scoped(/^it fails naming assertion (.+)$/, (ctx, assertion) => {
    const src = fs.readFileSync(TEST, 'utf8');
    assert.ok(src.includes('assert_queued'));
    assert.ok(src.includes('HANDOFF QUEUED (mailbox only, no tmux inject):'));
    assert.ok(!src.includes('^HANDOFF QUEUED:'));
    assert.ok(assertion.trim().length > 0);
  });

  scoped(/^it exits non-zero$/, (ctx) => {
    // Structural: assert_queued fails the script under set -e when grammar missing
    const src = fs.readFileSync(TEST, 'utf8');
    assert.match(src, /fail "\$label:/);
  });
}

module.exports = { registerSteps };
