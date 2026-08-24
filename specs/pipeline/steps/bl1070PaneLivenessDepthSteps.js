'use strict';

// BL-1070: pane liveness walks the whole tree under the pane, not one
// generation. Drives REAL agent_process_marker_lib.bb + babysitterd_sweep_lib.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  "BL-1070 a pane's liveness verdict reads the whole tree under it, not one generation";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MARKER_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'agent_process_marker_lib.bb');
const SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitterd_sweep_lib.bb');

const KNOWN_DEPTHS = new Set([
  'one generation below the pane',
  'two generations below the pane',
  'three generations below the pane',
  'nowhere under the pane',
]);
const KNOWN_VERDICTS = new Set(['alive', 'absent', 'unavailable']);
const KNOWN_TOLD = new Set(['remote control is degraded', 'the check could not be run']);

const PANE = 1000;
const OTHER_PANE = 2000;

function depthRows(depth) {
  switch (depth) {
    case 'one generation below the pane':
      return [[1001, PANE, 'claude --model opus']];
    case 'two generations below the pane':
      return [
        [1001, PANE, 'zsh /home/x/.swarmforge/launch/coder.sh'],
        [1002, 1001, 'claude --model opus'],
      ];
    case 'three generations below the pane':
      return [
        [1001, PANE, 'sh'],
        [1002, 1001, 'zsh /home/x/.swarmforge/launch/coder.sh'],
        [1003, 1002, 'claude --model opus'],
      ];
    case 'nowhere under the pane':
      return [
        [1001, PANE, 'zsh /home/x/.swarmforge/launch/coder.sh'],
        [1002, 1001, 'sleep 999'],
      ];
    default:
      throw new Error(`unknown depth: ${depth}`);
  }
}

function psText(rows) {
  return rows.map(([pid, ppid, args]) => `  ${pid}  ${ppid} ${args}`).join('\n');
}

function runBb(forms) {
  const script = forms.join('\n');
  const tmp = path.join(os.tmpdir(), `bl1070-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(tmp, script);
  try {
    const result = spawnSync('bb', [tmp], { encoding: 'utf8' });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0) {
      throw new Error(`bb exited ${result.status}:\n${out}`);
    }
    return out.trim();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function probeAgentLine(psOutput) {
  const escaped = JSON.stringify(psOutput);
  return runBb([
    `(load-file "${MARKER_LIB}")`,
    '(require \'[agent-process-marker-lib :as m])',
    `(let [line (m/agent-process-line ${PANE} ${escaped} "claude")]`,
    '  (println (if line "FOUND" "ABSENT")))',
  ]);
}

function probeLiveSession({ hasAgent, gatherFailed }) {
  return runBb([
    `(load-file "${SWEEP_LIB}")`,
    '(require \'[babysitterd-sweep-lib :as sw])',
    `(let [f (sw/check-live-session {:role "coder" :pane-exists? true`,
    `                                 :has-claude-process? ${hasAgent ? 'true' : 'false'}`,
    `                                 :process-gather-failed? ${gatherFailed ? 'true' : 'false'}})]`,
    '  (cond',
    '    (nil? f) (println "VERDICT=alive")',
    '    (= "UNAVAILABLE" (:severity f)) (println "VERDICT=unavailable")',
    '    (and (= "CRIT" (:severity f)) (clojure.string/includes? (:message f) "NO "))',
    '      (println "VERDICT=absent")',
    '    :else (println (str "VERDICT=other:" (pr-str f)))))',
  ]);
}

function probeRemoteControl({ hasAgent, hasRc }) {
  return runBb([
    `(load-file "${SWEEP_LIB}")`,
    '(require \'[babysitterd-sweep-lib :as sw])',
    `(let [f (sw/check-remote-control {:role "coder" :pane-exists? true`,
    `                                   :has-claude-process? ${hasAgent ? 'true' : 'false'}`,
    `                                   :has-remote-control? ${hasRc ? 'true' : 'false'}})]`,
    '  (cond',
    '    (nil? f) (println "TOLD=ok")',
    '    (and (= "WARN" (:severity f)) (clojure.string/includes? (:message f) "RC degraded"))',
    '      (println "TOLD=remote control is degraded")',
    '    (and (= "UNAVAILABLE" (:severity f)) (clojure.string/includes? (:message f) "could not be run"))',
    '      (println "TOLD=the check could not be run")',
    '    :else (println (str "TOLD=other:" (pr-str f)))))',
  ]);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role pane the pack launched and whose agent is working$/, (ctx) => {
    ctx.bl1070 = { pane: PANE };
  });

  scoped(/^the claude process sits "([^"]+)"$/, (ctx, depth) => {
    assert.ok(KNOWN_DEPTHS.has(depth), `unknown <depth>: ${depth}`);
    ctx.bl1070 = ctx.bl1070 || {};
    ctx.bl1070.depth = depth;
    ctx.bl1070.ps = psText(depthRows(depth));
    ctx.bl1070.hasAgent = depth !== 'nowhere under the pane';
  });

  scoped(/^another role's pane has a working agent under it$/, (ctx) => {
    const extra = psText([
      [OTHER_PANE, 1, 'sh'],
      [OTHER_PANE + 1, OTHER_PANE, 'zsh /home/x/.swarmforge/launch/specifier.sh'],
      [OTHER_PANE + 2, OTHER_PANE + 1, 'claude --model opus'],
    ]);
    ctx.bl1070.ps = `${ctx.bl1070.ps}\n${extra}`;
  });

  scoped(/^the process gather fails this sweep$/, (ctx) => {
    ctx.bl1070 = ctx.bl1070 || {};
    ctx.bl1070.gatherFailed = true;
    ctx.bl1070.hasAgent = false;
  });

  scoped(/^it was started without the remote-control flag$/, (ctx) => {
    ctx.bl1070.hasRc = false;
  });

  scoped(/^the babysitter decides whether the role is alive$/, (ctx) => {
    const st = ctx.bl1070;
    if (st.gatherFailed) {
      st.liveOut = probeLiveSession({ hasAgent: false, gatherFailed: true });
      return;
    }
    const found = probeAgentLine(st.ps);
    st.found = found.includes('FOUND');
    st.liveOut = probeLiveSession({ hasAgent: st.found, gatherFailed: false });
  });

  scoped(/^the babysitter runs its remote-control check$/, (ctx) => {
    const st = ctx.bl1070;
    const found = probeAgentLine(st.ps).includes('FOUND');
    st.found = found;
    st.rcOut = probeRemoteControl({ hasAgent: found, hasRc: Boolean(st.hasRc) });
  });

  scoped(/^the role is reported "([^"]+)"$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown <verdict>: ${verdict}`);
    const st = ctx.bl1070;
    assert.match(st.liveOut, new RegExp(`VERDICT=${verdict}`));
  });

  scoped(/^no half-launch alert is raised for it$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1070.liveOut, /VERDICT=absent/);
    assert.match(ctx.bl1070.liveOut, /VERDICT=unavailable/);
  });

  scoped(/^the operator is told "([^"]+)"$/, (ctx, told) => {
    assert.ok(KNOWN_TOLD.has(told), `unknown <told>: ${told}`);
    assert.match(ctx.bl1070.rcOut, new RegExp(`TOLD=${told.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
}

module.exports = { registerSteps };
