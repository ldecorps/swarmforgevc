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

test('a null result does not crash the parser - it is absent, not malformed', () => {
  // A JSON-RPC response can legitimately carry a null result. The host must
  // survive it exactly like any other message with nothing to say.
  assert.equal(parseAcpLine(JSON.stringify({ id: 1, result: null })), null);
});

test('a permission request parses with its id and tool', () => {
  const e = parseAcpLine(
    JSON.stringify({ id: 7, method: 'session/request_permission', params: { sessionId: 's1', toolName: 'write_file' } })
  );
  assert.deepEqual(e, { kind: 'permission_requested', requestId: 7, tool: 'write_file', sessionId: 's1' });
});

test('a permission request id may be a string, not only a number', () => {
  // The protocol allows either; a parser that only recognised a number would
  // silently drop every request from a CLI that mints string ids.
  const e = parseAcpLine(
    JSON.stringify({ id: 's1', method: 'session/request_permission', params: { toolName: 'write_file' } })
  );
  assert.deepEqual(e, { kind: 'permission_requested', requestId: 's1', tool: 'write_file', sessionId: undefined });
});

test('a permission request with no id is not actionable and is dropped', () => {
  // Without an id there is nothing to answer, so treating it as a block would
  // strand the seat on a request it could never resolve.
  assert.equal(
    parseAcpLine(JSON.stringify({ method: 'session/request_permission', params: { toolName: 'write_file' } })),
    null
  );
});

test('a permission request naming no tool at all, and no toolCall to recurse into, is dropped', () => {
  assert.equal(
    parseAcpLine(JSON.stringify({ id: 7, method: 'session/request_permission', params: {} })),
    null
  );
});

test('a session id carried in the RESULT (not params) is still read', () => {
  const e = parseAcpLine(JSON.stringify({ id: 1, result: { stopReason: 'end_turn', sessionId: 's-from-result' } }));
  assert.equal(e.sessionId, 's-from-result');
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

test('a content LIST mixing raw strings and text blocks joins both', () => {
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: ['a', { type: 'text', text: 'b' }] } },
    })
  );
  assert.equal(e.text, 'ab');
});

test('an update with neither content nor text is not a transcript event', () => {
  const e = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk' } } })
  );
  assert.equal(e, null);
});

test('text arriving under the "text" key (no "content") is read as a fallback', () => {
  const e = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', text: 'hello' } } })
  );
  assert.equal(e.text, 'hello');
});

test('a content list whose blocks carry no text is dropped, not emitted empty', () => {
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: [{ type: 'image' }] } },
    })
  );
  assert.equal(e, null);
});

test('a content block with no text field is not a transcript event', () => {
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } } },
    })
  );
  assert.equal(e, null);
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

test('an unrecognised or missing tool status is not modelled as a fact', () => {
  const unrecognised = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolName: 'bash', status: 'vibes' } } })
  );
  assert.equal(unrecognised, null);
  const nonString = parseAcpLine(
    JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolName: 'bash', status: 5 } } })
  );
  assert.equal(nonString, null);
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

test('tool_call_update is recognised as tool status on its own, not only alongside tool_call', () => {
  // The two sessionUpdate types are checked by an OR; a test that only ever
  // exercises tool_call cannot tell that branch apart from one that dropped
  // tool_call_update entirely.
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolName: 'bash', status: 'completed' } },
    })
  );
  assert.deepEqual(e, { kind: 'tool_status', tool: 'bash', status: 'completed', sessionId: undefined });
});

test('a present-but-non-string sessionUpdate is rejected, not treated as a default transcript', () => {
  // Absent sessionUpdate (undefined) may still reach transcript parsing with
  // type=null; a PRESENT number/object must not collapse into that path.
  assert.equal(
    parseAcpLine(
      JSON.stringify({
        method: 'session/update',
        params: { update: { sessionUpdate: 7, content: 'should not render' } },
      })
    ),
    null
  );
  assert.equal(
    parseAcpLine(
      JSON.stringify({
        method: 'session/update',
        params: { update: { sessionUpdate: { nested: true }, content: 'nope' } },
      })
    ),
    null
  );
});

test('an update with no sessionUpdate key still yields a transcript when content is present', () => {
  // The != null guard must stay: widening it to `true && type === null` would
  // reject this absent-type case and drop the pane text.
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/update',
      params: { update: { content: 'orphan chunk' } },
    })
  );
  assert.deepEqual(e, {
    kind: 'transcript',
    role: 'agent',
    text: 'orphan chunk',
    sessionId: undefined,
  });
});

test('an unrecognised method is dropped even when its params happen to carry an update-shaped payload', () => {
  // The method gate must be checked before the payload is trusted - a parser
  // that fell through to the update handler for ANY method would parse
  // traffic from a message this host does not model at all.
  const e = parseAcpLine(
    JSON.stringify({
      method: 'session/cancel',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: 'hi' } },
    })
  );
  assert.equal(e, null);
});

test('a tool name is read from each of its fallback keys, in order', () => {
  // toolName is the primary key; title/kind/name are the fallbacks the wire
  // format's own variants use.
  for (const key of ['title', 'kind', 'name']) {
    const e = parseAcpLine(
      JSON.stringify({ id: 7, method: 'session/request_permission', params: { [key]: 'write_file' } })
    );
    assert.deepEqual(
      e,
      { kind: 'permission_requested', requestId: 7, tool: 'write_file', sessionId: undefined },
      `key "${key}" must be read as the tool name`
    );
  }
});

test('a tool name nested under toolCall is found by recursing into it', () => {
  const e = parseAcpLine(
    JSON.stringify({ id: 7, method: 'session/request_permission', params: { toolCall: { toolName: 'write_file' } } })
  );
  assert.deepEqual(e, { kind: 'permission_requested', requestId: 7, tool: 'write_file', sessionId: undefined });
});

test('a blank tool name is skipped in favour of the next fallback key', () => {
  const e = parseAcpLine(
    JSON.stringify({ id: 7, method: 'session/request_permission', params: { toolName: '   ', title: 'write_file' } })
  );
  assert.deepEqual(e, { kind: 'permission_requested', requestId: 7, tool: 'write_file', sessionId: undefined });
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
