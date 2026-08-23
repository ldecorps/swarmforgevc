'use strict';

// BL-1081 declared invariant 2 (property authorship rests with the coder,
// first pass - BL-654): "The pane still renders a human-readable transcript;
// observability and babysitter pane checks survive."
//
// This is the invariant a structured control channel is most likely to cost,
// and the one nothing else would notice being broken: a host that stopped
// rendering, or that dumped raw JSON-RPC into the pane instead of a
// transcript, would pass every idle and permission assertion in this ticket
// while leaving a human staring at a blank or unreadable pane and the
// babysitter's pane checks with nothing to read. The acceptance scenario pins
// it on one fixed turn; this generalizes it over random turns.
//
// What is asserted for every draw:
//   - everything the agent said reaches the pane, verbatim, in order;
//   - no pane line is protocol traffic, so what a human sees is a transcript
//     and not a wire dump;
//   - the real babysitter pane classifier (loop_detect_lib.bb, the same
//     function babysitter_assess.bb calls on a captured pane) still returns
//     one of its four declared verdicts for that pane, and the real
//     interactive-menu CRIT pattern (babysitter_check.bb's own menu-pattern)
//     never fires on what the host itself rendered.
//
// That last clause is the sharp one, and it has two halves that must not be
// confused. The host has to render a permission moment for a human to see it,
// and ACP lets a CLI supply prose as the tool title - so rendering that title
// raw re-creates by hand the very menu shape whose CRIT this ticket exists to
// avoid, on a seat that is structurally unblocked. That is the HOST'S CHROME,
// and it is the host's to keep clean; permission draws deliberately carry
// titles drawn from menu-pattern's own vocabulary ("Do you want", "to select",
// "(y/n)"), which is exactly the shape that would smuggle a false CRIT through.
// This property found that defect on its first run.
//
// The agent's OWN words are the other half, and they are deliberately NOT
// scrubbed: an agent may legitimately say "Do you want me to continue?", and a
// transcript that mangled it would cost the readable pane this invariant is
// about. What protects that case is the layer, not the rendering -
// menu-check-applies? is false for an ACP seat, so the CRIT never runs on it
// at all. Both halves are asserted below, because either alone is a false
// comfort.
//
// Both bb checks go in ONE batched call per run: load-file dominates a bb
// invocation, and a call per draw buys no extra coverage.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit): break 1 - renderEventForPane returned null for 'transcript'
// events (structured facts still rendered, the agent's words not): RED on the
// first draw ("the agent said ... but the pane never showed it"). break 2 -
// AcpHostSession.ingest wrote the raw line instead of the rendered one: RED
// on the first draw ("raw protocol traffic reached the pane"). break 3 - the
// permission line rendered the agent's own prompt text verbatim
// (`${event.tool}`, where the tool name is menu-shaped): RED on the first
// permission draw ("the host's own rendering tripped the interactive-menu
// CRIT"). All three restored, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { AcpHostSession, renderEventForPane } = require('../out/swarm/acpHostRuntime');
const { parseAcpStream } = require('../out/swarm/acpSessionEvents');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LOOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'loop_detect_lib.bb');
const BABYSITTER_CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb');

const DRAWS = 48;

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
  for (let i = 0, n = 4 + randInt(9); i < n; i += 1) w += String.fromCharCode(97 + randInt(26));
  return w;
};

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

// The four verdicts loop_detect_lib's own docstring declares. BL-421: an
// explicit lookup, never a passthrough - a classifier returning something
// unrecognised must fail this, not slip through.
const KNOWN_PANE_VERDICTS = ['no-task-spin', 'progress', 'busy', 'quiet'];

// Tool names drawn from the interactive-menu CRIT's OWN vocabulary. A host
// that echoed the agent's prompt text into the pane would render one of these
// and trip the check on a seat that is not menu-blocked at all.
const MENU_SHAPED_TOOLS = ['Do you want to write this file', 'to select a branch', 'confirm (y/n)', 'Do you trust this'];
const PLAIN_TOOLS = ['shell', 'write_file', 'read_file', 'fetch'];
const STOP_REASONS = ['end_turn', 'max_tokens', 'refusal', 'cancelled', 'error'];

// Four shapes, so the states the invariant quantifies over are all reached:
// a plain turn, a turn with tool activity, a turn whose permission moment is
// menu-shaped, and a turn carrying non-protocol chatter (a CLI banner on
// stderr) that the host must still show rather than swallow.
const SHAPES = ['plain', 'tooling', 'menu_shaped_permission', 'with_chatter'];

