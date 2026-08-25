'use strict';

// BL-1128: sustained host headroom raises the standing configured
// active_backlog_max_depth; unhold eligible hold→paused; prefer depth tickets.
// Drives the REAL headroom_cap_raise_cli.bb + effective_backlog_depth_cli.bb
// and promotion_gates_lib rank via bb — never a JS reimplementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RAISE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'headroom_cap_raise_cli.bb');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const PROMOTION_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_lib.bb');
const EFFECTIVE_SRC = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConf(root, lines) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'swarmforge.conf'), lines.join('\n') + '\n');
}

function writeOverride(root, body) {
  const dir = path.join(root, '.swarmforge', 'coordinator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'headroom-signal-override.json'), JSON.stringify(body));
}

function writeThrottle(root, severity) {
  const dir = path.join(root, '.swarmforge', 'coordinator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'throttle-recommendation.json'),
    JSON.stringify({ severity, recommendedCap: severity ? 1 : null })
  );
}

function runRaise(ctx) {
  const out = execFileSync('bb', [RAISE_CLI, ctx.root, 'raise'], { encoding: 'utf8' });
  ctx.raiseResult = JSON.parse(out.trim());
}

function runUnhold(ctx) {
  const out = execFileSync('bb', [RAISE_CLI, ctx.root, 'unhold'], { encoding: 'utf8' });
  ctx.unholdResult = JSON.parse(out.trim());
}

function runUndo(ctx) {
  const out = execFileSync('bb', [RAISE_CLI, ctx.root, 'undo'], { encoding: 'utf8' });
  ctx.undoResult = JSON.parse(out.trim());
}

function configuredDepth(root) {
  const text = fs.readFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'utf8');
  const m = text.match(/^config active_backlog_max_depth\s+(-?\d+)/m);
  assert.ok(m, 'expected active_backlog_max_depth line');
  return Number.parseInt(m[1], 10);
}

function effectiveDepth(root) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, root], {
    encoding: 'utf8',
    // stderr may include backlog_depth_lib fallback noise
  });
  const line = out
    .trim()
    .split('\n')
    .filter((l) => /^-?\d+$/.test(l.trim()))
    .pop();
  return Number.parseInt(line, 10);
}

