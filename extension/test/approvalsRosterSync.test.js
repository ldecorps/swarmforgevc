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
        return 800;
      },
    })
  );
  // Live ensure is consulted every tick (remint-safe); same id means edit-in-place, not create.
  assert.equal(created.length, 1, 'expected ensureApprovalsTopic consulted so a remint is visible');
});

// 2026-07-19: Approvals topic reminted (telegram-topic-map lost APPROVALS binding /
// createForumTopic minted a new thread). Asks always call ensureApprovalsTopic and
// followed the new id; the roster sticky-cached prevState.topicId and kept editing
// the dead topic — Approvals channel looked empty while Operator/Concierge stayed busy.
test('syncApprovalsRoster: when ensureApprovalsTopic remints, roster follows the new topic (not sticky-cached topicId)', async () => {
  let approvalsTopicId = 750;
  const posted = [];
  const edited = [];
  const adapters = fakeAdapters({
    ensureApprovalsTopic: async () => approvalsTopicId,
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42 + posted.length;
    },
    editMessage: async (topicId, messageId, text) => {
      edited.push({ topicId, messageId, text });
      return true;
    },
  });

  const first = await syncApprovalsRoster([{ id: 'BL-525', title: 'ModelFactory' }], undefined, adapters);
  assert.equal(first.outcome, 'posted');
  assert.equal(first.state.topicId, 750);

  approvalsTopicId = 751;
  const second = await syncApprovalsRoster(
    [
      { id: 'BL-525', title: 'ModelFactory' },
      { id: 'BL-999', title: 'other' },
    ],
    first.state,
    adapters
  );

  assert.equal(second.state.topicId, 751, 'roster must track the reminted Approvals topic id');
  assert.ok(
    posted.some((p) => p.topicId === 751) || edited.some((e) => e.topicId === 751),
    'roster write must target the reminted Approvals topic, not the stale cached id'
  );
  assert.ok(!edited.some((e) => e.topicId === 750), 'must not keep editing the dead pre-remint topic');
});

test('syncApprovalsRoster: remint with unchanged roster text still re-posts onto the new Approvals topic', async () => {
  let approvalsTopicId = 750;
  const posted = [];
  const adapters = fakeAdapters({
    ensureApprovalsTopic: async () => approvalsTopicId,
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 99;
    },
  });
  const tickets = [{ id: 'BL-525', title: 'ModelFactory' }];
  const first = await syncApprovalsRoster(tickets, undefined, adapters);
  assert.equal(first.outcome, 'posted');

  approvalsTopicId = 751;
  const second = await syncApprovalsRoster(tickets, first.state, adapters);
  assert.equal(second.state.topicId, 751);
  assert.equal(second.outcome, 'posted', 'same text on a reminted topic must post fresh, not skip-unchanged against the dead topic');
  assert.ok(posted.some((p) => p.topicId === 751));
});
