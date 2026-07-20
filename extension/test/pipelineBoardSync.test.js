const assert = require('node:assert/strict');
const {
  syncPipelineBoard,
  classifyBoardFailure,
  PIPELINE_BOARD_ALERT_FAILURE_CAP,
  trackOrphanBoardMessageId,
  dropOrphanBoardMessageId,
  sweepOrphanBoardMessages,
} = require('../out/concierge/pipelineBoardSync');
const { renderPipelineBoardBody } = require('../out/concierge/pipelineBoard');

function fakeAdapters(overrides = {}) {
  return {
    ensureBoardTopic: async () => ({ topicId: 900 }),
    postMessage: async () => ({ messageId: 1 }),
    deleteMessage: async () => true,
    ...overrides,
  };
}

function board(rows, parked = []) {
  return { rows, parked };
}

const T1 = Date.UTC(2026, 6, 16, 20, 5);
const T2 = Date.UTC(2026, 6, 16, 20, 6);

// BL-462 pipeline-board-refine-05: the board is posted once with nothing to
// delete, then a later content change reposts (delete old + post new) at
// the bottom - never edited in place.

test('syncPipelineBoard: first call with no prior state creates the topic, posts a new message, and deletes nothing', async () => {
  const created = [];
  const posted = [];
  const deleted = [];
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({
      ensureBoardTopic: async () => {
        created.push(true);
        return { topicId: 900 };
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return { messageId: 42 };
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T1
  );

  assert.equal(result.outcome, 'posted');
  assert.equal(created.length, 1);
  assert.equal(deleted.length, 0, 'expected no delete call - nothing was posted before');
  const body = renderPipelineBoardBody(board([{ id: 'BL-1', column: 'coder', slug: '' }]));
  assert.deepEqual(posted, [{ topicId: 900, text: `${body}\n\nupdated at Jul 16 21:05 BST` }]);
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.messageId, 42);
  assert.equal(result.state.lastChangeMs, T1);
  assert.ok(result.state.contentSignature.startsWith(body));
  assert.equal(result.state.consecutiveFailures, 0);
  assert.equal(result.state.alertArmed, false);
});

test('syncPipelineBoard: a content change posts the fresh message BEFORE deleting the previously posted one', async () => {
  const calls = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        calls.push({ fn: 'post', topicId, text });
        return { messageId: 99 };
      },
      deleteMessage: async (topicId, messageId) => {
        calls.push({ fn: 'delete', topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'reposted');
  // BL-468: post-then-delete, never the reverse - there must be at least
  // one board message visible at every instant, and a post failure (see
  // the dedicated test below) must never have already deleted the old one.
  assert.deepEqual(
    calls.map((c) => c.fn),
    ['post', 'delete']
  );
  const [postCall, deleteCall] = calls;
  assert.equal(deleteCall.topicId, 900);
  assert.equal(deleteCall.messageId, first.state.messageId);
  assert.equal(postCall.topicId, 900);
  assert.equal(result.state.messageId, 99);
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.lastChangeMs, T2, 'expected the footer instant bumped to the NEW change');
});

test('syncPipelineBoard: a repost preserves lastPinnedBoardMessageId until pin sync updates it', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const withPin = { ...first.state, lastPinnedBoardMessageId: first.state.messageId };

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    withPin,
    fakeAdapters({ postMessage: async () => ({ messageId: 99 }) }),
    T2
  );

  assert.equal(result.outcome, 'reposted');
  assert.equal(result.state.messageId, 99);
  assert.equal(result.state.lastPinnedBoardMessageId, withPin.lastPinnedBoardMessageId);
});

test('BL-468: a failed repost never deletes the old message, and its messageId stays in state - the board is always visible', async () => {
  const deleted = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      postMessage: async () => ({}),
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'failed-post');
  assert.deepEqual(deleted, [], 'expected the old message never deleted when the fresh post fails');
  assert.equal(result.state.messageId, first.state.messageId, "expected the OLD (still-live) message's id to stay in state");
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.contentSignature, first.state.contentSignature, 'expected no signature bump until a post actually succeeds');
});

// BL-462 pipeline-board-refine-04/06: no content change -> complete no-op,
// including the footer time, however far the clock has moved.

test('syncPipelineBoard: unchanged content is a no-op - no post, no delete, state (including footer instant) untouched', async () => {
  const posted = [];
  const deleted = [];
  const data = board([{ id: 'BL-1', column: 'coder', slug: '' }]);
  const first = await syncPipelineBoard(data, undefined, fakeAdapters({ postMessage: async () => ({ messageId: 42 }) }), T1);

  const result = await syncPipelineBoard(
    data,
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return { messageId: 99 };
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'skipped-unchanged');
  assert.deepEqual(posted, []);
  assert.deepEqual(deleted, []);
  assert.deepEqual(result.state, first.state);
  assert.equal(result.state.lastChangeMs, T1, 'expected the footer instant to stay at the last REAL change, not bump to T2');
});

