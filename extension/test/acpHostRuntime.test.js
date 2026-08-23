const assert = require('node:assert/strict');
const { AcpHostSession, renderEventForPane, paneToolLabel, acpSnapshotRelPath } = require('../out/swarm/acpHostRuntime');

// BL-1081: the host. Its two jobs are to keep the pane readable and to keep
// the snapshot current, and both are asserted here without a process, a pane
// or a filesystem - the side effects are injected.

function harness(role = 'coder') {
  const lines = [];
  const snapshots = [];
  const session = new AcpHostSession(
    { writeLine: (l) => lines.push(l), writeSnapshot: (s) => snapshots.push(s) },
    { role }
  );
  return { session, lines, snapshots, last: () => snapshots[snapshots.length - 1] };
}

const chunk = (text) =>
  JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: text } } });
const ended = (stop) => JSON.stringify({ id: 1, result: { stopReason: stop } });
const perm = (tool, id = 5) => JSON.stringify({ id, method: 'session/request_permission', params: { toolName: tool } });

test('the pane gets a human-readable transcript of the turn', () => {
  const h = harness();
  h.session.ingestAll([chunk('thinking about it'), chunk(' and done'), ended('end_turn')]);
  assert.deepEqual(h.lines, ['thinking about it', ' and done', '[turn ended] end_turn']);
});

test('non-protocol output still reaches the pane rather than being swallowed', () => {
  // A CLI's startup banner is not ACP traffic, and a host that dropped it
  // would leave a human watching a blank pane while the agent booted.
  const h = harness();
  h.session.ingest('Mistral Vibe v1.2 starting...');
  assert.deepEqual(h.lines, ['Mistral Vibe v1.2 starting...']);
});

test('a blank line is not rendered as an empty pane line', () => {
  const h = harness();
  h.session.ingest('   ');
  assert.deepEqual(h.lines, []);
});

test('the snapshot is rewritten on EVERY fact, not only when a turn ends', () => {
  // Mid-turn is exactly when the deterministic layer most needs it: deciding
  // whether this seat is working or stuck.
  const h = harness();
  h.session.ingestAll([chunk('a'), perm('bash'), ended('end_turn')]);
  assert.equal(h.snapshots.length, 3);
  assert.equal(h.snapshots[1].permissionPending, true);
  assert.equal(h.last().permissionPending, false);
});

test('the snapshot tracks idleness from the stop reason', () => {
  const h = harness();
  h.session.ingest(chunk('working'));
  assert.equal(h.last().idle, false, 'mid-turn is not idle');
  h.session.ingest(ended('end_turn'));
  assert.equal(h.last().idle, true);
  assert.equal(h.last().idleFrom, 'stop_reason:end_turn');
});

test('a permission moment is visible in the pane AND in the snapshot', () => {
  // Both, deliberately: the pane keeps a human able to see it, the snapshot
  // keeps the deterministic layer from needing to read the pane to know.
  const h = harness();
  h.session.ingest(perm('write_file', 9));
  assert.deepEqual(h.lines, ['[permission] write_file requested (id 9)']);
  assert.equal(h.last().permissionPending, true);
  assert.equal(h.last().permissionTool, 'write_file');
});

test('non-protocol noise does not write a snapshot - only facts change state', () => {
  const h = harness();
  h.session.ingest('some banner');
  assert.deepEqual(h.snapshots, []);
});

test('the snapshot names its role, so one file per seat is unambiguous', () => {
  const h = harness('hardender');
  h.session.ingest(ended('end_turn'));
  assert.equal(h.last().role, 'hardender');
  assert.equal(h.last().acp, true);
});

test('every event kind renders something for the pane', () => {
  // A fact that rendered nothing would be invisible to a human watching the
  // pane, which is the observability invariant this ticket must not cost.
  const events = [
    { kind: 'transcript', role: 'agent', text: 'x' },
    { kind: 'tool_status', tool: 'bash', status: 'started' },
    { kind: 'permission_requested', requestId: 1, tool: 'bash' },
    { kind: 'turn_ended', stopReason: 'end_turn' },
  ];
  for (const e of events) {
    const rendered = renderEventForPane(e);
    assert.ok(rendered && rendered.length > 0, `${e.kind} must render`);
  }
});

test('the snapshot path is one file per seat under .swarmforge/acp/', () => {
  assert.equal(acpSnapshotRelPath('coder'), '.swarmforge/acp/coder.json');
  assert.notEqual(acpSnapshotRelPath('coder'), acpSnapshotRelPath('cleaner'));
});

// ── the host's own chrome, when the agent supplies prose for a tool name ──
// ACP lets a CLI send a tool `title` that is prose, and the host's status
// lines put it on a surface the babysitter pattern-matches. A title carrying
// the interactive-menu CRIT's own vocabulary must not come back out of the
// host looking like a menu, or a seat that is structurally unblocked reports
// itself blocked through its own rendering.
test('an agent-supplied tool title is rendered as a name, not as prose', () => {
  assert.equal(paneToolLabel('write_file'), 'write_file', 'an ordinary tool name is left alone');
  assert.equal(paneToolLabel('read/file-2.txt'), 'read/file-2.txt', 'path-ish and hyphenated names survive intact');
  assert.equal(paneToolLabel('  shell  '), 'shell', 'surrounding whitespace is not part of the name');
  assert.equal(paneToolLabel('Do you want to write this file'), 'Do_you_want_to_write_this_file');
  assert.equal(paneToolLabel('confirm (y/n)'), 'confirm_y/n');
  assert.equal(paneToolLabel('   '), 'unnamed_tool', 'a blank title still names something');
  assert.equal(paneToolLabel('!!!'), 'unnamed_tool', 'so does one made entirely of punctuation');
  const long = paneToolLabel('x'.repeat(200));
  assert.equal(long.length, 49, 'a runaway title is bounded before it reaches the pane');
  assert.ok(long.endsWith('…'), 'and is marked as truncated rather than silently cut');
});

test("the host's status lines never reproduce an interactive menu", () => {
  const h = harness();
  h.session.ingestAll([perm('Do you want to run this?', 9)]);
  const rendered = h.lines.join('\n');
  assert.match(rendered, /\[permission\] Do_you_want_to_run_this requested \(id 9\)/);
  assert.ok(!/Do you want|Do you trust|\(y\/n\)|Enter to confirm|to select/.test(rendered), rendered);
});

test("the agent's own words are passed through, never scrubbed", () => {
  // The counterpart to the two above: only the host's chrome is sanitized.
  // Scrubbing the transcript would cost the readable pane this ticket keeps.
  const h = harness();
  h.session.ingestAll([chunk('Do you want me to continue? I will wait.')]);
  assert.deepEqual(h.lines, ['Do you want me to continue? I will wait.']);
});
