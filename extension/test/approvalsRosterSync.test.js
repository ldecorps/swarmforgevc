const assert = require('node:assert/strict');
const { syncApprovalsRoster } = require('../out/concierge/approvalsRosterSync');

function fakeAdapters(overrides = {}) {
  return {
    ensureApprovalsTopic: async () => 800,
    postMessage: async () => 1,
    editMessage: async () => true,
    ...overrides,
  };
}

// BL-434 approvals-standing-topic-04/05: the roster is posted once, then
// edited in place on a pending-set change - never re-posted as a new
// message - and reflects removal once a ticket is acted on.

test('syncApprovalsRoster: first call with no prior state creates the topic and posts a new message', async () => {
  const created = [];
  const posted = [];
  const result = await syncApprovalsRoster(
    [{ id: 'BL-433', title: 'a fine feature' }],
    undefined,
    fakeAdapters({
      ensureApprovalsTopic: async () => {
        created.push(true);
        return 800;
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 42;
      },
    })
  );

  assert.equal(result.outcome, 'posted');
  assert.deepEqual(result.state, { topicId: 800, messageId: 42, renderedText: result.state.renderedText });
  assert.equal(created.length, 1);
  assert.deepEqual(posted, [{ topicId: 800, text: result.state.renderedText }]);
  assert.match(result.state.renderedText, /BL-433/);
});

test('syncApprovalsRoster: a second pending ticket edits the existing message in place, never posts a new one', async () => {
  const posted = [];
  const edited = [];
  const prevState = { topicId: 800, messageId: 42, renderedText: 'Awaiting approval:\nBL-433 - a fine feature' };
  const result = await syncApprovalsRoster(
    [
      { id: 'BL-433', title: 'a fine feature' },
      { id: 'BL-440', title: 'second' },
    ],
    prevState,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'edited');
  assert.equal(posted.length, 0, 'expected no new message posted on a pending-set change');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].topicId, 800);
  assert.equal(edited[0].messageId, 42);
  assert.match(edited[0].text, /BL-433/);
  assert.match(edited[0].text, /BL-440/);
});

test('syncApprovalsRoster: an unchanged pending set is a no-op - no post, no edit', async () => {
  const posted = [];
  const edited = [];
  const tickets = [{ id: 'BL-433', title: 'a fine feature' }];
  const first = await syncApprovalsRoster(tickets, undefined, fakeAdapters({ postMessage: async () => 42 }));

  const result = await syncApprovalsRoster(
    tickets,
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skipped-unchanged');
  assert.deepEqual(posted, []);
  assert.deepEqual(edited, []);
  assert.deepEqual(result.state, first.state);
});

test('syncApprovalsRoster: once acted on, a ticket dropping out of the pending set edits the roster to remove it', async () => {
  const edited = [];
  const prevState = { topicId: 800, messageId: 42, renderedText: 'Awaiting approval:\nBL-433 - a fine feature' };
  const result = await syncApprovalsRoster(
    [],
    prevState,
    fakeAdapters({
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'edited');
  assert.equal(edited.length, 1);
  assert.doesNotMatch(edited[0].text, /BL-433/);
  assert.match(edited[0].text, /No tickets are currently awaiting approval/);
});

test('syncApprovalsRoster: a failed topic creation is a no-op, retried next tick', async () => {
  const result = await syncApprovalsRoster([{ id: 'BL-433' }], undefined, fakeAdapters({ ensureApprovalsTopic: async () => undefined }));

  assert.equal(result.outcome, 'failed-no-topic');
  assert.deepEqual(result.state, {});
});

test('syncApprovalsRoster: a failed post leaves the topic id persisted but no message id, retried next tick', async () => {
  const result = await syncApprovalsRoster([{ id: 'BL-433' }], undefined, fakeAdapters({ postMessage: async () => undefined }));

  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.state.topicId, 800);
  assert.equal(result.state.messageId, undefined);
});

test('syncApprovalsRoster: a failed edit leaves prior state untouched, retried next tick', async () => {
  const prevState = { topicId: 800, messageId: 42, renderedText: 'stale roster' };
  const result = await syncApprovalsRoster([{ id: 'BL-433' }], prevState, fakeAdapters({ editMessage: async () => false }));

  assert.equal(result.outcome, 'failed-edit');
  assert.deepEqual(result.state, prevState);
});

test('syncApprovalsRoster: a topic already created (topicId persisted) is reused, never re-created', async () => {
  const created = [];
  const prevState = { topicId: 800, messageId: 42, renderedText: 'stale roster' };
  await syncApprovalsRoster(
    [{ id: 'BL-433' }],
    prevState,
    fakeAdapters({
      ensureApprovalsTopic: async () => {
        created.push(true);
        return 801;
      },
    })
  );
  assert.deepEqual(created, [], 'expected ensureApprovalsTopic never called once a topicId is already persisted');
});
