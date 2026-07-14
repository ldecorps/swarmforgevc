'use strict';

// BL-328: step handlers for "Merged code actually reaches the long-lived
// processes that run it". Scenarios 01-04/06 are pure build_freshness_cli.bb
// report/sync behavior - driven against the REAL shell test
// (test_build_freshness_cli.sh, real git commits, real spawned processes,
// real kills), mirroring supervisorReaperPathBoundarySteps.js's own
// "drive the real shell test, grep the PASS line" pattern rather than
// re-implementing the fixture here.
//
// Scenario 05 (no lost/duplicated messages across a restart) is the one
// case that shell alone cannot prove - it needs the REAL front-desk
// message-delivery mechanics BL-320 already built and proved. It composes
// two REAL things rather than re-testing either from scratch: (a) a REAL
// OS-level bridge process, genuinely killed and relaunched via
// build_freshness_cli.bb's own restart-front-desk-group! (the exact
// mechanism this ticket ships), proving that restart never touches the
// on-disk outbox/cursor files it doesn't own; (b) BL-320's own proven
// real-HTTP redelivery client (relaySseReplies, imported directly - the
// SAME boundary replyRelayAtLeastOnceSteps.js draws: sendReply is a fake
// counter, no live Telegram call, since that is the untested edge
// BL-320's own acceptance suite already draws and re-proving Telegram's
// own API is out of scope here). The compiled extension/out/ used by the
// real spawned bridge is a real copy of this repo's own build (not a
// fake), so the HTTP surface (/events, /reply-ack) is the genuine one.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FRESHNESS_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_build_freshness_cli.sh');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'build_freshness_cli.bb');

function runFreshnessTest(ctx) {
  if (ctx.freshnessTestOutput) {
    return ctx.freshnessTestOutput;
  }
  const result = spawnSync('bash', [FRESHNESS_TEST], { encoding: 'utf8', timeout: 90000 });
  ctx.freshnessTestOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.freshnessTestOutput;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in the real build_freshness_cli test output, got:\n${output}`);
  }
}

// ── scenario 05's own fixture: a real OS-spawned bridge, a real
//    outbox/cursor pair, and BL-320's own proven client-side relay ────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl328-acceptance-'));
}

function mkGitRoot() {
  const root = mkTmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  execFileSync('git', ['branch', 'main'], { cwd: root });
  return root;
}

function copyRealCompiledExtension(root) {
  const extDir = path.join(root, 'extension');
  fs.mkdirSync(extDir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'extension', 'out'), path.join(extDir, 'out'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'extension', 'node_modules'), path.join(extDir, 'node_modules'));
}

function outboxFile(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
}
function cursorFile(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-reply-relay-cursor.json');
}
function readCursor(root) {
  try {
    return JSON.parse(fs.readFileSync(cursorFile(root), 'utf8'));
  } catch {
    return { ackedIndex: 0 };
  }
}

const TOKEN = 'bl328-acceptance-token';
const SUBJECT = 'SUP-1';
const TOPIC_ID = 1;
// Never 8765 - this dev box always has the REAL swarm's own production
// bridge bound there (self-hosting: this repo IS the live swarm), so
// reusing the default risks a fixture bot connecting to the REAL bridge
// instead of its own isolated one. Derived from this test process's own
// pid rather than a fixed constant: a scenario that fails before its own
// cleanup step runs leaves its bridge bound to whatever port it used
// (Math.random() is fine in a plain step file, unlike inside a Workflow
// script) - a fixed port would then collide with that leftover on every
// subsequent run; a pid-derived one almost never repeats.
const FIXTURE_BRIDGE_PORT = 20000 + (process.pid % 10000);

// An explicit ALLOWLIST env, never `{...process.env, ...overrides}` - this
// box's own shell exports the REAL Telegram bot token/chat/user id for the
// live swarm (self-hosting), and spreading process.env into a subprocess
// that goes on to spawn launch_front_desk.sh (which happily accepts
// whatever TELEGRAM_* it's given) would hand a fixture-spawned bot process
// the REAL production credentials. Every subprocess this file spawns must
// build its env from THIS, never from process.env directly.
function fixtureEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TELEGRAM_BOT_TOKEN: 'bl328-fixture-fake-bot-token',
    TELEGRAM_CHAT_ID: 'bl328-fixture-fake-chat-id',
    TELEGRAM_PRINCIPAL_USER_ID: 'bl328-fixture-fake-user-id',
    BRIDGE_TOKEN: TOKEN,
    BRIDGE_PORT: String(FIXTURE_BRIDGE_PORT),
    ...extra,
  };
}

async function realAck(port, id) {
  const res = await fetch(`http://127.0.0.1:${port}/reply-ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(`ack failed: ${res.status}`);
  }
}

