'use strict';

// BL-2108: step handlers for "the weekly recruiter benchmarks the prepared
// alias" - gates recruiter_weekly.sh's call to local_model_prepare_cli.bb
// (landed on main in 1e64496d93, reviewed and owned here).
//
// Drives the REAL recruiter_weekly.sh and the REAL
// local_model_prepare_cli.bb/local_model_prepare_lib.bb (copied with their
// bb closure via bb_closure_copy.sh) over a disposable mkdtemp project.
// Everything external is faked: recruiter_hf_discover.py, local_coder_battery.sh,
// local_model_compliance_battery.py and model_steward_cli.bb are sibling
// stand-ins under the fixture's swarmforge/scripts/; ollama, curl and df are
// shadowed at the FRONT of PATH by overriding HOME, because
// recruiter_weekly.sh's own `export PATH="$HOME/.local/bin:...:$PATH"` line
// puts $HOME/.local/bin ahead of everything this process inherited - on
// this host that is where the REAL ollama (and bb) already live, so the
// fixture's $HOME/.local/bin must carry the fakes AND a symlink to the real
// bb, or the run would either shell the live Ollama or fail to find bb at
// all. Every fake records what it was called with to one shared calls.log.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-2108 The weekly recruiter benchmarks the prepared alias';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SRC_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SRC_PACKS = path.join(REPO_ROOT, 'swarmforge', 'packs');

