const assert = require('node:assert/strict');
const {
  initialClientState,
  openingRequests,
  onAgentMessage,
  onPaneInput,
  choosePermissionOption,
  isReady,
} = require('../out/swarm/acpHostClient');

// BL-1081 (QA D1): the half that was missing. The host could render and record
// facts, but nothing ever DROVE an agent - so no real seat ever produced a
// snapshot and invariant 1 held for nobody. This is the ACP client state
// machine that actually conducts a session: initialize, open a session, feed
// prompts in, answer permission requests.
//
// Pure by construction: it takes the agent's lines and returns the lines to
// send back, so the whole conversation is asserted here without a process, a
// pipe or a pane.

const CFG = { cwd: '/repo/.worktrees/coder', bootstrapPrompt: 'BOOT: begin your role loop' };

const decode = (line) => JSON.parse(line);
const initOk = (id) =>
  JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: 1, agentInfo: { name: 'copilot' } } });
const sessionOk = (id, sessionId = 'sess-1') =>
  JSON.stringify({ jsonrpc: '2.0', id, result: { sessionId } });

/** Drive the machine from cold to ready, returning every line it emitted. */
function bootToReady(cfg = CFG) {
  const sent = [];
  let { state, out } = openingRequests(initialClientState(), cfg);
  sent.push(...out);
  ({ state, out } = onAgentMessage(state, initOk(decode(sent[0]).id), cfg));
  sent.push(...out);
  const newSessionId = decode(out[0]).id;
  ({ state, out } = onAgentMessage(state, sessionOk(newSessionId), cfg));
  sent.push(...out);
  return { state, sent };
}

test('the host opens the conversation with an ACP initialize request', () => {
  const { out } = openingRequests(initialClientState(), CFG);
  assert.equal(out.length, 1);
  const msg = decode(out[0]);
  assert.equal(msg.jsonrpc, '2.0');
  assert.equal(msg.method, 'initialize');
  assert.equal(typeof msg.id, 'number');
  assert.equal(msg.params.protocolVersion, 1);
});

test('a successful initialize is answered by opening a session in the seat worktree', () => {
  let { state, out } = openingRequests(initialClientState(), CFG);
  const initId = decode(out[0]).id;
  ({ state, out } = onAgentMessage(state, initOk(initId), CFG));
  assert.equal(out.length, 1);
  const msg = decode(out[0]);
  assert.equal(msg.method, 'session/new');
  assert.equal(msg.params.cwd, CFG.cwd);
  // A session id it has not been given yet must never be invented.
  assert.equal(state.sessionId, null);
  assert.equal(isReady(state), false);
});

test('the session id is taken from the agent and the seat is then ready', () => {
  const { state } = bootToReady();
  assert.equal(state.sessionId, 'sess-1');
  assert.equal(isReady(state), true);
});

test('the bootstrap prompt is sent once the session exists, not before', () => {
  const { state, sent } = bootToReady();
  const prompts = sent.map(decode).filter((m) => m.method === 'session/prompt');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].params.sessionId, 'sess-1');
  assert.equal(prompts[0].params.prompt[0].text, CFG.bootstrapPrompt);
  assert.equal(state.pendingPrompts.length, 0);
});

test('a line typed into the pane becomes a prompt for the live session', () => {
  const { state } = bootToReady();
  const { out } = onPaneInput(state, 'ready_for_next please');
  assert.equal(out.length, 1);
  const msg = decode(out[0]);
  assert.equal(msg.method, 'session/prompt');
  assert.equal(msg.params.sessionId, 'sess-1');
  assert.equal(msg.params.prompt[0].text, 'ready_for_next please');
});

test('a wake that arrives before the session is open is queued, never dropped', () => {
  // The swarm wakes a :chat-message seat by typing into its pane. If that
  // landed during the handshake and was discarded, the parcel would sit in the
  // mailbox with the seat looking perfectly healthy - the exact silent stall
  // this ticket exists to remove.
  let { state, out } = openingRequests(initialClientState(), CFG);
  const initId = decode(out[0]).id;
  ({ state, out } = onPaneInput(state, 'wake up'));
  assert.deepEqual(out, [], 'nothing can be sent before a session exists');
  assert.deepEqual(state.pendingPrompts, ['wake up']);

  ({ state, out } = onAgentMessage(state, initOk(initId), CFG));
  const newId = decode(out[0]).id;
  ({ state, out } = onAgentMessage(state, sessionOk(newId), CFG));
  const texts = out.map(decode).filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt[0].text);
  assert.deepEqual(texts, [CFG.bootstrapPrompt, 'wake up']);
  assert.deepEqual(state.pendingPrompts, []);
});

test('a permission request is answered with an allow option, so no menu can block the seat', () => {
  const { state } = bootToReady();
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 77,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess-1',
      toolCall: { toolName: 'bash' },
      options: [
        { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
      ],
    },
  });
  const { out } = onAgentMessage(state, request, CFG);
  assert.equal(out.length, 1);
  const reply = decode(out[0]);
  assert.equal(reply.id, 77, 'the reply must carry the agent request id it answers');
  assert.equal(reply.result.outcome.outcome, 'selected');
  assert.equal(reply.result.outcome.optionId, 'allow-always');
});

test('an allow option is preferred but never invented when the agent offers none', () => {
  assert.equal(choosePermissionOption([{ optionId: 'a', kind: 'allow_once' }]).optionId, 'a');
  assert.equal(
    choosePermissionOption([
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' },
    ]).optionId,
    'always'
  );
  assert.equal(choosePermissionOption([{ optionId: 'n', kind: 'reject_once' }]), null);
  assert.equal(choosePermissionOption([]), null);
});

test('a permission request with no allow option is cancelled rather than left hanging', () => {
  const { state } = bootToReady();
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 9,
    method: 'session/request_permission',
    params: { sessionId: 'sess-1', options: [{ optionId: 'no', kind: 'reject_once' }] },
  });
  const { out } = onAgentMessage(state, request, CFG);
  const reply = decode(out[0]);
  assert.equal(reply.id, 9);
  assert.equal(reply.result.outcome.outcome, 'cancelled');
});

test('a failed handshake is a stated failure, never silent', () => {
  let { state, out } = openingRequests(initialClientState(), CFG);
  const initId = decode(out[0]).id;
  ({ state, out } = onAgentMessage(
    state,
    JSON.stringify({ jsonrpc: '2.0', id: initId, error: { code: -32000, message: 'not authenticated' } }),
    CFG
  ));
  assert.equal(state.phase, 'failed');
  assert.match(state.failure, /not authenticated/);
  assert.equal(isReady(state), false);
  assert.deepEqual(out, [], 'a failed host sends nothing further');
});

test('agent chatter that is not a reply to us leaves the conversation state alone', () => {
  const { state } = bootToReady();
  const before = JSON.stringify(state);
  const { state: after, out } = onAgentMessage(
    state,
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } },
    }),
    CFG
  );
  assert.deepEqual(out, []);
  assert.equal(JSON.stringify(after), before);
});

test('a prompt result does not close the session - the seat stays ready for the next parcel', () => {
  const { state, sent } = bootToReady();
  const promptId = sent.map(decode).find((m) => m.method === 'session/prompt').id;
  const { state: after } = onAgentMessage(
    state,
    JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }),
    CFG
  );
  assert.equal(isReady(after), true);
  assert.equal(after.sessionId, 'sess-1');
});
