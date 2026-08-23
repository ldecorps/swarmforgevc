'use strict';

// BL-1081 declared invariant 1 (property authorship rests with the coder,
// first pass - BL-654): "Seat control decisions for the spiked seat consume
// structured session signals (stop reason, tool status, permission request) -
// never pane-tail heuristics alone."
//
// The acceptance scenarios pin that on two fixed turns. This generalizes it
// over the open space: random ACP wire streams, each also drawn with random
// NON-protocol noise interleaved - including the exact shapes that defeat the
// old pane path in three different ways (a truncated tail, an idle-looking
// prompt footer, a ghost suggestion, a spinner frame). Those lines DO reach
// the pane, because the host renders everything the agent emits. What this
// asserts is that they never reach the decision: the verdict for a stream is
// identical to the verdict for the same stream with every noise line removed,
// and identical again when nothing reaches the pane at all.
//
// Both halves of the boundary are checked, because the "decision" this
// invariant names is taken on both sides: the TypeScript seat state produces
// the verdict, and the real Babashka deterministic layer
// (acp_session_lib.bb's idle-decision / apply-acp-facts, the same functions
// babysitter_assess.bb calls at its decision site) reaches it again from the
// snapshot on disk. All draws go to Babashka in ONE batched call - load-file
// dominates a bb invocation's cost, so a call per draw would be minutes of
// subprocess time for no extra coverage.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - decideIdle's pendingPermission branch removed, so a blocked seat
//     falls through to the stop-reason branch: RED, "a seat blocked on a
//     permission request read as idle".
//   break 2 - AcpHostSession.ingest treated a pane line beginning with the
//     idle prompt glyph as a turn ending (the old heuristic, leaking back into
//     the host): RED, "the verdict moved when only pane noise changed
//     (blocked)".
//   break 3 - apply-acp-facts made :idle-from fall back to the caller's
//     pane-derived :loop-signal when the snapshot named no fact: RED on the bb
//     cross-check, "draw 3: the decision site named a different fact than the
//     reader".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { foldAcpEvents, decideIdle, decidePermission, snapshotForSeat } = require('../out/swarm/acpSeatState');
const { parseAcpStream } = require('../out/swarm/acpSessionEvents');
const { AcpHostSession } = require('../out/swarm/acpHostRuntime');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ACP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'acp_session_lib.bb');

const DRAWS = 50;

// Small deterministic LCG seeded from the wall clock at collection time -
// varies run to run, matching this project's property-runner convention.
// The reach floors below are checked on every run regardless of seed.
const rng = (() => {
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
const randInt = (n) => Math.floor(rng() * n);
const randNth = (xs) => xs[randInt(xs.length)];
const randWord = () => {
  let w = '';
  for (let i = 0, n = 4 + randInt(8); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

// ── the wire ────────────────────────────────────────────────────────────
const TOOLS = ['shell', 'write_file', 'read_file', 'edit', 'fetch'];
const STOP_REASONS = ['end_turn', 'max_tokens', 'refusal', 'cancelled', 'error'];

const agentSays = (text) =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  });
const toolCall = (toolName, status) =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolName, status } },
  });
const permission = (title, id) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: { sessionId: 's1', toolCall: { title } },
  });
const stopped = (stopReason) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason, sessionId: 's1' } });

// The pane shapes that each defeat the old inference differently. These are
// exactly what a heuristic would key on, and exactly what must not matter.
const NOISE = [
  () => '❯ ',
  () => '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  () => `✻ ${randWord()}… (${1 + randInt(120)}s · esc to interrupt)`,
  () => '───────────────────── SwarmForge Coder ─',
  () => `Do you want to proceed? ${randWord()}`,
  () => `⏺ ${randWord()} ${randWord()}`,
  () => '',
];

// A draw is a stream in four shapes, so every control state the invariant
// quantifies over is reached: a turn that ended, a turn still running a tool,
// a turn blocked on permission, and a turn that has not ended at all. Drawing
// events independently would make the blocked-past-the-turn state - the one
// break 1 lives in - vanishingly rare, because almost every stream would end
// with a stop reason that clears it.
const SHAPES = ['ended', 'tool_running', 'blocked', 'not_started'];

function buildStream(shape) {
  const lines = [];
  for (let i = 0, n = 1 + randInt(3); i < n; i += 1) lines.push(agentSays(`${randWord()} ${randWord()}`));
  const tool = randNth(TOOLS);
  if (shape === 'ended') {
    lines.push(toolCall(tool, 'in_progress'), toolCall(tool, 'completed'), stopped(randNth(STOP_REASONS)));
  } else if (shape === 'tool_running') {
    lines.push(toolCall(tool, 'in_progress'));
  } else if (shape === 'blocked') {
    lines.push(toolCall(tool, 'in_progress'), permission(tool, 1 + randInt(99)));
  }
  return lines;
}

function interleaveNoise(lines) {
  const out = [];
  for (const line of lines) {
    while (randInt(3) === 0) out.push(randNth(NOISE)());
    out.push(line);
  }
  while (randInt(3) === 0) out.push(randNth(NOISE)());
  return out;
}

function hostSnapshot(lines, { renderPane }) {
  const pane = [];
  const session = new AcpHostSession(
    { writeLine: (line) => (renderPane ? pane.push(line) : undefined), writeSnapshot: () => {} },
    { role: 'coder' }
  );
  session.ingestAll(lines);
  return { snapshot: session.snapshot(), pane };
}

