const assert = require('node:assert/strict');
const { commitRecertProposalToRepo, recertProposalCommitPath } = require('../out/notify/recertProposalRepoCommit');

const PROPOSAL = { scenarioId: 'BL-042-demo-01', outcome: 'update', newText: 'new text', receivedAtIso: '2026-07-09T12:00:00Z' };
const CONFIG = { owner: 'ldecorps', repo: 'swarmforgevc', branch: 'main', token: 'secret-token-xyz' };
const NOW = new Date('2026-07-09T12:00:00Z').getTime();

test('recertProposalCommitPath is one-per-change under backlog/recert-inbox/', () => {
  const path = recertProposalCommitPath(PROPOSAL, NOW);
  assert.match(path, /^backlog\/recert-inbox\/BL-042-demo-01-.*\.json$/);
});

test('recertProposalCommitPath gives different proposals for the same scenario different paths', () => {
  const a = recertProposalCommitPath(PROPOSAL, NOW);
  const b = recertProposalCommitPath(PROPOSAL, NOW + 1000);
  assert.notEqual(a, b);
});

test('commitRecertProposalToRepo PUTs the proposal as base64 content to the GitHub contents API', async () => {
  const calls = [];
  const putFn = async (url, body, token) => {
    calls.push({ url, body, token });
    return { ok: true, status: 201 };
  };

  await commitRecertProposalToRepo(PROPOSAL, CONFIG, NOW, putFn);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/ldecorps\/swarmforgevc\/contents\/backlog\/recert-inbox\//);
  assert.equal(calls[0].token, 'secret-token-xyz');
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.branch, 'main');
  assert.match(payload.message, /BL-042-demo-01/);
  const decoded = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));
  assert.deepEqual(decoded, PROPOSAL);
});

test('commitRecertProposalToRepo throws (does not swallow) a non-ok response, without leaking the token', async () => {
  const putFn = async () => ({ ok: false, status: 422 });
  await assert.rejects(
    () => commitRecertProposalToRepo(PROPOSAL, CONFIG, NOW, putFn),
    (err) => {
      assert.match(err.message, /422/);
      assert.doesNotMatch(err.message, /secret-token-xyz/);
      return true;
    }
  );
});