test('syncPipelineBoard: a link path change reposts even when the visible board body is unchanged', async () => {
  const posted = [];
  const deleted = [];
  const firstData = {
    rows: [{ id: 'BL-540', column: 'coder', slug: 'same-body' }],
    parked: [],
    links: [{ id: 'BL-540', path: 'backlog/paused/BL-540.yaml' }],
  };
  const secondData = {
    rows: [{ id: 'BL-540', column: 'coder', slug: 'same-body' }],
    parked: [],
    links: [{ id: 'BL-540', path: 'backlog/active/BL-540.yaml' }],
  };
  assert.equal(renderPipelineBoardBody(firstData), renderPipelineBoardBody(secondData), 'sanity: body text is unchanged');

  const first = await syncPipelineBoard(firstData, undefined, fakeAdapters({ postMessage: async () => ({ messageId: 42 }) }), T1, 'https://github.com/acme/repo');
  const result = await syncPipelineBoard(
    secondData,
    first.state,
    fakeAdapters({
      postMessage: async (topicId, text, boardHtml) => {
        posted.push({ topicId, text, boardHtml });
        return { messageId: 99 };
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    }),
    T2,
    'https://github.com/acme/repo'
  );

  assert.equal(result.outcome, 'reposted');
  assert.equal(posted.length, 1, 'expected a repost for the changed link path');
  assert.ok(posted[0].boardHtml.includes('backlog/active/BL-540.yaml'), posted[0].boardHtml);
  assert.deepEqual(deleted, [{ topicId: 900, messageId: 42 }]);
});

test('syncPipelineBoard: a failed topic creation is a no-op, retried next tick', async () => {
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({ ensureBoardTopic: async () => ({}) }),
    T1
  );

  assert.equal(result.outcome, 'failed-no-topic');
  assert.equal(result.state.topicId, undefined);
  assert.equal(result.state.consecutiveFailures, 1);
});

test('syncPipelineBoard: a failed post leaves the topic id persisted but no message id/signature bump, retried next tick', async () => {
  const result = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters({ postMessage: async () => ({}) }), T1);

  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.state.topicId, 900);
  assert.equal(result.state.messageId, undefined);
  assert.equal(result.state.contentSignature, undefined, 'expected no signature bump until a post actually succeeds');
});

test('syncPipelineBoard: a failed delete of the old message still lets the fresh message post (best-effort, never blocking)', async () => {
  const posted = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      deleteMessage: async () => false,
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return { messageId: 55 };
      },
    }),
    T2
  );

  assert.equal(result.outcome, 'reposted');
  assert.equal(posted.length, 1, 'expected the fresh message posted despite the delete failure');
  assert.equal(result.state.messageId, 55);
  assert.deepEqual(result.state.orphanMessageIds, [1], 'expected the undeleted prior board message tracked for later sweep');
});

test('syncPipelineBoard: an unchanged tick sweeps orphan board messages until they are gone', async () => {
  const deleted = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const reposted = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      deleteMessage: async () => false,
      postMessage: async () => ({ messageId: 55 }),
    }),
    T2
  );
  assert.deepEqual(reposted.state.orphanMessageIds, [1]);

  const swept = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    reposted.state,
    fakeAdapters({
      deleteMessage: async (topicId, messageId) => {
        deleted.push(messageId);
        return true;
      },
    }),
    T2
  );

  assert.equal(swept.outcome, 'skipped-unchanged');
  assert.deepEqual(deleted, [1]);
  assert.equal(swept.state.orphanMessageIds, undefined);
});

test('trackOrphanBoardMessageId: caps the orphan list and ignores the live message id', () => {
  let orphans = trackOrphanBoardMessageId(undefined, 10, 20);
  assert.deepEqual(orphans, [10]);
  orphans = trackOrphanBoardMessageId(orphans, 10, 20);
  assert.deepEqual(orphans, [10]);
  orphans = dropOrphanBoardMessageId(orphans, 10);
  assert.deepEqual(orphans, []);
});