function auditLines(root) {
  const p = path.join(root, '.swarmforge', 'coordinator', 'headroom-cap-changes.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function registerSteps(registry) {
  // required_wiring needle lives in effective_backlog_depth_cli.bb
  registry.define(/^bl1128HeadroomRaiseConfiguredCap acceptance handler is registered$/, () => {
    const src = fs.readFileSync(EFFECTIVE_SRC, 'utf8');
    assert.ok(
      src.includes('bl1128HeadroomRaiseConfiguredCap'),
      'expected bl1128HeadroomRaiseConfiguredCap wiring needle in effective_backlog_depth_cli.bb'
    );
  });

  // ── scenario 01 ────────────────────────────────────────────────────────
  registry.define(/^host CPU and free memory stay within headroom thresholds for the sustained window$/, (ctx) => {
    ctx.root = mkTmp('bl1128-headroom-');
    writeConf(ctx.root, [
      'config active_backlog_max_depth 3',
      'config active_backlog_max_depth_ceiling 8',
      'config active_backlog_headroom_raise_step 1',
    ]);
    writeOverride(ctx.root, { cpuHeadroom: true, memAvailableMb: 8192 });
    ctx.configuredBefore = 3;
  });

  registry.define(/^Article 3\.5 throttle diagnosis is not degraded or severe$/, (ctx) => {
    writeThrottle(ctx.root, null);
  });

  registry.define(/^configured active_backlog_max_depth is below the hard ceiling$/, (ctx) => {
    assert.ok(configuredDepth(ctx.root) < 8);
  });

  registry.define(/^the headroom raise CLI runs$/, (ctx) => {
    runRaise(ctx);
  });

  registry.define(/^active_backlog_max_depth on the single configured write target increases by the documented step$/, (ctx) => {
    assert.equal(ctx.raiseResult.action, 'raise');
    assert.equal(configuredDepth(ctx.root), ctx.configuredBefore + 1);
  });

  registry.define(/^effective_backlog_depth_cli reflects the higher configured ceiling$/, (ctx) => {
    assert.equal(effectiveDepth(ctx.root), configuredDepth(ctx.root));
  });

  registry.define(/^an audit record of the raise is written$/, (ctx) => {
    const lines = auditLines(ctx.root);
    assert.ok(lines.length >= 1);
    const last = lines[lines.length - 1];
    assert.equal(last.action, 'raise');
    assert.equal(last.to, configuredDepth(ctx.root));
  });

  // ── scenario 02 ────────────────────────────────────────────────────────
  registry.define(/^high CPU or memory pressure or a degraded or severe throttle recommendation$/, (ctx) => {
    ctx.root = mkTmp('bl1128-pressure-');
    writeConf(ctx.root, ['config active_backlog_max_depth 3', 'config active_backlog_max_depth_ceiling 8']);
    writeOverride(ctx.root, { cpuHeadroom: false, memAvailableMb: 100 });
    writeThrottle(ctx.root, 'degraded');
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'hold'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'hold', 'BL-1-eligible.yaml'),
      'id: BL-1\nheadroom_unhold: eligible\ntitle: eligible\n'
    );
    ctx.configuredBefore = 3;
  });

  registry.define(/^configured active_backlog_max_depth is unchanged$/, (ctx) => {
    assert.equal(ctx.raiseResult.action, 'noop');
    assert.equal(configuredDepth(ctx.root), ctx.configuredBefore);
  });

  registry.define(/^backlog\/hold is left untouched$/, (ctx) => {
    runUnhold(ctx);
    assert.ok(fs.existsSync(path.join(ctx.root, 'backlog', 'hold', 'BL-1-eligible.yaml')));
  });

  // ── scenario 03 ────────────────────────────────────────────────────────
  registry.define(/^eligible tickets exist under backlog\/hold$/, (ctx) => {
    ctx.root = mkTmp('bl1128-unhold-');
    writeConf(ctx.root, ['config active_backlog_max_depth 3', 'config active_backlog_max_depth_ceiling 8']);
    writeOverride(ctx.root, { cpuHeadroom: true, memAvailableMb: 8192 });
    writeThrottle(ctx.root, null);
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'hold'), { recursive: true });
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'paused'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'hold', 'BL-1-eligible.yaml'),
      'id: BL-1\nheadroom_unhold: eligible\ntitle: eligible hold\n'
    );
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'hold', 'BL-2-human.yaml'),
      'id: BL-2\ntitle: human parked without policy tag\n'
    );
  });

  registry.define(/^a headroom raise succeeds$/, (ctx) => {
    runRaise(ctx);
    assert.equal(ctx.raiseResult.action, 'raise');
  });

  registry.define(/^the same owned unhold step runs$/, (ctx) => {
    runUnhold(ctx);
  });

  registry.define(/^those eligible tickets move hold to paused with an UNHOLD note each$/, (ctx) => {
    const paused = path.join(ctx.root, 'backlog', 'paused', 'BL-1-eligible.yaml');
    assert.ok(fs.existsSync(paused));
    assert.ok(fs.readFileSync(paused, 'utf8').includes('UNHOLD'));
    assert.ok(!fs.existsSync(path.join(ctx.root, 'backlog', 'hold', 'BL-1-eligible.yaml')));
  });

  registry.define(/^they are not auto-promoted into active past the new cap$/, (ctx) => {
    assert.ok(!fs.existsSync(path.join(ctx.root, 'backlog', 'active', 'BL-1-eligible.yaml')));
  });

  registry.define(/^human-parked holds without eligibility stay in hold$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.root, 'backlog', 'hold', 'BL-2-human.yaml')));
  });

  // ── scenario 04 ────────────────────────────────────────────────────────
  registry.define(
    /^the configured cap just increased and paused depth or cap or throttle tickets exist alongside unrelated low-priority work$/,
    (ctx) => {
      ctx.root = mkTmp('bl1128-prefer-');
      ctx.depthContent =
        'id: BL-683\ntitle: "handoff depth warning off-by-one"\npriority: 90\nhuman_approval: approved\n';
      ctx.otherContent =
        'id: BL-9000\ntitle: unrelated low-priority work\npriority: 1\nhuman_approval: approved\n';
    }
  );

  registry.define(/^ordinary promotion fills a newly opened slot$/, (ctx) => {
    const scriptPath = path.join(ctx.root, 'rank.bb');
    fs.mkdirSync(ctx.root, { recursive: true });
    fs.writeFileSync(
      scriptPath,
      `(load-file "${PROMOTION_LIB.replace(/\\/g, '/')}")
(let [depth {:file "depth.yaml" :content ${JSON.stringify(ctx.depthContent)}}
      other {:file "other.yaml" :content ${JSON.stringify(ctx.otherContent)}}
      w (promotion-gates-lib/rank-candidates [other depth])]
  (println (:file w)))
`
    );
    const out = execFileSync('bb', [scriptPath], { encoding: 'utf8' });
    ctx.winnerFile = out.trim().split('\n').filter(Boolean).pop();
  });

  registry.define(/^a depth or cap or throttle correctness candidate is preferred over the unrelated low-priority ticket$/, (ctx) => {
    assert.equal(ctx.winnerFile, 'depth.yaml');
  });

  // ── scenario 05 ────────────────────────────────────────────────────────
  registry.define(/^configured depth is at the hard ceiling or a raise cooldown is active$/, (ctx) => {
    ctx.root = mkTmp('bl1128-ceiling-');
    writeConf(ctx.root, [
      'config active_backlog_max_depth 3',
      'config active_backlog_max_depth_ceiling 8',
      'config active_backlog_headroom_raise_cooldown_minutes 60',
    ]);
    writeOverride(ctx.root, { cpuHeadroom: true, memAvailableMb: 8192 });
    writeThrottle(ctx.root, null);
    runRaise(ctx);
    assert.equal(ctx.raiseResult.action, 'raise');
    ctx.configuredAfterRaise = configuredDepth(ctx.root);
  });

  registry.define(/^no further raise is applied$/, (ctx) => {
    runRaise(ctx);
    assert.equal(ctx.raiseResult.action, 'noop');
    assert.equal(ctx.raiseResult.reason, 'cooldown');
    assert.equal(configuredDepth(ctx.root), ctx.configuredAfterRaise);
  });

  registry.define(/^a prior raise can be undone via the documented reversible path restoring the previous configured value$/, (ctx) => {
    runUndo(ctx);
    assert.equal(ctx.undoResult.action, 'undo');
    assert.equal(configuredDepth(ctx.root), 3);
  });
}

module.exports = { registerSteps };
