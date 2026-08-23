'use strict';

// BL-1081: step handlers for "one seat is driven by structured session events
// instead of pane text".
//
// Every step drives the REAL production code on both sides of the boundary
// this ticket creates: the compiled ACP host and seat state
// (extension/out/swarm/acp*.js) WRITE the seat snapshot, and the real Babashka
// deterministic layer (swarmforge/scripts/acp_session_lib.bb, and the real
// babysitter menu-block regex in babysitter_check.bb) READS it. Nothing here
// re-implements a decision, a stop reason table or a menu pattern in JS; a
// handler that did would keep passing after the production code it describes
// was deleted.
//
// The wire fixtures below are real ACP JSON-RPC shapes, fed to the real
// parser. That matters for scenario 01's second Then in particular: "no pane
// text is read" is only worth asserting if the verdict was reached from
// traffic rather than from a hand-built state object.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'swarm');
const ACP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'acp_session_lib.bb');
const LOOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'loop_detect_lib.bb');
const PROMPT_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'prompt_engine_lib.bb');
const BABYSITTER_CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb');
const HANDOFF_HELPER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.sh');

// BL-425 scoped registration. Several of these step texts are generic enough
// to be written verbatim by another ticket one day ("its pane is captured",
// "it hands the parcel on"), and this file registers LAST in the domain list -
// so an unscoped registration here could only ever capture a step no earlier
// handler matched, turning another feature's honest "no step handler matched"
// into a silent wrong pass. Scoping to this feature makes that impossible.
const FEATURE = 'one seat is driven by structured session events instead of pane text';

// BL-1081 architect bounce D1: the first pass asserted only against the pure
// lib, so it could not tell that the wiring pointed at a dead file. Scenarios
// 01 and 02 now also drive the REAL sweep - the same fixture BL-1071's
// scenarios use - so "the deterministic layer decides" means the layer that
// actually runs in the swarm, and a verdict wired somewhere nothing calls
// fails here.
const {
  LIVE_ROLE,
  makeSweepFixture,
  breakProbes,
  writeStub,
  runSweep,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'bl1071SweepFixture'));

const SWEEP_PREFIX = 'bl1081-live-';

const { parseAcpStream } = require(path.join(OUT, 'acpSessionEvents'));
const { foldAcpEvents, snapshotForSeat } = require(path.join(OUT, 'acpSeatState'));
const { AcpHostSession, acpSnapshotRelPath } = require(path.join(OUT, 'acpHostRuntime'));

// ── the wire ────────────────────────────────────────────────────────────
// Real ACP message shapes. `session/prompt`'s RESULT carries the stop reason;
// `session/request_permission` is a request with an id a host must answer.
const AGENT_SAYS = (text) =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  });
const TOOL = (toolName, status) =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolName, status } },
  });
const PERMISSION = (title, id) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: { sessionId: 's1', toolCall: { title } },
  });
const STOPPED = (stopReason) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason, sessionId: 's1' } });

const A_FINISHED_TURN = [
  AGENT_SAYS('reading the parcel'),
  TOOL('shell', 'in_progress'),
  TOOL('shell', 'completed'),
  AGENT_SAYS('committed the stage work'),
  STOPPED('end_turn'),
];

const A_TURN_AWAITING_PERMISSION = [
  AGENT_SAYS('this needs a write'),
  TOOL('write_file', 'in_progress'),
  PERMISSION('write_file', 7),
];

// What a pane-scraping implementation would consult. Scenario 01's second Then
// checks the real sources against these rather than restating their comments.
const PANE_READING_TOKENS = [
  'capture-pane',
  'capturePane',
  'pane-tail',
  'paneTail',
  'pane_current_command',
  'tmuxClient',
];

// A delivery path of its own is what scenario 04 forbids. `.swarmforge/acp/`
// is deliberately absent: that is the snapshot the host DOES write.
const MAILBOX_TOKENS = ['inbox/new', 'in_process', 'handoffs', 'outbox'];

// BL-421: every Examples-style value is validated against an explicit lookup.
// These are the four verdicts loop_detect_lib's own docstring declares.
const KNOWN_PANE_VERDICTS = ['no-task-spin', 'progress', 'busy', 'quiet'];