test('sweepOrphanBoardMessages: retries deletes and keeps failures on the list', async () => {
  const attempts = [];
  const remaining = await sweepOrphanBoardMessages(900, 55, [1, 2, 55], async (_topicId, messageId) => {
    attempts.push(messageId);
    return messageId === 1;
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(remaining, [2]);
});

test('syncPipelineBoard: a topic already created (topicId persisted) is reused, never re-created', async () => {
  const created = [];
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({
      ensureBoardTopic: async () => {
        created.push(true);
        return { topicId: 901 };
      },
    }),
    T2
  );
  assert.deepEqual(created, [], 'expected ensureBoardTopic never called once a topicId is already persisted');
});

// BL-462 pipeline-board-refine-07: rendering/syncing the board touches no
// swarm state - the sync module itself performs no I/O beyond the injected
// adapters.

test('syncPipelineBoard: only the injected adapters are ever called - no other side effects', async () => {
  let ensureCalls = 0;
  let postCalls = 0;
  let deleteCalls = 0;
  await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({
      ensureBoardTopic: async () => {
        ensureCalls += 1;
        return { topicId: 900 };
      },
      postMessage: async () => {
        postCalls += 1;
        return { messageId: 42 };
      },
      deleteMessage: async () => {
        deleteCalls += 1;
        return true;
      },
    }),
    T1
  );
  assert.equal(ensureCalls, 1);
  assert.equal(postCalls, 1);
  assert.equal(deleteCalls, 0);
});

// ── BL-497: pipeline-board-post-failure-recovery ──────────────────────────

test('classifyBoardFailure: a "message thread not found" error classifies as topic-gone', () => {
  assert.equal(classifyBoardFailure('Bad Request: message thread not found'), 'topic-gone');
});

test('classifyBoardFailure: a 429 retry-after error classifies as transient', () => {
  assert.equal(classifyBoardFailure('Too Many Requests: retry after 26'), 'transient');
});

test('classifyBoardFailure: a network ENOTFOUND error classifies as transient', () => {
  assert.equal(classifyBoardFailure('ENOTFOUND api.telegram.org'), 'transient');
});

test('classifyBoardFailure: an unrecognized error classifies as unknown, and undefined classifies as unknown', () => {
  assert.equal(classifyBoardFailure('some never-seen-before Telegram rejection'), 'unknown');
  assert.equal(classifyBoardFailure(undefined), 'unknown');
});

// BL-502 pipeline-board-message-length-budget-04: a too-long payload is
// classified on its OWN class, distinct from topic-gone/transient/unknown -
// live outage 2026-07-17, "Bad Request: text is too long".

test('classifyBoardFailure: a "text is too long" error classifies as too-long, not unknown or transient', () => {
  assert.equal(classifyBoardFailure('Bad Request: text is too long'), 'too-long');
});

test('syncPipelineBoard: a too-long post failure is classified too-long and RETAINS the tracked topic id - the topic is fine, only the payload was too big', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({ postMessage: async () => ({ error: 'Bad Request: text is too long' }) }),
    T2
  );

  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.failureClass, 'too-long');
  assert.equal(result.state.topicId, first.state.topicId, 'expected the tracked topic id retained - too-long never recreates the topic');
});

// ── BL-502 pipeline-board-message-length-budget-03: the board still posts
//    at a backlog size whose full link list would exceed the send limit ──

function manyLinkRows(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `BL-${i}`, column: 'coder', slug: '' }));
}

function manyLinks(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `BL-${i}`, path: `backlog/active/BL-${i}-a-fine-feature-with-a-longish-slug.yaml` }));
}

test('syncPipelineBoard: the board still posts at a backlog size whose full link list would exceed Telegram\'s send limit, never freezes on length', async () => {
  const rows = manyLinkRows(40);
  const links = manyLinks(40);
  let capturedComposedLength;

  const result = await syncPipelineBoard(
    { rows, parked: [], links },
    undefined,
    fakeAdapters({
      postMessage: async (topicId, text, boardHtml) => {
        capturedComposedLength = boardHtml.length;
        if (capturedComposedLength > 4096) {
          return { error: 'Bad Request: text is too long' };
        }
        return { messageId: 1 };
      },
    }),
    T1,
    'https://github.com/ldecorps/swarmforgevc'
  );

  assert.equal(result.outcome, 'posted', 'expected the board to post successfully instead of failing on length');
  assert.ok(capturedComposedLength <= 4096, `expected the composed message within Telegram's real limit, got ${capturedComposedLength}`);
});