function realBbPath() {
  const probe = spawnSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' });
  const resolved = (probe.stdout || '').trim();
  if (probe.status !== 0 || !resolved) {
    throw new Error('BL-2108 fixture: could not resolve a real bb on PATH');
  }
  return resolved;
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function ensure(ctx) {
  if (ctx.bl2108) {
    return ctx.bl2108;
  }
  const root = trackedTmpRoot('bl2108-recruiter-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  const packsDir = path.join(root, 'swarmforge', 'packs');
  const homeDir = path.join(root, 'home');
  const homeLocalBin = path.join(homeDir, '.local', 'bin');
  const controlDir = path.join(root, 'control');
  const callsLog = path.join(root, 'calls.log');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(packsDir, { recursive: true });
  fs.mkdirSync(homeLocalBin, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });
  fs.writeFileSync(callsLog, '');

  // The real subject under review, and the real shared prepare lib it
  // calls - copied by their own derived bb closure, never hand-listed.
  fs.copyFileSync(
    path.join(SRC_SCRIPTS, 'recruiter_weekly.sh'),
    path.join(scriptsDir, 'recruiter_weekly.sh')
  );
  fs.chmodSync(path.join(scriptsDir, 'recruiter_weekly.sh'), 0o755);
  const closure = spawnSync(
    'bash',
    [
      '-c',
      `source "${path.join(SRC_SCRIPTS, 'test', 'lib', 'bb_closure_copy.sh')}" && ` +
        `copy_bb_closure "${SRC_SCRIPTS}" "${scriptsDir}" local_model_prepare_cli.bb`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(closure.status, 0, `could not copy local_model_prepare_cli.bb's bb closure: ${closure.stderr}`);
  fs.copyFileSync(
    path.join(SRC_PACKS, 'local-coder-prepare.Modelfile.tmpl'),
    path.join(packsDir, 'local-coder-prepare.Modelfile.tmpl')
  );

  // Fakes for discovery and the two batteries - plain stand-ins, never the
  // real HF/benchmark logic, each recording its call to calls.log.
  writeExecutable(
    path.join(scriptsDir, 'recruiter_hf_discover.py'),
    [
      '#!/usr/bin/env python3',
      'import json, os',
      'print(json.dumps({"candidate": {',
      '    "hf_id": os.environ.get("CAND_HF_ID", "org/repo"),',
      '    "ollama_pull": os.environ.get("CAND_PULL", "hf.co/org/repo:Q4_K_M"),',
      '    "alias": os.environ.get("CAND_ALIAS", "cand"),',
      '    "params_b": os.environ.get("CAND_PARAMS_B", "7"),',
      '}}))',
      '',
    ].join('\n')
  );
  writeExecutable(
    path.join(scriptsDir, 'local_coder_battery.sh'),
    [
      '#!/usr/bin/env bash',
      'set -uo pipefail',
      'printf \'coder_battery %s\\n\' "${LOCAL_CODER_BATTERY_MODEL:-unknown}" >> "${CALLS_LOG:?missing CALLS_LOG}"',
      'echo "RESULT=ok"',
      '',
    ].join('\n')
  );
  writeExecutable(
    path.join(scriptsDir, 'local_model_compliance_battery.py'),
    [
      '#!/usr/bin/env python3',
      'import json, os, sys',
      'alias = sys.argv[1]',
      'scorecard_path = sys.argv[2]',
      'calls_log = os.environ.get("CALLS_LOG")',
      'if calls_log:',
      '    with open(calls_log, "a") as f:',
      '        f.write("compliance_battery %s\\n" % alias)',
      'data = {',
      '    "overall": "pass",',
      '    "entries": [',
      '        {"competency": "coordinator-safety-1", "status": "pass"},',
      '        {"competency": "coordinator-safety-2", "status": "pass"},',
      '    ],',
      '}',
      'with open(scorecard_path, "w") as f:',
      '    json.dump(data, f)',
      '',
    ].join('\n')
  );
  // Fake Model Steward - records every register/certify call, and answers
  // certify per control/certify ("pass" default, or "refuse").
  writeExecutable(
    path.join(scriptsDir, 'model_steward_cli.bb'),
    [
      '#!/usr/bin/env bb',
      '(ns fake-model-steward-cli',
      '  (:require [clojure.string :as str]))',
      '',
      '(defn cli-args []',
      '  (let [raw (vec *command-line-args*)]',
      '    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))',
      '      (subvec raw 1)',
      '      raw)))',
      '',
      '(let [args (cli-args)',
      '      sub (first args)',
      '      target (second args)',
      '      calls-log (System/getenv "CALLS_LOG")',
      '      control-dir (System/getenv "CONTROL_DIR")]',
      '  (when calls-log',
      '    (spit calls-log (str sub " " target "\\n") :append true))',
      '  (cond',
      '    (= sub "register")',
      '    (System/exit 0)',
      '',
      '    (= sub "certify")',
      '    (let [mode (try (str/trim (slurp (str control-dir "/certify")))',
      '                     (catch Exception _ "pass"))]',
      '      (if (= mode "refuse")',
      '        (do (println "certify refused: did not pass the coordinator safety probes")',
      '            (System/exit 1))',
      '        (do (println "certified")',
      '            (System/exit 0))))',
      '',
      '    :else',
      '    (System/exit 0)))',
      '',
    ].join('\n')
  );

  // Fakes for ollama/curl/df, placed in $HOME/.local/bin - the ONLY way to
  // win the race against recruiter_weekly.sh's own PATH export, which puts
  // $HOME/.local/bin ahead of everything (including the real ollama on
  // this host). The real bb must still resolve from there too.
  writeExecutable(
    path.join(homeLocalBin, 'ollama'),
    [
      '#!/usr/bin/env bash',
      'set -uo pipefail',
      'CALLS_LOG="${CALLS_LOG:?missing CALLS_LOG}"',
      'CONTROL_DIR="${CONTROL_DIR:?missing CONTROL_DIR}"',
      'sub="${1:-}"',
      'case "$sub" in',
      '  pull)',
      '    echo "pull $2" >> "$CALLS_LOG"',
      '    exit 0',
      '    ;;',
      '  cp)',
      '    echo "cp $2 $3" >> "$CALLS_LOG"',
      '    exit 0',
      '    ;;',
      '  create)',
      '    echo "create $2" >> "$CALLS_LOG"',
      '    if [[ -f "$CONTROL_DIR/prepare" && "$(cat "$CONTROL_DIR/prepare")" == "fail" ]]; then',
      '      echo "simulated ollama create failure" >&2',
      '      exit 1',
      '    fi',
      '    exit 0',
      '    ;;',
      '  rm)',
      '    echo "rm $2" >> "$CALLS_LOG"',
      '    exit 0',
      '    ;;',
      '  *)',
      '    exit 0',
      '    ;;',
      'esac',
      '',
    ].join('\n')
  );
  writeExecutable(path.join(homeLocalBin, 'curl'), ['#!/usr/bin/env bash', 'exit 0', ''].join('\n'));
  writeExecutable(
    path.join(homeLocalBin, 'df'),
    [
      '#!/usr/bin/env bash',
      'echo "Filesystem     1G-blocks  Used Available Use% Mounted on"',
      'echo "fakefs              500G   10G      400G   3% /"',
      '',
    ].join('\n')
  );
  fs.symlinkSync(realBbPath(), path.join(homeLocalBin, 'bb'));

  // control/prepare defaults to "ok" (prepare succeeds); scenario 02
  // overwrites it to "fail". control/certify defaults to "pass"; the
  // fake steward's own default (no file at all) already reads as "pass",
  // but writing it here keeps every scenario's starting state explicit.
  fs.writeFileSync(path.join(controlDir, 'prepare'), 'ok');
  fs.writeFileSync(path.join(controlDir, 'certify'), 'pass');

  const st = {
    root,
    scriptsDir,
    homeDir,
    controlDir,
    callsLog,
    candidate: { hfId: 'org/repo', pull: 'hf.co/org/repo:Q4_K_M', alias: 'cand', paramsB: '7' },
    run: null,
  };
  ctx.bl2108 = st;
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(async () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return st;
}

function callsLogLines(st) {
  return fs
    .readFileSync(st.callsLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

function latestReportPath(st) {
  const evidenceDir = path.join(st.root, 'backlog', 'evidence');
  const files = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.startsWith('recruiter-weekly-') && name.endsWith('.md'))
    .sort();
  assert.ok(files.length > 0, 'expected recruiter_weekly.sh to write an evidence report');
  return path.join(evidenceDir, files[files.length - 1]);
}

function reportOutcome(st) {
  const text = fs.readFileSync(latestReportPath(st), 'utf8');
  const match = text.match(/^- outcome: (.+)$/m);
  assert.ok(match, `report has no outcome line:\n${text}`);
  return match[1];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture project whose recruiter scripts run against fakes for discovery, ollama, the batteries and the steward$/,
    (ctx) => {
      ensure(ctx);
    }
  );

  scoped(/^discovery offers one candidate pulled as "([^"]+)" and aliased "([^"]+)"$/, (ctx, pull, alias) => {
    const st = ensure(ctx);
    st.candidate.pull = pull;
    st.candidate.alias = alias;
  });

  scoped(/^the steward's certify gate passes$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.controlDir, 'certify'), 'pass');
  });

  scoped(/^the steward's certify gate refuses$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.controlDir, 'certify'), 'refuse');
  });

  scoped(/^preparing the pulled tag fails$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.controlDir, 'prepare'), 'fail');
  });

  scoped(/^the weekly recruiter runs$/, (ctx) => {
    const st = ensure(ctx);
    const result = spawnSync('bash', [path.join(st.scriptsDir, 'recruiter_weekly.sh'), st.root], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: st.homeDir,
        CALLS_LOG: st.callsLog,
        CONTROL_DIR: st.controlDir,
        CAND_HF_ID: st.candidate.hfId,
        CAND_PULL: st.candidate.pull,
        CAND_ALIAS: st.candidate.alias,
        CAND_PARAMS_B: st.candidate.paramsB,
      },
      timeout: 60000,
    });
    st.run = result;
    assert.equal(result.status, 0, `recruiter_weekly.sh exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  });

  scoped(/^it prepared "([^"]+)" as "([^"]+)"$/, (ctx, base, alias) => {
    const st = ensure(ctx);
    const modelfilePath = path.join(st.root, '.swarmforge', 'model-steward', 'prepared', `${alias}.Modelfile`);
    assert.ok(fs.existsSync(modelfilePath), `expected a prepared Modelfile at ${modelfilePath}`);
    const modelfile = fs.readFileSync(modelfilePath, 'utf8');
    assert.match(modelfile, new RegExp(`^FROM ${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.ok(callsLogLines(st).includes(`create ${alias}`), 'expected ollama create to be called with the prepared alias');
  });

  scoped(/^the steward was asked to register "([^"]+)"$/, (ctx, target) => {
    const st = ensure(ctx);
    assert.ok(callsLogLines(st).includes(`register ${target}`), `expected a register call for ${target}`);
  });

  scoped(/^the coder battery ran against "([^"]+)"$/, (ctx, alias) => {
    const st = ensure(ctx);
    assert.ok(callsLogLines(st).includes(`coder_battery ${alias}`), `expected the coder battery to run against ${alias}`);
  });

  scoped(/^the steward was asked to certify "([^"]+)"$/, (ctx, target) => {
    const st = ensure(ctx);
    assert.ok(callsLogLines(st).includes(`certify ${target}`), `expected a certify call for ${target}`);
  });

  scoped(/^the run finished "([^"]+)"$/, (ctx, outcome) => {
    const st = ensure(ctx);
    assert.equal(reportOutcome(st), outcome);
  });

  scoped(/^the steward was asked to register nothing$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(!callsLogLines(st).some((line) => line.startsWith('register ')), 'expected no register call at all');
  });

  scoped(/^ollama was asked to remove exactly "([^"]+)", "([^"]+)" and "([^"]+)"$/, (ctx, first, second, third) => {
    const st = ensure(ctx);
    const removed = callsLogLines(st)
      .filter((line) => line.startsWith('rm '))
      .map((line) => line.slice(3));
    assert.deepEqual(removed, [first, second, third]);
  });
}

module.exports = { registerSteps };
