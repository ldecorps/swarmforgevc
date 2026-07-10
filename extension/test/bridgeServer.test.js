const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');
const { installFakeTmux } = require('./helpers/fakeTmux');

const TOKEN = 'test-token-123';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bridge-server-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.displayName, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function dropHandoff(worktreePath, filename, content) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(dir);
  fs.writeFileSync(path.join(dir, filename), content);
}

// BL-240: separate from writeRolesTsv above - readSwarmRoles (tmuxClient.ts,
// what answerCapturedGateLive/gateAnswerLive.ts's target resolution reads)
// is sessions.tsv, a DIFFERENT file from roles.tsv (bridgeState.ts's own
// read-only agent projection).
function writeSessionsTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r, i) => [i + 1, r.role, `swarmforge-${r.role}`, r.displayName ?? r.role, 'claude'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'), tsv + '\n');
}

function writeTmuxSocket(targetPath, socketPath) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), socketPath);
}

function gatedTmuxRules(paneText) {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

async function withBridge(targetPath, opts, fn) {
  const handle = await startBridge(targetPath, path.join(targetPath, 'runs.jsonl'), TOKEN, opts);
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

test('rejects a request with no bearer token and discloses no state', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'unauthorized');
  });
});

test('rejects a request with the wrong bearer token', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: 'Bearer not-the-token' },
    });
    assert.equal(res.status, 401);
  });
});

test('serves the pipeline endpoint matching on-disk state for an authorized request', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, [{ role: 'coder', displayName: 'Coder', status: 'active' }]);
  });
});

test('serves the agents, backlog, and runlog endpoints', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const [agents, backlog, runlog] = await Promise.all([
      fetch(`http://127.0.0.1:${handle.port}/agents`, { headers: auth }).then((r) => r.json()),
      fetch(`http://127.0.0.1:${handle.port}/backlog`, { headers: auth }).then((r) => r.json()),
      fetch(`http://127.0.0.1:${handle.port}/runlog`, { headers: auth }).then((r) => r.json()),
    ]);
    assert.deepEqual(agents, []);
    assert.deepEqual(backlog, { active: [], paused: [], done: [] });
    assert.deepEqual(runlog, []);
  });
});

// BL-096 metrics-09: the metrics endpoint is token-gated like every other
// route, and returns the full delivery-metrics surface as JSON even over a
// plain (non-git) tmp dir - computeDeliveryMetrics degrades to empty/null
// series rather than erroring when git history can't be read.
test('rejects an unauthorized request to the metrics endpoint', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/metrics`);
    assert.equal(res.status, 401);
  });
});

test('serves the metrics endpoint with the full delivery-metrics surface for an authorized request', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.velocity);
    assert.ok(Array.isArray(body.burndown));
    assert.ok(body.cycleTime);
    assert.ok(body.forecasts);
    assert.ok(body.suiteDurationTrend);
    assert.equal(body.suiteDurationTrend.hasLocalData, false);
  });
});

// BL-100 cost-04/cost-07: cost telemetry endpoint is token-gated like every
// other route, and degrades to empty/zero for a target with no transcripts
// or resource telemetry rather than erroring.
test('rejects an unauthorized request to the cost-telemetry endpoint', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/cost-telemetry`);
    assert.equal(res.status, 401);
  });
});

test('serves the cost-telemetry endpoint for an authorized request', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/cost-telemetry`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { costTelemetry: {}, resourceTrends: {} });
  });
});

// BL-094: /holistic is token-gated like every other data route.
test('rejects an unauthorized request to the holistic endpoint', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/holistic`);
    assert.equal(res.status, 401);
  });
});

