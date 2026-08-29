const assert = require('node:assert/strict');
const {
  pendingSetIdentity,
  shouldAnnouncePendingApprovals,
  formatPendingAgeLabel,
  renderPendingApprovalsAnnouncement,
  runPendingApprovalsAnnouncement,
  ANNOUNCEMENT_REANNOUNCE_MS,
} = require('../out/concierge/pendingApprovalsAnnouncement');
const { computeNeedsApproval } = require('../out/metrics/backlogDashboard');

// BL-649: swarm-start pending approvals doorbell.

test('pendingSetIdentity is sorted and stable', () => {
  assert.equal(pendingSetIdentity(['BL-2', 'BL-1']), 'BL-1,BL-2');
});

test('shouldAnnouncePendingApprovals gates unchanged restarts for 24h', () => {
  const now = 1_700_000_000_000;
  const marker = { pendingSetIdentity: 'BL-1', lastAnnouncedAtMs: now - 1000 };
  assert.equal(shouldAnnouncePendingApprovals(marker, 'BL-1', true, now), false);
  assert.equal(
    shouldAnnouncePendingApprovals(marker, 'BL-1', true, now + ANNOUNCEMENT_REANNOUNCE_MS),
    true
  );
  assert.equal(shouldAnnouncePendingApprovals(marker, 'BL-1,BL-2', true, now), true);
});

test('renderPendingApprovalsAnnouncement quotes yaml fields', () => {
  const now = 1_700_000_000_000;
  const text = renderPendingApprovalsAnnouncement(
    [
      {
        id: 'BL-649',
        title: 'Doorbell feature',
        approvalContext: 'Approve buys phone notifications.',
        pendingSinceMs: now - 2 * 24 * 60 * 60 * 1000,
      },
    ],
    now
  );
  assert.match(text, /BL-649/);
  assert.match(text, /Doorbell feature/);
  assert.match(text, /Approve buys phone notifications/);
  assert.match(text, /pending 2 days/);
});

test('runPendingApprovalsAnnouncement always posts a new message', async () => {
  const posts = [];
  const result = await runPendingApprovalsAnnouncement(
    [{ id: 'BL-1', title: 't' }],
    undefined,
    {
      ensureApprovalsTopic: async () => 750,
      postMessage: async (topicId, text) => {
        posts.push({ topicId, text });
        return 9001;
      },
    },
    1_700_000_000_000
  );
  assert.equal(result.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].topicId, 750);
});

test('computeNeedsApproval enumerates active and paused pending tickets', () => {
  const entries = computeNeedsApproval(
    [{ id: 'BL-A', title: 'a', humanApproval: 'pending', approvalContext: 'ctx-a' }],
    [{ id: 'BL-P', title: 'p', humanApproval: 'pending' }]
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].approvalContext, 'ctx-a');
});
