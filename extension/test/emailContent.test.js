const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEmailSubject, buildEmailBody } = require('../out/notify/emailContent');

test('buildEmailSubject names the role', () => {
  assert.equal(buildEmailSubject('coder'), 'SwarmForge: coder needs you');
});

test('buildEmailBody names the role and includes the prompt snippet and session link', () => {
  const body = buildEmailBody({
    role: 'coder',
    snippet: 'Allow this action? (y/n)',
    sessionUrl: 'https://claude.ai/code/session_abc',
    ticketBadge: null,
  });
  assert.match(body, /coder is waiting on a response\./);
  assert.match(body, /Allow this action\? \(y\/n\)/);
  assert.match(body, /https:\/\/claude\.ai\/code\/session_abc/);
});

test('buildEmailBody includes the held ticket badge when one resolves', () => {
  const body = buildEmailBody({
    role: 'coder',
    snippet: 'Continue?',
    sessionUrl: 'https://claude.ai/code/session_abc',
    ticketBadge: { id: 'BL-073', summary: 'email notify on needs-human' },
  });
  assert.match(body, /BL-073/);
  assert.match(body, /email notify on needs-human/);
});

test('buildEmailBody omits the ticket line when no ticket badge resolves', () => {
  const body = buildEmailBody({
    role: 'coder',
    snippet: 'Continue?',
    sessionUrl: 'https://claude.ai/code/session_abc',
    ticketBadge: null,
  });
  assert.doesNotMatch(body, /Ticket:/);
});

test('buildEmailBody falls back to a tile-answer note when no session URL was captured', () => {
  const body = buildEmailBody({
    role: 'architect',
    snippet: 'Approve?',
    sessionUrl: null,
    ticketBadge: null,
  });
  assert.match(body, /no session link (was )?captured/i);
  assert.match(body, /tile/i);
  assert.doesNotMatch(body, /Open:/);
});