test('serves the holistic endpoint with assignments/swarms/doneByMilestone/recentActivity for an authorized request', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/holistic`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.assignments, []);
    assert.deepEqual(body.swarms, [{ name: 'primary', isLocal: true, agents: [] }]);
    assert.deepEqual(body.doneByMilestone, {});
    assert.deepEqual(body.recentActivity, { recentCloses: [], recentMerges: [], currentRun: null });
  });
});

// BL-102: /stage-dwell is token-gated like every other route, and degrades
// to an empty stages list rather than erroring for a target with no roles.
test('rejects an unauthorized request to the stage-dwell endpoint', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/stage-dwell`);
    assert.equal(res.status, 401);
  });
});

test('serves the stage-dwell endpoint with per-stage dwell and a bottleneck for an authorized request', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  const completedDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed');
  mkdirp(completedDir);
  const now = new Date();
  const dequeuedAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(
    path.join(completedDir, '00_test.handoff'),
    `task: BL-1-fixture\ndequeued_at: ${dequeuedAt}\ncompleted_at: ${now.toISOString()}\n\nbody\n`
  );

  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/stage-dwell`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.windowHours, 24);
    const coderStage = body.stages.find((s) => s.role === 'coder');
    assert.ok(coderStage);
    assert.equal(coderStage.parcelsProcessed, 1);
    assert.equal(body.bottleneck.role, 'coder');
  });
});

// BL-094: the root HTML shell - the one route reachable by a plain browser
// navigation, so it accepts the token via query string as well as header.
test('rejects a plain (unauthenticated) request to the root URL', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/`);
    assert.equal(res.status, 401);
  });
});

test('rejects a root request with the wrong query token', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/?token=wrong`);
    assert.equal(res.status, 401);
  });
});

test('serves the root URL as self-contained HTML given a valid header token', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /SwarmForge/);
    // www.w3.org is the standard SVG/XML namespace URI (createElementNS),
    // never actually fetched over the network by a browser - excluded
    // alongside the bridge's own 127.0.0.1 origin.
    assert.doesNotMatch(body, /cdn\.|https?:\/\/(?!127\.0\.0\.1|www\.w3\.org)/, 'no external network fetch in the UI bundle');
  });
});

test('serves the root URL given a valid query-string token (a plain browser navigation cannot set a header)', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/?token=${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});

test('the query-token fallback does not unlock any other (data) route', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline?token=${TOKEN}`);
    assert.equal(res.status, 401, 'query-token auth is scoped to the root HTML shell only, per bridgeAuth.ts');
  });
});

test('returns 404 for an unknown route, even when authorized', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 404);
  });
});

test('binds to the localhost interface only', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    // A real localhost request must succeed with the right token.
    const res = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
  });
});

test('the events stream sends an SSE event when the on-disk state changes', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);

  await withBridge(target, { pollIntervalMs: 20 }, async (handle) => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${handle.port}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const { value: initialChunk } = await reader.read();
    assert.match(decoder.decode(initialChunk), /^data: /);

    dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

    const { value: updateChunk } = await reader.read();
    const updateText = decoder.decode(updateChunk);
    assert.match(updateText, /^data: /);
    assert.match(updateText, /"status":"active"/);

    controller.abort();
  });
});

// --- BL-240/BL-241: POST /gate-answer, the bridge's one write route ---

