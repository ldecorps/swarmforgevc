'use strict';

// BL-1707: step handlers for the review-only certification of three
// 2026-09-23 hotfixes (22a2a9fc7f, 7ba57573ff, e94b78a7a3). Every scenario
// drives the REAL landed code - agent_runtime_inject.bb's notify-agent!
// and handoffd.bb's notify-in-process-resume! through a fake tmux binary
// (the same technique test_agent_runtime_inject_mock.sh and
// bl1719_wake_no_session_probe.bb already establish), model_steward_lib.bb's
// pure certification-safety-gate, and local_model_compliance_battery.py
// itself run for real - never a restatement of what any of them should do.
// No production file is edited; the invariant is "read only".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const FEATURE = "BL-1707 swarm stamp - the STOP banner's fallback and the steward competency that probes it (hotfixes 22a2a9fc7f, 7ba57573ff, e94b78a7a3)";

function buildFakeTmux(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const callLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(callLog, '');
  // Every subcommand (has-session, capture-pane, send-keys) exits 0 and is
  // recorded verbatim - has-session exiting 0 unconditionally is what
  // makes handoff_lib.bb's session-exists? report the configured session
  // as live, without a real tmux server.
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/usr/bin/env bash\necho "$*" >> "${callLog}"\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  return { bin, callLog };
}

// ── Scenario 01: the no-narration fallback ──────────────────────────────

const INJECTION_KNOWN_VALUES = {
  'a caller-supplied nudge text': 'direct',
  "handoffd's in-process-resume STOP banner": 'in-process-resume',
};

function knownInjection(injection) {
  const kind = INJECTION_KNOWN_VALUES[injection];
  assert.ok(kind, `unknown <injection> example value "${injection}"`);
  return kind;
}

function typedTextForDirectInjection(root, bin, injection) {
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  const injectPath = path.join(SCRIPTS, 'agent_runtime_inject.bb');
  const escaped = injection.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = spawnSync(
    'bb',
    ['-e', `(load-file "${injectPath}") (agent-runtime-inject/notify-agent! "${sock}" "swarmforge-qa" "aider" :text "${escaped}")`],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
  );
  assert.equal(result.status, 0, `notify-agent! failed: ${result.stderr}`);
  return sentLiteralFromLog(fs.readFileSync(path.join(root, 'tmux-calls.log'), 'utf8'));
}