function buildDraw(shape) {
  const lines = [];
  const said = [];
  const chatter = [];
  const say = (text) => {
    said.push(text);
    lines.push(agentSays(text));
  };

  // Some draws put the CRIT's own vocabulary in the agent's MOUTH, not only
  // in a tool title: that is the case a scrubbing host would break, and
  // clause 7 is what would catch it.
  const menuSpeech = randInt(3) === 0;
  say(menuSpeech ? `${randNth(MENU_SHAPED_TOOLS)}, ${randWord()}?` : `${randWord()} ${randWord()} ${randWord()}`);
  if (shape === 'with_chatter') {
    const banner = `${randWord()} v${randInt(9)}.${randInt(9)}.${randInt(9)} starting`;
    chatter.push(banner);
    lines.push(banner);
  }
  if (shape === 'tooling') {
    const tool = randNth(PLAIN_TOOLS);
    lines.push(toolCall(tool, 'in_progress'), toolCall(tool, 'completed'));
  }
  if (shape === 'menu_shaped_permission') {
    lines.push(permission(randNth(MENU_SHAPED_TOOLS), 1 + randInt(99)));
  }
  for (let i = 0, n = 1 + randInt(3); i < n; i += 1) say(`${randWord()} ${randWord()}`);
  if (shape !== 'menu_shaped_permission') lines.push(stopped(randNth(STOP_REASONS)));
  return { shape, lines, said, chatter };
}

