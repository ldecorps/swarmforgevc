const assert = require('node:assert/strict');
const { parseAcpLine, parseAcpStream } = require('../out/swarm/acpSessionEvents');

// BL-1081: the wire -> facts half. Every case here is a string, because that
// is the whole point: the control channel is structured traffic, not a pane.

test('a session/prompt result carries the stop reason as a fact', () => {
  const e = parseAcpLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } }));
  assert.deepEqual(e, { kind: 'turn_ended', stopReason: 'end_turn', sessionId: undefined });
});

test('every stop reason the protocol defines is recognised', () => {
  for (const stop of ['end_turn', 'max_tokens', 'refusal', 'cancelled', 'error']) {
    const e = parseAcpLine(JSON.stringify({ id: 1, result: { stopReason: stop } }));
    assert.equal(e.kind, 'turn_ended', `${stop} must parse`);
    assert.equal(e.stopReason, stop);
  }
});

test('an unknown stop reason is not invented as a turn ending', () => {
  // Reading an unrecognised value as "the turn ended" would be exactly the
  // guessing this ticket removes.
  assert.equal(parseAcpLine(JSON.stringify({ id: 1, result: { stopReason: 'vibes' } })), null);
});

test('a permission request parses with its id and tool', () => {
  const e = parseAcpLine(
    JSON.stringify({ id: 7, method: 'session/request_permission', params: { sessionId: 's1', toolName: 'write_file' } })
  );
  assert.deepEqual(e, { kind: 'permission_requested', requestId: 7, tool: 'write_file', sessionId: 's1' });
});

test('a permission request with no id is not actionable and is dropped', () => {
  // Without an id there is nothing to answer, so treating it as a block would
  // strand the seat on a request it could never resolve.
  assert.equal(
    parseAcpLine(JSON.stringify({ method: 'session/request_permission', params: { toolName: 'write_file' } })),
    null
  );
});

test('an agent message chunk becomes transcript', () => {
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } },
    })
  );
  assert.deepEqual(e, { kind: 'transcript', role: 'agent', text: 'hello', sessionId: 's1' });
});

test('a content LIST is joined rather than dropped', () => {
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } },
    })
  );
  assert.equal(e.text, 'ab');
});

test('a user chunk and a tool output are attributed to their own speakers', () => {
  const u = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'user_message_chunk', content: 'hi' } } })
  );
  assert.equal(u.role, 'user');
  const t = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_output', content: 'out' } } })
  );
  assert.equal(t.role, 'tool');
});

test('tool status maps the protocol vocabulary onto started/completed/failed', () => {
  const cases = [
    ['in_progress', 'started'],
    ['pending', 'started'],
    ['completed', 'completed'],
    ['success', 'completed'],
    ['failed', 'failed'],
    ['error', 'failed'],
  ];
  for (const [wire, expected] of cases) {
    const e = parseAcpLine(
      JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolName: 'bash', status: wire } } })
    );
    assert.equal(e.kind, 'tool_status', `${wire} must parse`);
    assert.equal(e.status, expected, `${wire} -> ${expected}`);
  }
});

test('an unmodelled message is ignored rather than fatal', () => {
  // A host that threw on an unrecognised message would take the seat down the
  // first time the CLI added a field - and a control channel that dies on
  // novelty is worse than the pane it replaces.
  assert.equal(parseAcpLine(JSON.stringify({ method: 'session/cancel', params: {} })), null);
  assert.equal(parseAcpLine('not json at all'), null);
  assert.equal(parseAcpLine(''), null);
  assert.equal(parseAcpLine('   '), null);
  assert.equal(parseAcpLine('null'), null);
  assert.equal(parseAcpLine('[1,2,3]'), null);
});

test('a stream yields its facts in order, skipping the noise between them', () => {
  const events = parseAcpStream([
    'starting up...',
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: 'working' } } }),
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolName: 'bash', status: 'in_progress' } } }),
    JSON.stringify({ id: 3, method: 'session/request_permission', params: { toolName: 'bash' } }),
    JSON.stringify({ id: 1, result: { stopReason: 'end_turn' } }),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['transcript', 'tool_status', 'permission_requested', 'turn_ended']
  );
});