function typedTextViaInProcessResume(root, bin) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'sent'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  const probe = path.join(SCRIPTS, 'test', 'bl1719_wake_no_session_probe.bb');
  const result = spawnSync('bb', [probe, 'daemon-resume', root, sock, 'swarmforge-qa', 'aider'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  assert.equal(result.status, 0, `notify-in-process-resume! failed: ${result.stderr}\n${result.stdout}`);
  return sentLiteralFromLog(fs.readFileSync(path.join(root, 'tmux-calls.log'), 'utf8'));
}

// The fake tmux's `echo "$*" >> log` dumps one call per line UNLESS the
// call's own literal argument (the `-l <text>` send-keys payload) itself
// contains embedded newlines - the STOP banner does - in which case that
// one call spans several log lines. Every other call is short and starts
// with `-S <sock> `, which is what bounds the literal's own end: read from
// the `-l ` marker forward until a line starts with `-S ` again (the next
// real call) or the log ends.
function sentLiteralFromLog(log) {
  const lines = log.split('\n');
  const startIdx = lines.findIndex((l) => / send-keys .* -l /.test(l));
  assert.ok(startIdx !== -1, `expected a tmux send-keys -l call in the log, got:\n${log}`);
  const literalLines = [lines[startIdx].slice(lines[startIdx].indexOf(' -l ') + 4)];
  for (let i = startIdx + 1; i < lines.length && !lines[i].startsWith('-S '); i += 1) {
    literalLines.push(lines[i]);
  }
  return literalLines.join('\n');
}

// ── Scenario 02: the certification safety gate ──────────────────────────

const ENTRIES_KNOWN_VALUES = {
  'the two coordinator competencies and coder-stop_banner_compliance, all pass': [
    { competency: 'coordinator-infra_edit_refusal', status: 'pass' },
    { competency: 'coordinator-no_fabricated_work', status: 'pass' },
    { competency: 'coder-stop_banner_compliance', status: 'pass' },
  ],
  'the two coordinator competencies only, both pass': [
    { competency: 'coordinator-infra_edit_refusal', status: 'pass' },
    { competency: 'coordinator-no_fabricated_work', status: 'pass' },
  ],
  'all three passing plus coder-tool_capability_denial failing': [
    { competency: 'coordinator-infra_edit_refusal', status: 'pass' },
    { competency: 'coordinator-no_fabricated_work', status: 'pass' },
    { competency: 'coder-stop_banner_compliance', status: 'pass' },
    { competency: 'coder-tool_capability_denial', status: 'fail' },
  ],
};

const GATE_RESULT_KNOWN_VALUES = { open: true, closed: false };

function runSafetyGate(entries) {
  const libPath = path.join(SCRIPTS, 'model_steward_lib.bb');
  const edn = `[${entries.map((e) => `{:competency "${e.competency}" :status "${e.status}"}`).join(' ')}]`;
  const out = execFileSync('bb', ['-e', `(load-file "${libPath}") (println (:ok? (model-steward-lib/certification-safety-gate ${edn})))`], {
    encoding: 'utf8',
  });
  return out.trim() === 'true';
}

// ── Scenario 03: the battery survives one timed-out escalating probe ────

// Stands in for the running Ollama endpoint via HTTP_PROXY (requests
// honors it even for a 127.0.0.1 target - verified: a bare proxy attempt
// against a closed port raises ProxyError, never reaching the real
// target), so local_model_compliance_battery.py's own hardcoded
// http://127.0.0.1:11434 is never touched or contacted - this host's own
// real ollama (checked live before use) is never reached, let alone
// disturbed. coder-stop_banner_compliance's system prompt ("You are the
// SwarmForge coder in aider") is the ONE competency this stand-in stalls;
// every other call gets an immediate, generic, schema-valid reply (every
// core-battery/other-safety-probe caller already wraps its own chat() in
// try/except, so a bland answer just yields pass or fail, never a crash -
// this scenario only requires PRESENCE, not a passing verdict, for the
// other competencies).
function startStandInEndpoint(stallOnSystemPromptSubstring) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* malformed body - fall through to the generic reply below */
      }
      const messages = parsed.messages || [];
      const systemMessage = messages.find((m) => m.role === 'system');
      if (systemMessage && systemMessage.content && systemMessage.content.includes(stallOnSystemPromptSubstring)) {
        // Never respond - the client's own configured timeout fires.
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (/\/v1\/chat\/completions/.test(req.url)) {
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'stand-in reply' } }] }));
      } else {
        res.end(JSON.stringify({ message: { role: 'assistant', content: 'stand-in reply' } }));
      }
    });
  });
  return server;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────

  scoped(/^(.+) is typed into an aider QA seat through notify-agent! and the fake tmux$/, (ctx, injection) => {
    const kind = knownInjection(injection);
    const root = mkTmpDir('bl1707-fallback-');
    const { bin } = buildFakeTmux(root);
    ctx.bl1707 = ctx.bl1707 || {};
    ctx.bl1707.typedText = kind === 'direct' ? typedTextForDirectInjection(root, bin, injection) : typedTextViaInProcessResume(root, bin);
  });

  scoped(/^the typed text ends with the fallback command "(.+)"$/, (ctx, fallback) => {
    const expectedTail = `\`! ${fallback}\``;
    assert.ok(
      ctx.bl1707.typedText.endsWith(expectedTail),
      `expected the typed text to end with ${JSON.stringify(expectedTail)}, got tail: ${JSON.stringify(ctx.bl1707.typedText.slice(-120))}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(/^a scorecard whose safety entries are (.+)$/, (ctx, entriesLabel) => {
    const entries = ENTRIES_KNOWN_VALUES[entriesLabel];
    assert.ok(entries, `unknown <entries> example value "${entriesLabel}"`);
    ctx.bl1707 = ctx.bl1707 || {};
    ctx.bl1707.entries = entries;
  });

  scoped(/^the certification safety gate reads it$/, (ctx) => {
    ctx.bl1707.gateOk = runSafetyGate(ctx.bl1707.entries);
  });

  scoped(/^the gate is "(open|closed)"$/, (ctx, result) => {
    const expected = GATE_RESULT_KNOWN_VALUES[result];
    assert.equal(ctx.bl1707.gateOk, expected, `expected the gate's :ok? to be ${expected} ("${result}"), got ${ctx.bl1707.gateOk}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────

  scoped(/^a stand-in model endpoint that times out on one escalating probe and answers every other call$/, async (ctx) => {
    // Never build this fixture if the real endpoint is unreachable-check
    // is unnecessary either way (the proxy intercepts before any request
    // would reach 127.0.0.1:11434), but confirming a live ollama is
    // running - and therefore genuinely at risk from a mistake in this
    // fixture - is exactly why the stand-in exists rather than a "just
    // point it at 11434 directly" shortcut.
    ctx.bl1707 = ctx.bl1707 || {};
    ctx.bl1707.server = startStandInEndpoint('SwarmForge coder in aider');
    ctx.bl1707.proxyPort = await listen(ctx.bl1707.server);
    ctx.bl1707.scorecardPath = path.join(mkTmpDir('bl1707-battery-'), 'scorecard.json');
  });

  scoped(/^the local compliance battery runs against it$/, (ctx) => {
    const battery = path.join(SCRIPTS, 'local_model_compliance_battery.py');
    const proxyUrl = `http://127.0.0.1:${ctx.bl1707.proxyPort}`;
    // An inherited NO_PROXY/no_proxy naming 127.0.0.1 (a common host/CI
    // default) makes Python's `requests` silently BYPASS HTTP_PROXY for a
    // 127.0.0.1 target (verified: requests.utils.get_environ_proxies
    // returns {} once NO_PROXY covers the host) - which would route this
    // straight past the stand-in and onto the real, live ollama this
    // fixture exists to never touch. Strip both case variants from the
    // spawned env so no ambient host config can defeat the interception,
    // whatever this host (or a future one) happens to have set.
    const env = { ...process.env };
    delete env.NO_PROXY;
    delete env.no_proxy;
    ctx.bl1707.run = spawnSync('python3', [battery, 'bl1707-stand-in-model', ctx.bl1707.scorecardPath, '--only-safety'], {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...env,
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        MODEL_STEWARD_BATTERY_TIMEOUT_S: '2',
      },
    });
  });

  scoped(/^the scorecard is written with that probe's competency recorded as not passing$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.bl1707.scorecardPath), `expected a scorecard to be written despite the timeout; battery stderr:\n${ctx.bl1707.run.stderr}`);
    const scorecard = JSON.parse(fs.readFileSync(ctx.bl1707.scorecardPath, 'utf8'));
    const entry = scorecard.entries.find((e) => e.competency === 'coder-stop_banner_compliance');
    assert.ok(entry, `expected a coder-stop_banner_compliance entry, got: ${JSON.stringify(scorecard.entries)}`);
    assert.notEqual(entry.status, 'pass', `expected the timed-out probe to NOT be recorded as passing, got: ${JSON.stringify(entry)}`);
    ctx.bl1707.scorecard = scorecard;
  });

  scoped(/^every other competency the battery ran is present in the scorecard$/, async (ctx) => {
    const names = ctx.bl1707.scorecard.entries.map((e) => e.competency);
    for (const expected of ['coordinator-infra_edit_refusal', 'coordinator-no_fabricated_work']) {
      assert.ok(names.includes(expected), `expected ${expected} to be present in the scorecard, got: ${JSON.stringify(names)}`);
    }
    await close(ctx.bl1707.server);
  });
}

module.exports = { registerSteps };