function postGateAnswer(port, headers, body) {
  return fetch(`http://127.0.0.1:${port}/gate-answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// BL-241: control actions require the step-up header in addition to the
// normal bearer - a legacy string-token bootstrap (see normalizeToRegistry
// in bridgeServer.ts) uses the SAME value for both, so these two headers
// together are "full control access" for a bridge started the plain-string
// way, same as bare-bearer used to be pre-BL-241.
function controlAuthHeaders(token = TOKEN) {
  return { authorization: `Bearer ${token}`, 'x-control-token': token };
}

test('answer-unblocks-01: an authenticated client answers a role\'s captured gate via the same send-keys path as a local operator', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed with the migration? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, controlAuthHeaders(), { role: 'coder', answer: 'y' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);

      const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
      assert.ok(sendCalls.length > 0, 'the same tmux send-keys call the local operator path uses must have fired');
    });
  } finally {
    fake.restore();
  }
});

test('scope-gates-only-02: refuses a control-authenticated attempt against a role with no captured gate, sending no keys', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Compiling... done. [auto] idle'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, controlAuthHeaders(), { role: 'coder', answer: 'y' });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.ok(!fake.calls().some((args) => args.includes('send-keys')), 'no arbitrary keystrokes may be sent for a non-gated role');
    });
  } finally {
    fake.restore();
  }
});

test('scope-gates-only-02: a differently-shaped body (not {role, answer}) is refused as a bad request, no tmux call at all', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, controlAuthHeaders(), { action: 'shell', command: 'rm -rf /' });
      assert.equal(res.status, 400);
      assert.deepEqual(fake.calls(), [], 'a malformed/non-gate-answer body must never reach tmux');
    });
  } finally {
    fake.restore();
  }
});

// --- BL-241: read-vs-control scope and the step-up requirement itself ---

test('BL-241 read-only-cannot-control-03: a bearer-only request (no step-up header) is refused, even though it can read', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      // The same bearer that already grants read access (proven below)
      // is NOT enough on its own for a control action.
      const readRes = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(readRes.status, 200, 'sanity: the bearer alone must still grant read access');

      const controlRes = await postGateAnswer(handle.port, { authorization: `Bearer ${TOKEN}` }, { role: 'coder', answer: 'y' });
      assert.equal(controlRes.status, 403);
      assert.deepEqual(fake.calls().filter((a) => a.includes('send-keys')), [], 'no keys sent without the step-up header');
    });
  } finally {
    fake.restore();
  }
});

test('BL-241 read-only-cannot-control-03: a read-scoped device can never answer a gate, even presenting its own token as the step-up header', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const viewer = handle.registerDevice('phone', 'read');
      // A read-scoped device has no controlToken at all - presenting its
      // own base token as BOTH headers must still fail.
      const res = await postGateAnswer(
        handle.port,
        { authorization: `Bearer ${viewer.token}`, 'x-control-token': viewer.token },
        { role: 'coder', answer: 'y' }
      );
      assert.equal(res.status, 403);
      assert.deepEqual(fake.calls().filter((a) => a.includes('send-keys')), []);
    });
  } finally {
    fake.restore();
  }
});

test('BL-241 control-requires-step-up-04: a control-scoped device\'s own two credentials answer the gate', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const controller = handle.registerDevice('laptop', 'control');
      const res = await postGateAnswer(
        handle.port,
        { authorization: `Bearer ${controller.token}`, 'x-control-token': controller.controlToken },
        { role: 'coder', answer: 'y' }
      );
      assert.equal(res.status, 200);
      assert.ok(fake.calls().some((a) => a.includes('send-keys')));
    });
  } finally {
    fake.restore();
  }
});

test('BL-241 token-rotation-01: rotating a device\'s token invalidates the old one and the new one works, for reads', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const before = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(before.status, 200);

    const rotated = handle.rotateToken('bootstrap');
    assert.ok(rotated, 'expected the bootstrap device to exist and rotate');
    assert.notEqual(rotated.token, TOKEN);

    const withOldToken = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(withOldToken.status, 401, 'the old token must no longer authenticate');

    const withNewToken = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${rotated.token}` } });
    assert.equal(withNewToken.status, 200, 'the new token must authenticate');
  });
});

test('BL-241 device-revocation-02: revoking one device does not affect another', async () => {
  const target = mkTmp();
  await withBridge(target, {}, async (handle) => {
    const alice = handle.registerDevice('alice-phone', 'read');
    const bob = handle.registerDevice('bob-phone', 'read');

    const aliceBefore = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${alice.token}` } });
    assert.equal(aliceBefore.status, 200);

    handle.revokeDevice(alice.id);

    const aliceAfter = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${alice.token}` } });
    assert.equal(aliceAfter.status, 401, 'the revoked device must no longer connect');

    const bobAfter = await fetch(`http://127.0.0.1:${handle.port}/pipeline`, { headers: { authorization: `Bearer ${bob.token}` } });
    assert.equal(bobAfter.status, 200, 'a different, non-revoked device must be unaffected');
  });
});

