const assert = require('node:assert/strict');
const { syncRecertPosting } = require('../out/concierge/recertPostingSync');

function scenario(overrides = {}) {
  return { id: 'BL-207-thing-01', ticketId: 'BL-207', ticketTitle: 'a fine ticket', name: 'thing', text: 'Given a', ...overrides };
}

function fakeAdapters(overrides = {}) {
  return {
    ensureRecertTopic: async () => 900,
    postMessage: async () => 1,
    editMessage: async () => true,
    ...overrides,
  };
}

// BL-450 recert-telegram-01/02/08: post the current oldest scenario once,
// edit in place only when it changes, and never post at all when the queue
// is empty.

test('recert-telegram-01: first call with a scenario and no prior state creates the topic and posts a new message', async () => {
  const created = [];
  const posted = [];
  const result = await syncRecertPosting(
    scenario(),
    undefined,
    fakeAdapters({
      ensureRecertTopic: async () => {
        created.push(true);
        return 900;
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 42;
      },
    })
  );

  assert.equal(result.outcome, 'posted');
  assert.equal(created.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, 900);
  assert.match(posted[0].text, /BL-207-thing-01/);
  assert.deepEqual(result.state, { topicId: 900, messageId: 42, renderedText: result.state.renderedText });
});

test('recert-telegram-02: an unchanged oldest scenario is not re-posted or re-edited on the next tick', async () => {
  const posted = [];
  const edited = [];
  const first = await syncRecertPosting(scenario(), undefined, fakeAdapters({ postMessage: async () => 42 }));

  const result = await syncRecertPosting(
    scenario(),
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

test('once the oldest scenario changes (e.g. the prior one was validated), the SAME message is edited in place, never a new one posted', async () => {
  const posted = [];
  const edited = [];
  const first = await syncRecertPosting(scenario(), undefined, fakeAdapters({ postMessage: async () => 42 }));

  const result = await syncRecertPosting(
    scenario({ id: 'BL-300-other-01', ticketTitle: 'a different ticket', text: 'Given x' }),
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

  assert.equal(result.outcome, 'edited');
  assert.equal(posted.length, 0, 'expected no new message posted when the oldest scenario changes');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].topicId, 900);
  assert.equal(edited[0].messageId, 42);
  assert.match(edited[0].text, /BL-300-other-01/);
});

test('recert-telegram-08: no scenario needs recertification - nothing is posted, the topic is never even created', async () => {
  const created = [];
  const posted = [];
  const result = await syncRecertPosting(
    undefined,
    undefined,
    fakeAdapters({
      ensureRecertTopic: async () => {
        created.push(true);
        return 900;
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 1;
      },
    })
  );

  assert.equal(result.outcome, 'skipped-unchanged');
  assert.deepEqual(result.state, {});
  assert.deepEqual(created, []);
  assert.deepEqual(posted, []);
});

test('a failed topic creation is a no-op, retried next tick', async () => {
  const result = await syncRecertPosting(scenario(), undefined, fakeAdapters({ ensureRecertTopic: async () => undefined }));

  assert.equal(result.outcome, 'failed-no-topic');
  assert.deepEqual(result.state, {});
});

test('a topic already created (topicId persisted) still consults ensureRecertTopic (remint-safe)', async () => {
  const created = [];
  const posted = [];
  const prevState = { topicId: 900, messageId: 42, renderedText: 'stale text' };
  const result = await syncRecertPosting(
    scenario(),
    prevState,
    fakeAdapters({
      ensureRecertTopic: async () => {
        created.push(true);
        return 900;
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 99;
      },
    })
  );
  assert.equal(created.length, 1, 'expected ensureRecertTopic consulted every sync');
  assert.equal(result.state.topicId, 900);
  assert.equal(posted.length, 0, 'same live topic id edits in place, does not re-post');
});

test('when ensureRecertTopic remints, posting follows the new topic id', async () => {
  const posted = [];
  const prevState = { topicId: 900, messageId: 42, renderedText: 'stale text' };
  const result = await syncRecertPosting(
    scenario(),
    prevState,
    fakeAdapters({
      ensureRecertTopic: async () => 901,
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return 77;
      },
    })
  );
  assert.equal(result.state.topicId, 901);
  assert.equal(result.outcome, 'posted');
  assert.deepEqual(posted, [{ topicId: 901, text: result.state.renderedText }]);
});