test('syncPipelineBoard: boardHtml handed to postMessage stays within the message budget (anchors dropped when needed)', async () => {
  const rows = manyLinkRows(40);
  const links = manyLinks(40);
  let capturedBoardHtml;

  await syncPipelineBoard(
    { rows, parked: [], links },
    undefined,
    fakeAdapters({
      postMessage: async (topicId, text, boardHtml) => {
        capturedBoardHtml = boardHtml;
        return { messageId: 1 };
      },
    }),
    T1,
    'https://github.com/ldecorps/swarmforgevc'
  );

  assert.ok(capturedBoardHtml.length <= 4000, `expected boardHtml within PIPELINE_BOARD_MESSAGE_MAX_LENGTH, got ${capturedBoardHtml.length}`);
  assert.ok(!capturedBoardHtml.includes('LINKS:'), 'expected no legacy LINKS: section');
});
// BL-497 pipeline-board-post-failure-recovery-01: every failed outcome
// surfaces its underlying error instead of swallowing it.

test('syncPipelineBoard: a failed post surfaces its underlying Telegram error on the result', async () => {
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({ postMessage: async () => ({ error: 'Bad Request: message thread not found' }) }),
    T1
  );
  assert.equal(result.outcome, 'failed-post');
  assert.equal(result.error, 'Bad Request: message thread not found');
});

test('syncPipelineBoard: a failed topic creation surfaces its underlying Telegram error on the result', async () => {
  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'coder', slug: '' }]),
    undefined,
    fakeAdapters({ ensureBoardTopic: async () => ({ error: 'Too Many Requests: retry after 26' }) }),
    T1
  );
  assert.equal(result.outcome, 'failed-no-topic');
  assert.equal(result.error, 'Too Many Requests: retry after 26');
});

// BL-497 pipeline-board-post-failure-recovery-02: classification decides
// whether the stale topic id is cleared (self-heal) or retained.

test('syncPipelineBoard: a topic-gone post failure is classified topic-gone and clears the tracked topic id', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({ postMessage: async () => ({ error: 'Bad Request: message thread not found' }) }),
    T2
  );

  assert.equal(result.failureClass, 'topic-gone');
  assert.equal(result.state.topicId, undefined, 'expected the tracked topic id cleared so the next tick re-ensures a fresh one');
  assert.equal(result.state.messageId, undefined, 'expected the stale messageId cleared too - it belongs to the now-gone topic');
});

test('syncPipelineBoard: a transient post failure is classified transient and retains the tracked topic id', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({ postMessage: async () => ({ error: 'Too Many Requests: retry after 26' }) }),
    T2
  );

  assert.equal(result.failureClass, 'transient');
  assert.equal(result.state.topicId, 900, 'expected the topic id retained - a transient blip must never spawn a duplicate topic');
});

test('syncPipelineBoard: an ENOTFOUND post failure is classified transient and retains the tracked topic id', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const result = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({ postMessage: async () => ({ error: 'ENOTFOUND api.telegram.org' }) }),
    T2
  );

  assert.equal(result.failureClass, 'transient');
  assert.equal(result.state.topicId, 900);
});

// BL-497 pipeline-board-post-failure-recovery-03: after a topic-gone clear,
// the next tick re-ensures a fresh topic and recovers with no human
// intervention.

test('syncPipelineBoard: after a topic-gone clear, the next tick re-ensures a fresh topic and posts the board', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const failed = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    first.state,
    fakeAdapters({ postMessage: async () => ({ error: 'Bad Request: message thread not found' }) }),
    T2
  );
  assert.equal(failed.state.topicId, undefined, 'sanity check: prior test already covers this - the clear must have happened');

  const ensured = [];
  const posted = [];
  const recovered = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: '' }]),
    failed.state,
    fakeAdapters({
      ensureBoardTopic: async () => {
        ensured.push(true);
        return { topicId: 950 };
      },
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return { messageId: 5 };
      },
    }),
    Date.UTC(2026, 6, 16, 20, 7)
  );

  assert.equal(ensured.length, 1, 'expected a fresh board topic ensured');
  assert.equal(posted.length, 1, 'expected the board posted into the fresh topic');
  assert.equal(posted[0].topicId, 950);
  assert.equal(recovered.outcome, 'posted');
  assert.equal(recovered.state.topicId, 950);
  assert.equal(recovered.state.consecutiveFailures, 0, 'expected the failure episode cleared on recovery');
});

// BL-497 pipeline-board-post-failure-recovery-04/06: bounded retry + exactly
// one operator alert, armed only on confirmed delivery.

async function driveTransientFailures(count, state, alertAdapterOverrides = {}) {
  let current = state;
  const alertsSent = [];
  const adapters = fakeAdapters({
    postMessage: async () => ({ error: 'Too Many Requests: retry after 26' }),
    emitFailureAlert: async (message) => {
      alertsSent.push(message);
      return true;
    },
    ...alertAdapterOverrides,
  });
  let result;
  for (let i = 0; i < count; i += 1) {
    result = await syncPipelineBoard(board([{ id: 'BL-1', column: 'QA', slug: `${i}` }]), current, adapters, T2 + i * 1000);
    current = result.state;
  }
  return { result, alertsSent, adapters };
}