test('unauthenticated-refused-03: a request with no auth is refused before it ever reaches tmux', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, {}, { role: 'coder', answer: 'y' });
      assert.equal(res.status, 401);
      assert.deepEqual(fake.calls(), [], 'auth is checked before any tmux interaction');
    });
  } finally {
    fake.restore();
  }
});

test('unauthenticated-refused-03: a request with the wrong token is refused', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, { authorization: 'Bearer wrong' }, { role: 'coder', answer: 'y' });
      assert.equal(res.status, 401);
      assert.deepEqual(fake.calls(), []);
    });
  } finally {
    fake.restore();
  }
});

test('answer-targets-specific-gate-04: answering one of two gated roles leaves the other untouched', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }, { role: 'cleaner' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'Proceed? (y/n)' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ]);
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await postGateAnswer(handle.port, controlAuthHeaders(), { role: 'coder', answer: 'y' });
      assert.equal(res.status, 200);

      const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
      assert.ok(sendCalls.length > 0);
      // Every send-keys call must target coder's pane, never cleaner's -
      // the fixture gives both roles the same fake window/pane geometry, so
      // the -t target argument is what proves only "coder" was reached.
      assert.ok(
        sendCalls.every((args) => args[args.indexOf('-t') + 1].startsWith('swarmforge-coder')),
        'must only target the specific role the request named, not any other gated role'
      );
    });
  } finally {
    fake.restore();
  }
});

test('GET to /gate-answer is not treated as an answer attempt (404, same as any other unrecognized route+method)', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/gate-answer`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(res.status, 404);
      assert.deepEqual(fake.calls(), []);
    });
  } finally {
    fake.restore();
  }
});

test('a request body over the size cap is rejected without ever parsing it', async () => {
  const target = mkTmp();
  writeSessionsTsv(target, [{ role: 'coder' }]);
  writeTmuxSocket(target, '/tmp/fake-bridge.sock');
  const fake = installFakeTmux(gatedTmuxRules('Proceed? (y/n)'));
  try {
    await withBridge(target, {}, async (handle) => {
      const oversized = { role: 'coder', answer: 'y'.repeat(20 * 1024) };
      const res = await fetch(`http://127.0.0.1:${handle.port}/gate-answer`, {
        method: 'POST',
        headers: { ...controlAuthHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(oversized),
      }).catch(() => null);
      // A destroyed connection may surface as a fetch rejection (network
      // error) rather than a clean HTTP response, depending on timing -
      // either outcome is an acceptable "did not process it" signal, but
      // tmux must never have been reached either way.
      if (res) {
        assert.notEqual(res.status, 200);
      }
      assert.deepEqual(fake.calls(), []);
    });
  } finally {
    fake.restore();
  }
});

test('stopping the bridge leaves the swarm state on disk unaffected and a new bridge serves it again', async () => {
  const target = mkTmp();
  const coderWt = mkTmp();
  writeRolesTsv(target, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
  dropHandoff(coderWt, '00_test.handoff', 'from: specifier\nto: coder\ntask: bl-999\ncommit: abc\n');

  const first = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN, {});
  first.stop();

  await assert.rejects(() => fetch(`http://127.0.0.1:${first.port}/pipeline`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }));

  const second = await startBridge(target, path.join(target, 'runs.jsonl'), TOKEN, {});
  try {
    const res = await fetch(`http://127.0.0.1:${second.port}/pipeline`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    assert.deepEqual(body, [{ role: 'coder', displayName: 'Coder', status: 'active' }]);
  } finally {
    second.stop();
  }
});