test('BL-1081/BL-654 invariant 2: the pane keeps a human-readable transcript and the babysitter pane checks survive', () => {
  const menuPatternMatch = fs.readFileSync(BABYSITTER_CHECK, 'utf8').match(/^\(def menu-pattern #"(.+)"\)$/m);
  assert.ok(menuPatternMatch, 'the babysitter menu-block pattern could not be located - this whole test would be vacuous');
  const menuPattern = new RegExp(menuPatternMatch[1]);
  // The vocabulary the draws use must actually be what the CRIT keys on, or
  // the sharpest clause below would be checking nothing.
  for (const tool of MENU_SHAPED_TOOLS) {
    assert.match(tool, menuPattern, `"${tool}" was meant to be menu-shaped but the real CRIT pattern ignores it`);
  }

  const draws = [];
  for (let i = 0; i < DRAWS; i += 1) draws.push(buildDraw(SHAPES[i % SHAPES.length]));

  const reached = { transcript: 0, tool: 0, permission: 0, chatter: 0, turnEnded: 0 };
  const panes = [];

  for (const draw of draws) {
    const rendered = [];
    const session = new AcpHostSession(
      { writeLine: (line) => rendered.push(line), writeSnapshot: () => {} },
      { role: 'coder' }
    );
    session.ingestAll(draw.lines);
    const pane = rendered.join('\n');
    panes.push(pane);

    // 1. The pane is not blank. A machine-only pane passes every structured
    //    check in this ticket and fails this invariant outright.
    assert.ok(rendered.length > 0, `the pane is blank for a ${draw.shape} turn`);

    // 2. Everything the agent said reaches the pane, verbatim and in order.
    let cursor = -1;
    for (const text of draw.said) {
      const at = rendered.findIndex((line, i) => i > cursor && line.includes(text));
      assert.ok(at > cursor, `the agent said "${text}" but the pane never showed it, in order:\n${pane}`);
      cursor = at;
    }

    // 3. Non-protocol chatter is shown too, not swallowed - a human must not
    //    be left staring at a blank pane while the CLI prints its banner.
    for (const line of draw.chatter) {
      assert.ok(rendered.includes(line), `the host swallowed non-protocol output: "${line}"`);
    }

    // 4. No line is protocol traffic: what a human sees is a transcript, not
    //    a wire dump.
    for (const line of rendered) {
      assert.ok(
        !line.trimStart().startsWith('{'),
        `raw protocol traffic reached the pane, which is a wire dump and not a transcript: ${line}`
      );
      assert.ok(!line.includes('"jsonrpc"'), `a pane line carried protocol framing: ${line}`);
    }

    // 5. Every structured fact is rendered in human words, so observability
    //    of what the agent DID survives alongside what it said.
    const events = parseAcpStream(draw.lines);
    for (const event of events) {
      const line = renderEventForPane(event);
      assert.ok(line !== null && line.length > 0, `a ${event.kind} event rendered nothing for the pane`);
      assert.ok(rendered.includes(line), `a ${event.kind} event never reached the pane: ${line}`);
      if (event.kind === 'tool_status') reached.tool += 1;
      if (event.kind === 'permission_requested') reached.permission += 1;
      if (event.kind === 'transcript') reached.transcript += 1;
      if (event.kind === 'turn_ended') reached.turnEnded += 1;
    }
    reached.chatter += draw.chatter.length;

    // 6. The host's own CHROME never trips the interactive-menu CRIT - even
    //    when the agent's permission request carries a menu-shaped title.
    //    Pass-through lines (the agent's words, the CLI's chatter) are
    //    excluded on purpose: those reach the pane verbatim by design, and
    //    clause 7 below is what covers them.
    const chrome = events
      .filter((event) => event.kind !== 'transcript')
      .map((event) => renderEventForPane(event));
    for (const line of chrome) {
      assert.ok(
        !menuPattern.test(line),
        `the host's own rendering tripped the interactive-menu CRIT for a ${draw.shape} turn: ${line}`
      );
    }

    // 7. And the agent's own words are passed through untouched, menu-shaped
    //    or not - scrubbing the transcript would cost exactly the readable
    //    pane this invariant is about.
    for (const text of draw.said) {
      assert.ok(rendered.includes(text), `the transcript was rewritten: "${text}" is not in the pane verbatim`);
    }
  }

  // Generator reach: an asserted floor, not a hoped-for one.
  const floors = { transcript: 40, tool: 10, permission: 10, chatter: 10, turnEnded: 20 };
  for (const key of Object.keys(floors)) {
    assert.ok(reached[key] >= floors[key], `generator coverage: "${key}" reached only ${reached[key]} (floor ${floors[key]})`);
  }

  // ── the babysitter's own pane check, on the panes the host rendered ────
  // Observability surviving means the REAL classifier still reaches a verdict
  // on what the host wrote - a pane it could not classify would be a pane a
  // human cannot read either.
  const program = `
(require '[cheshire.core :as json])
(load-file "${LOOP_LIB}")
(println (json/generate-string
          (mapv #(name (loop-detect-lib/classify-pane-loop-signal %))
                (json/parse-string (slurp *in*)))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', input: JSON.stringify(panes) });
  assert.equal(res.status, 0, `the real babysitter pane classifier failed:\n${res.stderr}`);
  const verdicts = JSON.parse(res.stdout);
  assert.equal(verdicts.length, panes.length, 'the classifier must return one verdict per pane');
  verdicts.forEach((verdict, i) => {
    assert.ok(
      KNOWN_PANE_VERDICTS.includes(verdict),
      `draw ${i} (${draws[i].shape}): the babysitter returned "${verdict}", which is not one of ${KNOWN_PANE_VERDICTS.join(', ')}`
    );
  });

  // ── the other half of clause 6: the layer, not the rendering ──────────
  // The transcript is passed through verbatim, so a pane CAN carry the CRIT's
  // vocabulary when the agent simply said it. What keeps that from firing is
  // that the check does not apply to an ACP seat at all. Asserting the
  // rendering alone would be a false comfort, so the deterministic layer's own
  // answer is checked here on the very panes that carry that speech.
  const spoken = panes.filter((pane) => menuPattern.test(pane));
  assert.ok(
    spoken.length > 0,
    'no draw put the CRIT vocabulary in the agent\'s mouth, so this half checked nothing'
  );
  const layer = spawnSync(
    'bb',
    [
      '-e',
      `
(require '[cheshire.core :as json] '[babashka.fs :as fs])
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'acp_session_lib.bb')}")
(let [dir (fs/create-temp-dir {:prefix "bl1081-inv2-"}) root (str dir)]
  (try
    (fs/create-dirs (fs/path root ".swarmforge" "acp"))
    (spit (str (acp-session-lib/snapshot-path root "coder"))
          (json/generate-string {:role "coder" :acp true :stopReason "end_turn" :idle true
                                 :idleFrom "stop_reason:end_turn" :permissionPending false
                                 :permissionTool nil :turnsEnded 1}))
    (println (json/generate-string
              {:acpSeat (acp-session-lib/menu-check-applies? (acp-session-lib/read-snapshot root "coder"))
               :ordinarySeat (acp-session-lib/menu-check-applies? (acp-session-lib/read-snapshot root "cleaner"))}))
    (finally (fs/delete-tree dir))))`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(layer.status, 0, `the deterministic layer failed:\n${layer.stderr}`);
  const applies = JSON.parse(layer.stdout);
  assert.equal(applies.acpSeat, false, 'the interactive-menu CRIT still claims an ACP seat');
  assert.equal(applies.ordinarySeat, true, 'the CRIT stopped applying to ordinary seats - this ticket widens no other path');
});