// Every fact family the verdict is allowed to name. A verdict naming anything
// else is, by construction, naming something that is not a structured signal.
const STRUCTURED_FACT = /^(stop_reason:(end_turn|max_tokens|refusal|cancelled|error)|permission_requested:.+|tool_running:.+|no_turn_ended)$/;

test('BL-1081/BL-654 invariant 1: seat control decisions come from structured signals, never from what reached the pane', () => {
  const draws = [];
  for (let i = 0; i < DRAWS; i += 1) {
    const shape = SHAPES[i % SHAPES.length];
    const clean = buildStream(shape);
    draws.push({ shape, clean, noisy: interleaveNoise(clean) });
  }

  const reached = { ended: 0, tool_running: 0, blocked: 0, not_started: 0 };
  const snapshots = [];

  for (const draw of draws) {
    const clean = hostSnapshot(draw.clean, { renderPane: true });
    const noisy = hostSnapshot(draw.noisy, { renderPane: true });
    const blind = hostSnapshot(draw.noisy, { renderPane: false });

    // 1. Noise that reaches the pane never reaches the decision.
    assert.deepEqual(
      noisy.snapshot,
      clean.snapshot,
      `the verdict moved when only pane noise changed (${draw.shape}):\n${draw.noisy.join('\n')}`
    );

    // 2. Nor does whether anything reached the pane at all - a truncated tail
    //    is the degenerate case of this, and it cannot touch the verdict.
    assert.deepEqual(blind.snapshot, noisy.snapshot, 'the verdict depended on the pane being rendered');

    // 3. The verdict is a pure function of the parsed facts, reachable
    //    without the host at all.
    const folded = foldAcpEvents(parseAcpStream(draw.noisy));
    assert.deepEqual(snapshotForSeat('coder', folded), noisy.snapshot);

    // 4. It always names a structured fact, never an excerpt of anything.
    const idle = decideIdle(folded);
    assert.match(idle.from, STRUCTURED_FACT, `the idle verdict named "${idle.from}", which is not a structured fact`);

    // 5. Blocked and idle stay distinct conditions.
    const perm = decidePermission(folded);
    if (perm.blocked) {
      assert.equal(idle.idle, false, 'a seat blocked on a permission request read as idle');
      assert.equal(idle.from, `permission_requested:${perm.tool}`);
    }

    // Which state this draw actually reached, from the verdict itself rather
    // than from the shape we asked for.
    if (perm.blocked) reached.blocked += 1;
    else if (idle.from.startsWith('tool_running:')) reached.tool_running += 1;
    else if (idle.from === 'no_turn_ended') reached.not_started += 1;
    else reached.ended += 1;

    snapshots.push(noisy.snapshot);
  }

  // Generator reach: an asserted floor, not a hoped-for one. Without this a
  // sweep whose draws all ended cleanly would pass while never once exercising
  // the blocked or mid-tool states the invariant quantifies over.
  for (const state of Object.keys(reached)) {
    assert.ok(reached[state] >= 5, `generator coverage: "${state}" reached only ${reached[state]} of ${DRAWS} (floor 5)`);
  }

  // ── the same decision, taken again by the real deterministic layer ─────
  const program = `
(require '[cheshire.core :as json] '[babashka.fs :as fs])
(load-file "${ACP_LIB}")
(let [snaps (json/parse-string (slurp *in*) true)
      dir (fs/create-temp-dir {:prefix "bl1081-prop-"})
      root (str dir)]
  (try
    (fs/create-dirs (fs/path root ".swarmforge" "acp"))
    (println (json/generate-string
      (vec (for [snap snaps]
             (do (spit (str (acp-session-lib/snapshot-path root "coder")) (json/generate-string snap))
                 (let [s (acp-session-lib/read-snapshot root "coder")
                       idle (acp-session-lib/idle-decision s)
                       assess (acp-session-lib/apply-acp-facts
                               {:role "coder" :pane-tail "❯ \\n  ⏵⏵ bypass permissions on"
                                :loop-signal :quiet}
                               s (acp-session-lib/stop-reason s))]
                   {:idle (:idle? idle) :from (:from idle)
                    :pending (acp-session-lib/permission-pending? s)
                    :menuApplies (acp-session-lib/menu-check-applies? s)
                    :assessFrom (:idle-from assess)}))))))
    (finally (fs/delete-tree dir))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', input: JSON.stringify(snapshots) });
  assert.equal(res.status, 0, `the Babashka deterministic layer failed:\n${res.stderr}`);
  const verdicts = JSON.parse(res.stdout);
  assert.equal(verdicts.length, snapshots.length, 'the runner must return one verdict per draw');

  snapshots.forEach((snapshot, i) => {
    const bb = verdicts[i];
    assert.equal(bb.idle, snapshot.idle, `draw ${i}: the two sides disagreed on idle`);
    assert.equal(bb.from, snapshot.idleFrom, `draw ${i}: the two sides named different facts`);
    assert.equal(bb.pending, snapshot.permissionPending, `draw ${i}: the two sides disagreed on the permission moment`);
    // The babysitter's decision site reaches the same fact, with a pane tail
    // supplied that would have defeated the old path.
    assert.equal(bb.assessFrom, snapshot.idleFrom, `draw ${i}: the decision site named a different fact than the reader`);
    // And the interactive-menu CRIT never claims an ACP seat, whatever its
    // pane happens to contain.
    assert.equal(bb.menuApplies, false, `draw ${i}: the menu CRIT still claims this ACP seat`);
  });
});