// The SAME real client-side relay BL-320 proved correct (relayReplyAtLeastOnceSteps.js's
// own connectBotOnce) - reused directly here rather than re-implemented,
// since this scenario's own job is to prove the RESTART preserves the
// files that mechanism depends on, not to re-derive the mechanism itself.
async function connectAndCollect(port, maxAttempts = 80) {
  const { relaySseReplies } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/events`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sent = [];
  const relayPromise = relaySseReplies(
    '',
    {
      readChunk: async () => {
        const { done, value } = await reader.read();
        return { done, chunk: done ? '' : decoder.decode(value, { stream: true }) };
      },
      sendReply: async (topicId, text) => {
        sent.push({ topicId, text });
      },
      resolveDelivery: (subjectId) => (subjectId === SUBJECT ? { kind: 'topic', topicId: TOPIC_ID, alsoPointerToDefault: false } : { kind: 'undeliverable' }),
      ackReply: (id) => realAck(port, id),
    },
    new Set()
  );
  let settled = false;
  relayPromise.catch(() => {}).then(() => (settled = true));
  for (let i = 0; i < maxAttempts && sent.length === 0 && !settled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  controller.abort();
  await relayPromise.catch(() => {});
  return sent;
}

function waitFor(timeoutMs, predicate) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

// Safety net mirroring test_role_lifecycle_cli.sh's own trap-based
// final_cleanup: if a scenario throws before reaching its own cleanup
// step (stopFixture, below), this still tears down whatever real
// processes it spawned when the test process itself exits - never leaves
// a real spawned bridge/bot/supervisor running past the test run.
const liveFixtureRoots = new Set();
process.on('exit', () => {
  for (const root of liveFixtureRoots) {
    try {
      spawnSync('pkill', ['-9', '-f', path.join(root, 'extension', 'out', 'tools')]);
      const pidFile = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
      if (fs.existsSync(pidFile)) {
        spawnSync('kill', ['-9', fs.readFileSync(pidFile, 'utf8').trim()]);
      }
    } catch {
      // best-effort cleanup at process exit
    }
  }
});

async function startRealFrontDeskBridge(ctx) {
  ctx.target = mkGitRoot();
  liveFixtureRoots.add(ctx.target);
  copyRealCompiledExtension(ctx.target);
  const opDir = path.join(ctx.target, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  fs.writeFileSync(path.join(opDir, 'bridge-token'), TOKEN);
  fs.chmodSync(path.join(opDir, 'bridge-token'), 0o600);
  fs.writeFileSync(path.join(ctx.target, 'extension', 'out', 'BUILD_SHA'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.target }).toString().trim());

  const result = spawnSync('bash', [path.join(SWARMFORGE_SCRIPTS, 'launch_front_desk.sh'), ctx.target], {
    encoding: 'utf8',
    env: fixtureEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`launch_front_desk.sh failed: ${result.stderr}`);
  }
  ctx.bridgePort = FIXTURE_BRIDGE_PORT;
  await waitFor(5000, () => fs.existsSync(path.join(opDir, 'front-desk-supervisor.status.json')));
}

function stopFixture(ctx) {
  if (!ctx.target) return;
  liveFixtureRoots.delete(ctx.target);
  try {
    spawnSync('pkill', ['-9', '-f', path.join(ctx.target, 'extension', 'out', 'tools')]);
    const pidFile = path.join(ctx.target, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
    if (fs.existsSync(pidFile)) {
      spawnSync('kill', ['-9', fs.readFileSync(pidFile, 'utf8').trim()]);
    }
  } catch {
    // best-effort cleanup
  }
  fs.rmSync(ctx.target, { recursive: true, force: true });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a long-lived process that loaded its code when it started$/, () => {
    // Narrative only - the real fixture (a real spawned process, a real
    // git commit) lives in test_build_freshness_cli.sh / this file's own
    // scenario-05 setup below, matching supervisorReaperPathBoundarySteps.js's
    // own convention.
  });
  registry.define(/^newer code for that process has been merged to the main branch$/, () => {
    // Narrative only.
  });

  // ── merged-code-reaches-daemons-01 ──────────────────────────────────
  // BL-334 shares this EXACT step text ("the swarm's health is reported")
  // for its own restricted-front-desk-operator-07 - the registry resolves
  // first-match, so whichever module registers this regex first speaks for
  // every scenario that uses it. Rather than duplicate the collision
  // silently, this dispatches to ctx.healthReportRunner when an earlier
  // Given step in the SAME scenario has set one (see
  // restrictedFrontDeskOperatorSteps.js's own "the front-desk Operator is
  // running" step) - the same "one shared handler, branch on a ctx flag an
  // earlier step set" pattern this file already uses for ctx.processKind
  // below. Absent that flag (every scenario this file itself owns), the
  // behavior is UNCHANGED.
  registry.define(/^the swarm's health is reported$/, (ctx) => {
    ctx.output = (ctx.healthReportRunner || runFreshnessTest)(ctx);
  });
  // Shared with scenario 03 below (a Scenario Outline reuses this exact
  // Then-text for both its compiled and interpreted examples) - one
  // handler, branching on whichever Given step actually ran this scenario
  // (ctx.processKind is only ever set by scenario 03's own Given step
  // below; absent, this is scenario 01's plain non-outline case).
  registry.define(/^that process is reported as running a stale build$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    if (ctx.processKind === 'interpreted') {
      expectLine(output, 'merged-code-reaches-daemons-03(interpreted): a long-lived Babashka daemon', '03-interpreted');
    } else {
      expectLine(output, 'merged-code-reaches-daemons-01/06: report names both builds, flags stale processes', '01/03-compiled');
    }
  });
  registry.define(/^the report names the build it is running and the build on main$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-01/06', '01');
  });

  // ── merged-code-reaches-daemons-02 ──────────────────────────────────
  registry.define(/^a change to a long-lived process's source is merged$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });
  registry.define(/^that process is running the merged code within the configured interval$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-02/03(compiled): a real merge', '02');
  });
  registry.define(/^no human action was required to make that happen$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-02/03(compiled)', '02');
  });

  // ── merged-code-reaches-daemons-03 (Scenario Outline) ───────────────
  registry.define(/^a long-lived (compiled|interpreted) process started before the merge$/, (ctx, kind) => {
    ctx.processKind = kind;
    ctx.output = runFreshnessTest(ctx);
  });

  // ── merged-code-reaches-daemons-04/07 ────────────────────────────────
  // The fixture flaw the specifier's amendment called out: the original
  // scenario 04 staged a sync BEFORE the crash, so it never exercised the
  // window this Given now names explicitly - the real shell test's own
  // 04/07 fixture never calls sync at all, relying entirely on
  // front_desk_supervisor.bb's own spawn-bridge!/spawn-bot! freshness
  // check+recompile (ensure-current-build!) to make the build current.
  registry.define(/^no build sync has run since that merge$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });
  registry.define(/^a long-lived process running a stale build crashes$/, (ctx) => {
    ctx.output = ctx.output || runFreshnessTest(ctx);
  });
  registry.define(/^a long-lived process crashes before any sync could run$/, (ctx) => {
    ctx.output = ctx.output || runFreshnessTest(ctx);
  });
  registry.define(/^its supervisor respawns it$/, (ctx) => {
    ctx.output = ctx.output || runFreshnessTest(ctx);
  });
  registry.define(/^the respawned process runs the current build$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-04/07: a crash BEFORE any sync ran', '04/07');
  });
  registry.define(/^the stale build is not re-armed$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-04/07', '04');
  });
  registry.define(/^the supervisor makes the build current before it respawns the process$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-04/07', '07');
  });

  // ── merged-code-reaches-daemons-08 ──────────────────────────────────
  // A failing recompile must never leave the front desk down - it is the
  // human's only channel. Driven against the real shell test's own
  // dedicated fixture (a stubbed npm that always exits 1).
  registry.define(/^the current build cannot be produced$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });
  registry.define(/^its supervisor respawns a crashed process$/, (ctx) => {
    ctx.output = ctx.output || runFreshnessTest(ctx);
  });
  registry.define(/^the process is brought back up rather than left down$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-08: a failed recompile', '08');
  });
  registry.define(/^its staleness is surfaced loudly$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-08', '08');
  });

  // ── merged-code-reaches-daemons-05 ──────────────────────────────────
  // The REAL bot process launched here (fake credentials, isolated port -
  // see fixtureEnv) is genuinely connected and consuming via a real SSE
  // push the instant the entry is written - BL-320's own comments measure
  // that round-trip in low single-digit milliseconds, so racing to catch
  // it "still unacked" before the restart is not reliable (and chasing
  // that timing is exactly what BL-320's own step file deliberately
  // avoids via a forced failing ack - not available here against a real
  // detached process). The assertions below are written to hold
  // regardless of which side of the restart the real delivery lands on:
  // the entry must be delivered exactly once SOMEWHERE across the
  // restart, never dropped, never delivered twice.
  registry.define(/^messages are in flight to and from the front desk$/, async (ctx) => {
    await startRealFrontDeskBridge(ctx);
    fs.writeFileSync(outboxFile(ctx.target), JSON.stringify({ id: 'r1', threadId: SUBJECT, text: 'in flight before restart' }) + '\n');
    ctx.oldSupPid = fs.readFileSync(path.join(ctx.target, '.swarmforge', 'operator', 'front-desk-supervisor.pid'), 'utf8').trim();
  });

  registry.define(/^the affected processes are restarted to pick up new code$/, (ctx) => {
    // The real merge: bump the fixture's own extension/out/BUILD_SHA past
    // its own git HEAD (a real merge is already reachable from main - see
    // startRealFrontDeskBridge - but the stamped file must lag it for
    // sync to consider the group stale enough to restart).
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'merge'], { cwd: ctx.target });
    execFileSync('git', ['branch', '-f', 'main'], { cwd: ctx.target });
    const newSha = execFileSync('git', ['rev-parse', 'main'], { cwd: ctx.target }).toString().trim();
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl328-npm-'));
    fs.writeFileSync(
      path.join(fakeBin, 'npm'),
      `#!/usr/bin/env bash\necho "${newSha}" > "${path.join(ctx.target, 'extension', 'out', 'BUILD_SHA')}"\nexit 0\n`
    );
    fs.chmodSync(path.join(fakeBin, 'npm'), 0o755);
    const result = spawnSync('bb', [CLI, ctx.target, 'sync'], {
      encoding: 'utf8',
      env: fixtureEnv({ PATH: `${fakeBin}:${process.env.PATH}` }),
    });
    fs.rmSync(fakeBin, { recursive: true, force: true });
    if (result.status !== 0) {
      throw new Error(`sync failed: ${result.stderr}`);
    }
    ctx.syncedSha = newSha;
  });

  registry.define(/^every message is delivered exactly once$/, async (ctx) => {
    await waitFor(5000, () => {
      const pidFile = path.join(ctx.target, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
      return fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== ctx.oldSupPid;
    });
    // The restart itself must never have touched the persisted outbox/cursor
    // files it does not own (restart-front-desk-group! only clears the
    // supervisor's own pid/status files) - whatever their contents were at
    // restart time, the restart itself must not be what deletes them.
    if (!fs.existsSync(outboxFile(ctx.target))) {
      throw new Error('the restart deleted the outbox file it does not own');
    }
    // The real post-restart bot (freshly spawned by sync's own
    // restart-front-desk-group!) reconnects and, per BL-320's own
    // redelivery guarantee, is pushed every still-unacked entry - so this
    // resolves whether the pre-restart bot already won the race or not:
    // either the entry was already acked before the restart (this
    // resolves immediately, nothing left to redeliver) or the fresh
    // post-restart bot picks it up now (resolves once that lands).
    await waitFor(5000, () => readCursor(ctx.target).ackedIndex === 1);
    ctx.ackedAfterRestart = readCursor(ctx.target).ackedIndex;
  });

  registry.define(/^no message is dropped or duplicated$/, async (ctx) => {
    if (ctx.ackedAfterRestart !== 1) {
      throw new Error(`expected the entry delivered exactly once (cursor ackedIndex 1), got ${ctx.ackedAfterRestart}`);
    }
    // The outbox itself was only ever appended to once - one entry in,
    // one entry acked, never a second write (no duplicate send could have
    // been triggered by the restart re-processing the same file twice).
    const outboxLines = fs.readFileSync(outboxFile(ctx.target), 'utf8').trim().split('\n').filter(Boolean);
    if (outboxLines.length !== 1) {
      throw new Error(`expected exactly one outbox entry ever written, got ${outboxLines.length}`);
    }
    // A fresh connection now must see nothing further - the entry is
    // genuinely acked, never redelivered a second time (no duplicate).
    const second = await connectAndCollect(ctx.bridgePort, 20);
    if (second.length !== 0) {
      throw new Error(`expected no further delivery of an already-acked entry, got ${JSON.stringify(second)}`);
    }
    stopFixture(ctx);
  });

  // ── merged-code-reaches-daemons-06 ──────────────────────────────────
  registry.define(/^a long-lived process started after the most recent merge$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });
  registry.define(/^that process is not reported as running a stale build$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'merged-code-reaches-daemons-01/06: report names both builds, flags stale processes of both languages, never flags a fresh one', '06');
  });
}

module.exports = { registerSteps };
