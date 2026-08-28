'use strict';

// BL-1204: step handlers for "every redeploy target the bridge accepts is
// reachable from Telegram and listed in help". Drives the REAL decision
// layer (telegramCursorOperatorCore's operatorDangerTier/
// decideOperatorVerbConfirm) and the REAL execution layer
// (telegramCursorOperatorExec's executeOperatorVerb, against a real
// fixture root + real spawned script) - never a reimplementation of
// either. Never mind the "operator" naming: /redeploy's decision and
// execution machinery is the same Cursor Remote operator-verb pipeline
// every other soft/hard verb in this bridge uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  operatorDangerTier,
  decideOperatorVerbConfirm,
} = require('../../../extension/out/tools/telegramCursorOperatorCore');
const { executeOperatorVerb } = require('../../../extension/out/tools/telegramCursorOperatorExec');
const {
  formatHelpMessage,
} = require('../../../extension/out/tools/telegramCursorBridgeCore');
const { parseRedeployCommand } = require('../../../extension/out/tools/telegramCursorBridgeRedeploy');
const { parseMiniAppRedeployCommand } = require('../../../extension/out/tools/telegramCursorBridgeMiniAppRedeploy');
const { parseFrontDeskRedeployCommand } = require('../../../extension/out/tools/telegramCursorBridgeFrontDeskRedeploy');
const { parseAllRedeployCommand } = require('../../../extension/out/tools/telegramCursorBridgeAllRedeploy');

const FEATURE = 'every redeploy target the bridge accepts is reachable from Telegram and listed in help';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// target -> {scriptName, startMessagePattern}. The script each real
// dispatch must reach - a misroute to the WRONG one (today's bug: every
// target fell through to redeploy_cursor_bridge.sh) writes the marker in
// the WRONG place, which the Then step below catches directly.
const TARGET_SCRIPT = {
  frontdesk: { scriptName: 'redeploy_front_desk.sh', startPattern: /Front desk redeploy started/i },
  all: { scriptName: 'redeploy_all_telegram.sh', startPattern: /All Telegram redeploy started/i },
  miniapp: { scriptName: 'bounce_bridge_headless.sh', startPattern: /Mini app redeploy started/i },
};

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1204-acceptance-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function writeStubScript(root, scriptName, marker) {
  const scriptPath = path.join(root, 'swarmforge', 'scripts', scriptName);
  fs.writeFileSync(scriptPath, `#!/usr/bin/env bash\necho ok > "${marker}"\nexit 0\n`, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
}

const MARKER_POLL_TIMEOUT_MS = 3000;
const MARKER_POLL_INTERVAL_MS = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BL-1204 cleaner bounce D1: the redeploy scripts run detached and
// unref'd, so the marker they write lands asynchronously - bounded poll,
// never a synchronous read (races and loses almost every time) and never
// an unbounded wait (a genuinely broken dispatch must still fail fast).
async function waitForMarker(markerPath) {
  const deadline = Date.now() + MARKER_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) {
      return;
    }
    await sleep(MARKER_POLL_INTERVAL_MS);
  }
}

function registerSteps(registry) {
  scoped(registry, /^the Cursor bridge is accepting Telegram commands$/, (ctx) => {
    ctx.bl1204 = { root: mkFixtureRoot() };
  });

  scoped(registry, /^the operator sends "\/redeploy (\S+)"$/, (ctx, target) => {
    const st = ctx.bl1204;
    st.target = target;
    // Decision layer: the SAME parse used live (operatorDangerTier looks
    // only at the base verb "/redeploy", which is why frontdesk/all were
    // already correctly gated pre-fix - the gap was entirely below this).
    const fullText = `/redeploy ${target}`;
    st.tier = operatorDangerTier(fullText);
    st.decision = decideOperatorVerbConfirm(fullText, undefined);

    // Execution layer: real script + real spawn, one script per target so
    // a misroute to the wrong one is directly observable.
    const spec = TARGET_SCRIPT[target];
    assert.ok(spec, `unexpected target "${target}" in this scenario's own Examples table`);
    const marker = path.join(st.root, `${target}.marker`);
    writeStubScript(st.root, spec.scriptName, marker);
    st.executeResult = executeOperatorVerb(st.root, '/redeploy', target);
    st.marker = marker;
    st.startPattern = spec.startPattern;
  });

  scoped(registry, /^the command is accepted as a soft-confirm redeploy for (\S+)$/, async (ctx, target) => {
    const st = ctx.bl1204;
    assert.equal(st.target, target);
    assert.equal(st.tier, 'soft', `expected /redeploy ${target} to gate as soft-confirm, got tier=${st.tier}`);
    assert.equal(st.decision.action, 'prompt-confirm', `expected a prompt-confirm decision, got: ${JSON.stringify(st.decision)}`);
    assert.equal(st.decision.verb, '/redeploy');
    assert.equal(st.decision.args, target);
    // The execute-time dispatch must reach THIS target's own module, not
    // silently fall through to the plain cursor-bridge redeploy (today's
    // bug shape) - executeOperatorVerb's return value is built synchronously
    // (right after spawn() hands back a pid), so this half is reliable with
    // no race.
    assert.match(st.executeResult.text, st.startPattern, `expected the real dispatch to reach ${target}'s own module, got: ${st.executeResult.text}`);
    // BL-1204 cleaner bounce D1: the three redeploy modules spawn their
    // script `detached: true` + `child.unref()` - a deliberate fire-and-
    // forget so the bridge-bouncing redeploy never blocks the caller - so
    // the marker file the script writes lands asynchronously, not by the
    // time executeOperatorVerb returns. A synchronous read here raced the
    // child process and lost almost every time (confirmed: absent
    // immediately, present ~300ms later). Poll with a bounded timeout
    // instead of assuming either timing.
    await waitForMarker(st.marker);
    assert.equal(fs.readFileSync(st.marker, 'utf8').trim(), 'ok', `expected ${target}'s own script to have actually run`);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(registry, /^the operator asks for help$/, (ctx) => {
    ctx.bl1204 = { help: formatHelpMessage() };
  });

  scoped(registry, /^every redeploy target the bridge accepts is listed$/, (ctx) => {
    const st = ctx.bl1204;
    st.acceptedTargets = [
      { helpPrefix: '/redeploy', command: '/redeploy', accepts: parseRedeployCommand },
      { helpPrefix: '/redeploy miniapp', command: '/redeploy miniapp', accepts: parseMiniAppRedeployCommand },
      { helpPrefix: '/redeploy frontdesk', command: '/redeploy frontdesk', accepts: parseFrontDeskRedeployCommand },
      { helpPrefix: '/redeploy all', command: '/redeploy all', accepts: parseAllRedeployCommand },
    ];
    for (const target of st.acceptedTargets) {
      assert.equal(target.accepts(target.command), true, `${target.command} must be accepted by its own module's real parser`);
    }
    const redeployLines = st.help.split('\n').filter((line) => line.startsWith('/redeploy'));
    assert.equal(
      redeployLines.length,
      st.acceptedTargets.length,
      `expected exactly ${st.acceptedTargets.length} /redeploy help lines, got:\n${redeployLines.join('\n')}`
    );
    st.redeployLines = redeployLines;
  });

  scoped(registry, /^every redeploy target the help message lists is accepted$/, (ctx) => {
    const st = ctx.bl1204;
    for (const target of st.acceptedTargets) {
      assert.ok(
        st.redeployLines.some((line) => line === target.helpPrefix || line.startsWith(`${target.helpPrefix} —`)),
        `help message must list "${target.helpPrefix}"`
      );
    }
  });
}

module.exports = { registerSteps };
