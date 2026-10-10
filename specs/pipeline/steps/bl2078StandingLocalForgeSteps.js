'use strict';

// BL-2078: step handlers for "a standing all-local forge launches only
// behind the decode slot" - the local pack-shape gate's new capped-forge
// allowance (local_ollama_pack_shape_lib.sh), gated on the tool-call shim
// (BL-2077), plus the new standing pack conf itself.
//
// Drives the REAL gate script against the REAL pack conf (never a
// fixture copy - both are read-only here, and BL-1142's own scenarios
// already cover the gate's classifier against synthetic bodies). No pack
// is ever launched and no tmux server is ever touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A standing all-local forge launches only behind the decode slot';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_ollama_pack_shape_gate.sh');
const PACK_NAME = 'ollama-ista-local-model-claude-coord-forge';
const PACK_PATH = path.join(REPO_ROOT, 'swarmforge', 'packs', `${PACK_NAME}.conf`);

function ensure(ctx) {
  if (!ctx.bl2078) {
    ctx.bl2078 = {};
  }
  return ctx.bl2078;
}

function runGate(shim) {
  const env = { ...process.env };
  if (shim === 'off') {
    env.SWARMFORGE_LOCAL_MODEL_SHIM = 'off';
  } else {
    delete env.SWARMFORGE_LOCAL_MODEL_SHIM;
  }
  return spawnSync('bash', [GATE, REPO_ROOT, PACK_NAME], { encoding: 'utf8', env });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the ollama-ista-local-model-claude-coord-forge pack$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(fs.existsSync(PACK_PATH), `pack conf missing: ${PACK_PATH}`);
    st.body = fs.readFileSync(PACK_PATH, 'utf8');
  });

  scoped(/^the local pack-shape gate evaluates it with the tool-call shim (on|off)$/, (ctx, shim) => {
    const st = ensure(ctx);
    st.last = runGate(shim);
  });

  scoped(/^staffing is (allowed|refused naming the missing decode slot)$/, (ctx, verdict) => {
    const st = ensure(ctx);
    const output = `${st.last.stdout}\n${st.last.stderr}`;
    if (verdict === 'allowed') {
      assert.equal(st.last.status, 0, output);
      assert.match(output, /capped-forge/);
    } else {
      assert.notEqual(st.last.status, 0, output);
      assert.match(output, /decode slot/i);
    }
  });

  scoped(/^the pack conf is read$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.body) {
      st.body = fs.readFileSync(PACK_PATH, 'utf8');
    }
  });

  scoped(/^it declares no rotation router and no single_inference_slot$/, (ctx) => {
    const st = ensure(ctx);
    assert.doesNotMatch(st.body, /^\s*config\s+rotation\s+router\b/m);
    assert.doesNotMatch(st.body, /^\s*config\s+single_inference_slot\b/m);
  });

  scoped(/^every local-model window names the same model tag$/, (ctx) => {
    const st = ensure(ctx);
    const windowLines = st.body.split('\n').filter((line) => /^\s*window\s+\S+\s+local-model\b/.test(line));
    assert.ok(windowLines.length > 0, 'expected at least one local-model window');
    const tags = windowLines.map((line) => {
      const match = line.match(/--model\s+(\S+)/);
      assert.ok(match, `window line has no --model flag: ${line}`);
      return match[1];
    });
    assert.ok(tags.every((tag) => tag === tags[0]), `expected every window to name the same model tag, got: ${tags.join(', ')}`);
  });

  scoped(/^its active_backlog_max_depth is a positive number no higher than 5$/, (ctx) => {
    const st = ensure(ctx);
    const match = st.body.match(/^\s*config\s+active_backlog_max_depth\s+(\d+)\s*$/m);
    assert.ok(match, 'expected a config active_backlog_max_depth line');
    const depth = Number(match[1]);
    assert.ok(depth > 0 && depth <= 5, `expected 0 < active_backlog_max_depth <= 5, got ${depth}`);
  });
}

module.exports = { registerSteps };