// The wake style every provider-table entry resolved BEFORE this ticket added
// the ACP dimension, read from the table at HEAD and pinned here. Scenario 05's
// first Then is a comparison against this, not a re-read of the same live table.
const WAKE_STYLE_BEFORE_ACP = {
  aider: 'shell-run-script',
  claude: 'chat-message',
  codex: 'chat-message',
  copilot: 'chat-message',
  gemini: 'chat-message',
  grok: 'chat-message',
  mock: 'mock',
  vibe: 'chat-message',
};

// ── the real deterministic layer, in one Babashka call ──────────────────
// One `bb` invocation per scenario: load-file dominates the cost, and a call
// per assertion made the acceptance run unusable.
function bbEval(program) {
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(res.status, 0, `the Babashka deterministic layer failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

// Hands the REAL bb reader a snapshot the REAL TypeScript side produced, plus
// the pane the host rendered, and returns every verdict it reaches.
function readSeat(snapshot, paneTail) {
  const program = `
(require '[cheshire.core :as json] '[babashka.fs :as fs])
(load-file "${ACP_LIB}")
(load-file "${LOOP_LIB}")
(let [snap ${JSON.stringify(JSON.stringify(snapshot))}
      pane ${JSON.stringify(paneTail)}
      dir (fs/create-temp-dir {:prefix "bl1081-steps-"})
      root (str dir)]
  (try
    (fs/create-dirs (fs/path root ".swarmforge" "acp"))
    (spit (str (acp-session-lib/snapshot-path root "coder")) snap)
    (let [s (acp-session-lib/read-snapshot root "coder")
          idle (acp-session-lib/idle-decision s)
          assess (acp-session-lib/apply-acp-facts
                  {:role "coder" :alive? true :pane-tail pane :in-process-count 1
                   :loop-signal (loop-detect-lib/classify-pane-loop-signal pane)
                   :idle-ms 900000}
                  s
                  (acp-session-lib/stop-reason s))]
      (println (json/generate-string
                {:acpHosted (acp-session-lib/acp-hosted? s)
                 :stopReason (acp-session-lib/stop-reason s)
                 :idle (:idle? idle)
                 :idleFrom (:from idle)
                 :permissionPending (acp-session-lib/permission-pending? s)
                 :menuCheckApplies (acp-session-lib/menu-check-applies? s)
                 :paneVerdict (name (loop-detect-lib/classify-pane-loop-signal pane))
                 :assess assess})))
    (finally (fs/delete-tree dir))))`;
  return bbEval(program);
}

function hostATurn(lines) {
  const pane = [];
  const snapshots = [];
  const session = new AcpHostSession(
    { writeLine: (line) => pane.push(line), writeSnapshot: (snapshot) => snapshots.push(snapshot) },
    { role: 'coder' }
  );
  session.ingestAll(lines);
  return { pane, snapshots, snapshot: session.snapshot() };
}

function readSource(file) {
  return fs.readFileSync(file, 'utf8');
}

// A pane that reads BUSY and never changes: exactly the shape check 7's
// frozen-pane WARN is built to catch, and exactly the shape a truncated tail
// or a frozen render produces while the agent is working fine.
const BUSY_FROZEN_PANE = "✻ Thinking… (42s · esc to interrupt)";

// A pane carrying the interactive-menu CRIT's own vocabulary, so check 6 has
// every reason to fire and only the ACP fact stops it.
const MENU_LOOKING_PANE = "Do you want to proceed? ❯ 1. Yes";

function tmuxWithPane(paneText) {
  return [
    '#!/usr/bin/env bash',
    'args="$*"',
    'case "$args" in',
    '  *has-session*) exit 0 ;;',
    '  *list-panes*) echo 222; exit 0 ;;',
    `  *capture-pane*) printf '%s\\n' ${JSON.stringify(paneText)}; exit 0 ;;`,
    '  *list-sessions*) echo "swarmforge-coder"; exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n';
}

function sweepStaleLive() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(SWEEP_PREFIX)) fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
  }
}

const liveMkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), SWEEP_PREFIX));

// Runs the REAL sweep with the seat's ACP snapshot on disk. Three times, so
// the pane-hash history reaches the three-identical-sweeps the frozen check
// needs - otherwise a suppressed WARN is indistinguishable from one that was
// never going to fire.
function liveSweepWithSnapshot(snapshot, paneText) {
  sweepStaleLive();
  const fixture = breakProbes(makeSweepFixture(liveMkdir, { launchScripts: false }), []);
  writeStub(fixture, 'tmux', tmuxWithPane(paneText));
  const acpDir = path.join(fixture.root, '.swarmforge', 'acp');
  fs.mkdirSync(acpDir, { recursive: true });
  fs.writeFileSync(path.join(acpDir, `${LIVE_ROLE}.json`), JSON.stringify(snapshot));
  let last = null;
  for (let i = 0; i < 3; i += 1) last = runSweep(fixture);
  return { fixture, ...last };
}

// The same three sweeps with NO snapshot, proving the pane path still fires
// for an ordinary seat. Without this, a suppressed finding could just as well
// be a finding that never fires for anyone.
function liveSweepPaneDriven(paneText) {
  sweepStaleLive();
  const fixture = breakProbes(makeSweepFixture(liveMkdir, { launchScripts: false }), []);
  writeStub(fixture, 'tmux', tmuxWithPane(paneText));
  let last = null;
  for (let i = 0; i < 3; i += 1) last = runSweep(fixture);
  return { fixture, ...last };
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── acp-host-in-a-pane-drives-one-seat-01 ─────────────────────────────
  define(/^an ACP-hosted seat whose agent has returned a stop reason$/, (ctx) => {
    ctx.host = hostATurn(A_FINISHED_TURN);
    assert.equal(
      ctx.host.snapshot.stopReason,
      'end_turn',
      'the fixture turn must actually have produced a stop reason, or this scenario proves nothing'
    );
  });

  define(/^the deterministic layer decides whether that seat is idle$/, (ctx) => {
    ctx.seat = readSeat(ctx.host.snapshot, ctx.host.pane.join('\n'));
  });

  define(/^the decision is taken from that stop reason$/, (ctx) => {
    assert.equal(ctx.seat.acpHosted, true, 'the bb reader did not recognise the seat as ACP-hosted');
    assert.equal(ctx.seat.stopReason, 'end_turn');
    assert.equal(ctx.seat.idle, true, 'a turn that ended with end_turn is idle');
    assert.equal(
      ctx.seat.idleFrom,
      `stop_reason:${ctx.host.snapshot.stopReason}`,
      'the verdict must name the stop reason it came from'
    );
    // And at the babysitter's own decision site, not only in the reader.
    assert.equal(ctx.seat.assess['idle-from'], `stop_reason:${ctx.host.snapshot.stopReason}`);
    assert.equal(ctx.seat.assess['acp-idle?'], true);
    assert.equal(ctx.seat.assess['stop-reason'], 'end_turn');

    // The LIVE half (architect bounce D1). gather-role is where a seat's
    // stuck/idle state is actually decided in the running swarm, and check 7
    // decides it by comparing pane hashes across three sweeps. Give it a pane
    // that is busy and never changes - the exact shape it fires on, and the
    // exact shape a frozen render produces while the agent works fine - and
    // the ACP seat must not be called frozen, because its stop reason says
    // the turn ended.
    const live = liveSweepWithSnapshot(ctx.host.snapshot, BUSY_FROZEN_PANE);
    assert.ok(
      !new RegExp(`WARN \\[frozen-${LIVE_ROLE}\\]`).test(live.output),
      `the live sweep called an ACP seat frozen from its pane hash:\n${live.output}`
    );
    // And the same pane, with no ACP snapshot, DOES fire - so the line above
    // is a suppression that happened, not a check that never fires.
    const paneDriven = liveSweepPaneDriven(BUSY_FROZEN_PANE);
    assert.match(
      paneDriven.output,
      new RegExp(`WARN \\[frozen-${LIVE_ROLE}\\]`),
      `the frozen-pane check never fires at all, so suppressing it proves nothing:\n${paneDriven.output}`
    );
  });

  define(/^no pane text is read to reach it$/, (ctx) => {
    // Behavioural half: the same traffic reaches the same verdict with the
    // pane thrown away entirely, and with a pane that would defeat every
    // heuristic the old path used - a truncated tail and a ghost suggestion.
    const blind = new AcpHostSession({ writeLine: () => {}, writeSnapshot: () => {} }, { role: 'coder' });
    blind.ingestAll(A_FINISHED_TURN);
    assert.deepEqual(blind.snapshot(), ctx.host.snapshot, 'the snapshot depended on what reached the pane');

    const hostile = readSeat(ctx.host.snapshot, '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)');
    assert.equal(hostile.idle, ctx.seat.idle, 'the idle verdict moved when only the pane text changed');
    assert.equal(hostile.idleFrom, ctx.seat.idleFrom, 'the verdict named a different fact for a different pane');
    assert.equal(hostile.assess['idle-from'], ctx.seat.assess['idle-from']);

    // Static half: the modules that reach the verdict have no way to reach
    // pane text in the first place.
    for (const file of [
      path.join(REPO_ROOT, 'extension', 'src', 'swarm', 'acpSeatState.ts'),
      path.join(REPO_ROOT, 'extension', 'src', 'swarm', 'acpSessionEvents.ts'),
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'acp_session_lib.bb'),
    ]) {
      const source = readSource(file).replace(/^\s*(;;|\/\/).*$/gm, '');
      for (const token of PANE_READING_TOKENS) {
        assert.ok(!source.includes(token), `${path.basename(file)} reaches rendered pane text via "${token}"`);
      }
    }
  });

  // ── acp-host-in-a-pane-drives-one-seat-02 ─────────────────────────────
  define(/^an ACP-hosted seat whose agent raises a permission request$/, (ctx) => {
    ctx.host = hostATurn(A_TURN_AWAITING_PERMISSION);
    assert.equal(ctx.host.snapshot.permissionPending, true, 'the fixture must actually be blocked on permission');
    assert.equal(ctx.host.snapshot.permissionTool, 'write_file');
  });

  define(/^the deterministic layer handles that moment$/, (ctx) => {
    ctx.seat = readSeat(ctx.host.snapshot, ctx.host.pane.join('\n'));
  });

  define(/^it is handled from the structured request$/, (ctx) => {
    assert.equal(ctx.seat.permissionPending, true, 'the layer did not see the structured request at all');
    assert.equal(ctx.seat.assess['permission-pending?'], true, 'the babysitter decision site did not see it');
    assert.equal(
      ctx.seat.idleFrom,
      'permission_requested:write_file',
      'the verdict must name the structured request, and the tool it is for'
    );
    assert.equal(ctx.seat.idle, false, 'a blocked seat is not idle - the two need different responses');
  });

  define(/^the interactive-menu block check does not fire for that seat$/, (ctx) => {
    assert.equal(ctx.seat.menuCheckApplies, false, 'the menu CRIT still claims this seat');
    assert.equal(ctx.seat.assess['menu-check-applies?'], false, 'and still claims it at the decision site');

    // The check itself, against the REAL production regex: the permission
    // moment reaches the pane as a rendered line, and that line matches none
    // of the menu shapes the babysitter blocks on.
    const menuPattern = readSource(BABYSITTER_CHECK).match(/^\(def menu-pattern #"(.+)"\)$/m);
    assert.ok(menuPattern, 'the babysitter menu-block pattern could not be located - this check would be vacuous');
    const rendered = ctx.host.pane.join('\n');
    assert.match(rendered, /\[permission\] write_file requested \(id 7\)/, 'the pane must show the permission moment');
    assert.ok(
      !new RegExp(menuPattern[1]).test(rendered),
      `the ACP seat's pane matched the interactive-menu CRIT pattern:\n${rendered}`
    );

    // The LIVE half (architect bounce D1). check 6 fires off menu-pattern
    // against captured pane text, in gather-role. Give the seat a pane that
    // DOES match - the agent may legitimately have printed those words - and
    // the CRIT must still not fire, because the permission moment is a fact
    // on disk instead. In its place the routable finding must appear, or the
    // structured request has been silenced rather than handled.
    const live = liveSweepWithSnapshot(ctx.host.snapshot, MENU_LOOKING_PANE);
    assert.ok(
      !new RegExp(`CRIT \\[menu-${LIVE_ROLE}\\]`).test(live.output),
      `the interactive-menu CRIT fired for an ACP seat in the live sweep:\n${live.output}`
    );
    assert.match(
      live.output,
      new RegExp(`CRIT \\[acp-permission-${LIVE_ROLE}\\]`),
      `the structured permission request reached no live finding - it was suppressed, not handled:\n${live.output}`
    );
    assert.match(live.output, /write_file/, `the finding must name the tool waiting on a decision:\n${live.output}`);

    // And the same pane with no ACP snapshot DOES raise the menu CRIT, so the
    // suppression above is real rather than a check that never fires.
    const paneDriven = liveSweepPaneDriven(MENU_LOOKING_PANE);
    assert.match(
      paneDriven.output,
      new RegExp(`CRIT \\[menu-${LIVE_ROLE}\\]`),
      `the interactive-menu check never fires at all, so suppressing it proves nothing:\n${paneDriven.output}`
    );
  });

  // ── acp-host-in-a-pane-drives-one-seat-03 ─────────────────────────────
  define(/^an ACP-hosted seat that has run a turn$/, (ctx) => {
    ctx.host = hostATurn(A_FINISHED_TURN);
  });

  define(/^its pane is captured$/, (ctx) => {
    ctx.paneText = ctx.host.pane.join('\n');
    ctx.seat = readSeat(ctx.host.snapshot, ctx.paneText);
  });

  define(/^the turn is readable there as a transcript$/, (ctx) => {
    assert.ok(ctx.paneText.length > 0, 'the pane is blank - invariant 2 fails whatever else passes');
    assert.match(ctx.paneText, /reading the parcel/, "the agent's own words must reach the pane");
    assert.match(ctx.paneText, /committed the stage work/);
    assert.match(ctx.paneText, /\[tool\] shell: started/, 'a human must see what the agent did, not only what it said');
    assert.match(ctx.paneText, /\[turn ended\] end_turn/);
    for (const line of ctx.host.pane) {
      assert.ok(
        !line.trimStart().startsWith('{'),
        `raw protocol traffic reached the pane, which is a wire dump and not a transcript: ${line}`
      );
    }
  });

  define(/^the babysitter still returns a pane verdict for that seat$/, (ctx) => {
    assert.ok(
      KNOWN_PANE_VERDICTS.includes(ctx.seat.paneVerdict),
      `the real pane classifier returned "${ctx.seat.paneVerdict}", which is not one of ${KNOWN_PANE_VERDICTS.join(', ')}`
    );
    // And the pane the babysitter classifies is still handed to it: an ACP
    // seat whose pane-tail were blanked at the decision site would pass every
    // structured check and cost the observability the swarm is watched through.
    assert.equal(ctx.seat.assess['pane-tail'], ctx.paneText, 'the decision site dropped the pane tail');
    assert.equal(ctx.seat.assess['loop-signal'], ctx.seat.paneVerdict);
  });

  // ── acp-host-in-a-pane-drives-one-seat-04 ─────────────────────────────
  define(/^an ACP-hosted seat that has finished its stage work$/, (ctx) => {
    ctx.writes = [];
    const session = new AcpHostSession(
      {
        writeLine: () => {},
        writeSnapshot: (snapshot) => ctx.writes.push(acpSnapshotRelPath(snapshot.role)),
      },
      { role: 'coder' }
    );
    session.ingestAll(A_FINISHED_TURN);
    ctx.host = { snapshot: session.snapshot() };
    assert.equal(ctx.host.snapshot.stopReason, 'end_turn', 'the stage work must actually have finished');
  });

  define(/^it hands the parcel on$/, (ctx) => {
    // The seat hands off the way every other agent does: by running the
    // shared helper from its own worktree. The host provides no delivery of
    // its own, and that absence is what the Thens below check.
    ctx.handoffHelper = HANDOFF_HELPER;
  });

  define(/^it goes through the shared handoff helper every other agent uses$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.handoffHelper), `the shared handoff helper is missing at ${ctx.handoffHelper}`);
    // Unchanged and unforked: this ticket added no ACP-aware branch to the
    // one helper every seat sends through.
    const helper = readSource(ctx.handoffHelper);
    for (const token of ['acp', 'ACP']) {
      assert.ok(!helper.includes(token), `the shared handoff helper grew an ACP-specific branch ("${token}")`);
    }
  });

  define(/^no ACP-specific delivery path reaches the mailbox$/, (ctx) => {
    assert.ok(ctx.writes.length > 0, 'the run wrote nothing at all, so this check would be vacuous');
    for (const written of ctx.writes) {
      assert.equal(written, acpSnapshotRelPath('coder'), `the host wrote somewhere other than its own snapshot: ${written}`);
      for (const token of MAILBOX_TOKENS) {
        assert.ok(!written.includes(token), `the host wrote into a mailbox path: ${written}`);
      }
    }
    for (const file of ['acpHostRuntime.ts', 'acpSeatState.ts', 'acpSessionEvents.ts']) {
      const source = readSource(path.join(REPO_ROOT, 'extension', 'src', 'swarm', file)).replace(/^\s*\/\/.*$/gm, '');
      for (const token of MAILBOX_TOKENS) {
        assert.ok(!source.includes(token), `${file} can reach a mailbox directly via "${token}"`);
      }
    }
  });

  // ── acp-host-in-a-pane-drives-one-seat-05 ─────────────────────────────
  define(/^the agent-runtime provider table$/, (ctx) => {
    ctx.providerSource = readSource(PROMPT_LIB);
  });

  define(/^the ACP dimension is read for each agent it knows$/, (ctx) => {
    ctx.table = bbEval(`
(require '[cheshire.core :as json])
(load-file "${PROMPT_LIB}")
(println (json/generate-string
          (into {} (for [[agent caps] prompt-engine-lib/provider-capabilities]
                     [agent {:wakeStyle (name (:wake-style caps))
                             :acp (prompt-engine-lib/acp-native? agent)
                             :keys (mapv name (keys caps))}]))))`);
  });

  define(/^every existing entry still resolves the wake style it resolved before$/, (ctx) => {
    // Every agent that EXISTED before the ACP dimension must still be here and
    // still resolve what it resolved. A later ticket adding a NEW agent is not
    // a fork and must not fail this - BL-1078 added `cursor` and did exactly
    // that, which is how this over-tight equality was found. What "not
    // forking" actually means is checked below: one capability table, and the
    // dimension living on the entry that already carried the wake style.
    const agents = Object.keys(WAKE_STYLE_BEFORE_ACP).sort();
    const missing = agents.filter((agent) => !ctx.table[agent]);
    assert.deepEqual(missing, [], `the table lost ${missing.join(', ')}; this ticket adds a dimension, not a row`);
    for (const agent of agents) {
      assert.equal(
        ctx.table[agent].wakeStyle,
        WAKE_STYLE_BEFORE_ACP[agent],
        `${agent} resolves wake style "${ctx.table[agent].wakeStyle}" but resolved "${WAKE_STYLE_BEFORE_ACP[agent]}" before the ACP dimension`
      );
    }
  });

  define(/^the ACP dimension is a field on that same table$/, (ctx) => {
    const acpAgents = Object.keys(ctx.table).filter((agent) => ctx.table[agent].acp);
    assert.ok(acpAgents.length > 0, 'no agent is ACP-native, so the dimension carries no information');
    for (const agent of acpAgents) {
      // The field sits on the entry that already carried the wake style -
      // one entry, both facts, which is what "a dimension, not a fork" means.
      assert.ok(ctx.table[agent].keys.includes('acp'), `${agent} is ACP-native but carries no :acp field on its entry`);
      assert.ok(ctx.table[agent].keys.includes('wake-style'), `${agent}'s entry lost its wake style`);
    }
    // Absence reads as "not ACP-native", never as unknown: a new agent is
    // pane-driven until someone says otherwise.
    for (const agent of Object.keys(ctx.table).filter((a) => !ctx.table[a].acp)) {
      assert.ok(!ctx.table[agent].keys.includes('acp'), `${agent} carries an :acp field yet reads as not ACP-native`);
    }
    // And there is exactly one table: no second map was forked off for the
    // ACP agents.
    const tables = ctx.providerSource.match(/^\(def [a-z-]*capabilities\b/gm) ?? [];
    assert.equal(tables.length, 1, `the provider table forked: found ${tables.length} capability tables`);
  });
}

module.exports = { registerSteps };
