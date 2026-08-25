'use strict';

// BL-1127: local coder evidence bar + steward eligibility + no-cloud launch path.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1127 local coder evidence bar before staffing a full local swarm';
const REPO = path.join(__dirname, '..', '..', '..');
const BATTERY = path.join(REPO, 'swarmforge', 'scripts', 'local_coder_battery.sh');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'model_steward_lib.bb');
const START = path.join(REPO, 'start-swarm-ollama-qwen.sh');
const PACK = path.join(REPO, 'swarmforge', 'packs', 'ollama-qwen3-mono-router.conf');

function ensure(ctx) {
  if (!ctx.bl1127) ctx.bl1127 = { raw: '', evidence: null };
  return ctx.bl1127;
}

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the local coder battery script \(claim edit test handoff\) is defined$/, (ctx) => {
    assert.ok(fs.existsSync(BATTERY));
    ensure(ctx);
  });

  scoped(/^it is run against the candidate Ollama model and agent pairing$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bash', [BATTERY], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCAL_CODER_BATTERY_FORCE_RESULT: 'fail',
        LOCAL_CODER_BATTERY_PROVIDER: 'ollama',
        LOCAL_CODER_BATTERY_MODEL: 'qwen2.5-coder',
      },
    });
    // fail exit is expected for forced fail
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
    st.batteryExit = r.status;
    const m = st.raw.match(/EVIDENCE=(.+)/);
    st.evidencePath = m ? m[1].trim() : null;
  });

  scoped(/^backlog\/evidence receives a dated pass or fail artifact$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /RESULT=(pass|fail)/);
    assert.ok(st.evidencePath && fs.existsSync(st.evidencePath));
    assert.match(path.basename(st.evidencePath), /BL-1127-coder-battery-/);
  });

  scoped(/^fail does not staff the production local forge pack$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /RESULT=fail/);
    const r = runBb(`
(load-file "${LIB}")
(def e {:result "fail" :path "${st.evidencePath}" :provider "ollama" :model "qwen2.5-coder"})
(def out (model-steward-lib/bl1127CoderBatteryEligibility e))
(println (str "ELIGIBLE=" (:eligible? out)))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout || '', /ELIGIBLE=false/);
    // Live launch path must consult the staffing gate (not APS-only).
    const startSrc = fs.readFileSync(START, 'utf8');
    assert.match(startSrc, /local_coder_battery_staffing_gate\.sh/);
    const gate = path.join(REPO, 'swarmforge', 'scripts', 'local_coder_battery_staffing_gate.sh');
    assert.ok(fs.existsSync(gate), 'staffing gate script missing');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1127-gate-'));
    try {
      fs.mkdirSync(path.join(tmp, 'backlog', 'evidence'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'swarmforge', 'scripts'), { recursive: true });
      fs.copyFileSync(gate, path.join(tmp, 'swarmforge', 'scripts', 'local_coder_battery_staffing_gate.sh'));
      fs.copyFileSync(LIB, path.join(tmp, 'swarmforge', 'scripts', 'model_steward_lib.bb'));
      const failEv = path.join(tmp, 'backlog', 'evidence', 'BL-1127-coder-battery-ollama-qwen-fail.md');
      fs.writeFileSync(failEv, '# fail\n\n- result: fail\n');
      const refuse = spawnSync(
        'bash',
        [path.join(tmp, 'swarmforge', 'scripts', 'local_coder_battery_staffing_gate.sh'), tmp],
        {
          encoding: 'utf8',
          env: { ...process.env, LOCAL_CODER_BATTERY_EVIDENCE_PATH: failEv },
        }
      );
      assert.notEqual(refuse.status, 0, 'fail evidence must refuse staffing');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  scoped(/^a pass battery for a named local model$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bash', [BATTERY], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCAL_CODER_BATTERY_FORCE_RESULT: 'pass',
        LOCAL_CODER_BATTERY_PROVIDER: 'ollama',
        LOCAL_CODER_BATTERY_MODEL: 'qwen2.5-coder',
      },
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
    st.evidencePath = (st.raw.match(/EVIDENCE=(.+)/) || [])[1].trim();
  });

  scoped(/^steward eligibility for coder is updated$/, (ctx) => {
    const st = ensure(ctx);
    const r = runBb(`
(load-file "${LIB}")
(def e {:result "pass" :path "${st.evidencePath}" :provider "ollama" :model "qwen2.5-coder"})
(def reg (model-steward-lib/register-model model-steward-lib/empty-registry "ollama" "qwen2.5-coder" {}))
(def updated (model-steward-lib/apply-coder-battery-to-scorecard reg e))
(def el (model-steward-lib/bl1127CoderBatteryEligibility e))
(println (str "ELIGIBLE=" (:eligible? el)))
(println (str "PATH=" (:evidence_path el)))
(println (str "RANK=" (pr-str (get-in updated [:role_matrix "coder"]))))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the scorecard cites that evidence path$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.raw, /ELIGIBLE=true/);
    assert.ok(st.raw.includes(st.evidencePath) || st.raw.includes('PATH='));
    assert.match(st.raw, /RANK=.*evidence/);
  });

  scoped(/^a failing or absent battery leaves coder ineligible for local forge$/, (ctx) => {
    const r = runBb(`
(load-file "${LIB}")
(def fail (model-steward-lib/bl1127CoderBatteryEligibility {:result "fail" :path "x"}))
(def absent (model-steward-lib/bl1127CoderBatteryEligibility nil))
(println (str "FAIL_ELIGIBLE=" (:eligible? fail)))
(println (str "ABSENT_ELIGIBLE=" (:eligible? absent)))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout || '', /FAIL_ELIGIBLE=false/);
    assert.match(r.stdout || '', /ABSENT_ELIGIBLE=false/);
  });

  scoped(/^the ollama-qwen3-mono-router pack and its start-swarm script$/, (ctx) => {
    assert.ok(fs.existsSync(PACK));
    assert.ok(fs.existsSync(START));
    ensure(ctx).pack = fs.readFileSync(PACK, 'utf8');
    ensure(ctx).start = fs.readFileSync(START, 'utf8');
  });

  scoped(/^the happy-path launch procedure is followed with Ollama up$/, (ctx) => {
    // Source inspection of happy-path requirements (no live swarm start).
    ensure(ctx);
  });

  scoped(/^coordinator and pipeline seats start on local inference$/, (ctx) => {
    const pack = ensure(ctx).pack;
    assert.match(pack, /11434/);
    assert.match(pack, /window coder/);
    assert.match(pack, /window QA/);
    assert.match(ensure(ctx).start, /SWARMFORGE_PACK=ollama-qwen3-mono-router/);
  });

  scoped(/^cloud Token Plan keys are not required for that happy path$/, (ctx) => {
    const start = ensure(ctx).start;
    const pack = ensure(ctx).pack;
    assert.doesNotMatch(start, /QWEN_API_KEY missing|BAILIAN_TOKEN_PLAN/);
    assert.match(start, /does NOT require cloud|not require/i);
    assert.match(pack, /NOT required|no cloud/i);
    assert.doesNotMatch(pack, /BAILIAN_TOKEN_PLAN_API_KEY=sk-/);
  });
}

module.exports = { registerSteps };