test('syncPipelineBoard: repeated transient failures raise exactly one operator alert at the retry cap', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const { result, alertsSent } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, first.state);

  assert.equal(result.state.consecutiveFailures, PIPELINE_BOARD_ALERT_FAILURE_CAP);
  assert.equal(alertsSent.length, 1, `expected exactly one alert emitted at the cap, got: ${JSON.stringify(alertsSent)}`);
  assert.equal(
    alertsSent[0],
    `Pipeline Board frozen: ${PIPELINE_BOARD_ALERT_FAILURE_CAP} consecutive failed post attempts (last error: Too Many Requests: retry after 26).`,
    'expected the alert text to name the failure count and the last Telegram error'
  );
  assert.equal(result.state.topicId, 900, 'expected the same topic id retained, no new topic created');
  assert.equal(result.state.alertArmed, true);
});

test('syncPipelineBoard: an alert raised for a failure with no error string omits the "last error" clause', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);

  const { alertsSent } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, first.state, {
    postMessage: async () => ({}),
  });

  assert.equal(alertsSent.length, 1);
  assert.equal(
    alertsSent[0],
    `Pipeline Board frozen: ${PIPELINE_BOARD_ALERT_FAILURE_CAP} consecutive failed post attempts.`,
    'expected no "(last error: ...)" clause when the failure carried no error string'
  );
});

test('syncPipelineBoard: a further transient failure past the cap emits no additional alert', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const { result: atCap, alertsSent } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, first.state);
  assert.equal(alertsSent.length, 1);

  const again = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: 'one-more' }]),
    atCap.state,
    fakeAdapters({
      postMessage: async () => ({ error: 'Too Many Requests: retry after 26' }),
      emitFailureAlert: async (message) => {
        alertsSent.push(message);
        return true;
      },
    }),
    T2 + 999_000
  );

  assert.equal(again.outcome, 'failed-post');
  assert.equal(alertsSent.length, 1, 'expected no additional alert once already armed');
  assert.equal(again.state.topicId, 900, 'expected the same topic id retained, no new topic created');
});

// BL-497 pipeline-board-post-failure-recovery-05: a successful post clears
// the failure state so a later episode alarms fresh.

test('syncPipelineBoard: a successful post clears the consecutive-failure count and the armed alert', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const { result: atCap } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, first.state);
  assert.equal(atCap.state.alertArmed, true);

  const recovered = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'done', slug: 'recovered' }]),
    atCap.state,
    fakeAdapters({ postMessage: async () => ({ messageId: 77 }) }),
    T2 + 1_000_000
  );

  assert.equal(recovered.outcome, 'reposted');
  assert.equal(recovered.state.consecutiveFailures, 0);
  assert.equal(recovered.state.alertArmed, false);

  // A later transient episode must be able to alarm again from zero.
  const { alertsSent: laterAlerts } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, recovered.state);
  assert.equal(laterAlerts.length, 1, 'expected the later episode to alarm again after the count reset');
});

// BL-497 pipeline-board-post-failure-recovery-06: the alert arms only on
// confirmed delivery, never on the attempt.

test('syncPipelineBoard: a failed alert send is not recorded as delivered, and the next failing tick attempts it again', async () => {
  const first = await syncPipelineBoard(board([{ id: 'BL-1', column: 'coder', slug: '' }]), undefined, fakeAdapters(), T1);
  const attempts = [];
  const { result: atCap } = await driveTransientFailures(PIPELINE_BOARD_ALERT_FAILURE_CAP, first.state, {
    emitFailureAlert: async (message) => {
      attempts.push(message);
      return false;
    },
  });

  assert.equal(attempts.length, 1, 'expected the alert attempted once at the cap');
  assert.equal(atCap.state.alertArmed, false, 'expected the alert NOT recorded as delivered - the send failed');

  const nextTick = await syncPipelineBoard(
    board([{ id: 'BL-1', column: 'QA', slug: 'retry-alert' }]),
    atCap.state,
    fakeAdapters({
      postMessage: async () => ({ error: 'Too Many Requests: retry after 26' }),
      emitFailureAlert: async (message) => {
        attempts.push(message);
        return true;
      },
    }),
    T2 + 2_000_000
  );

  assert.equal(attempts.length, 2, 'expected the next failing tick to attempt the alert again rather than suppressing it');
  assert.equal(nextTick.state.alertArmed, true, 'expected the alert armed once delivery is finally confirmed');
});
