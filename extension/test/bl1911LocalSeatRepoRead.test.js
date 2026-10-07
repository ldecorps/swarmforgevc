'use strict';

// BL-1911: the local seat's repository read path, unit-tested in isolation
// from the turn loop (bl1235LocalQwenSeatLive.test.js covers the wiring).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  REPO_READ_MAX_BYTES,
  isSecretRelPath,
  searchRepoForQuestion,
  buildPromptWithRepoContext,
} = require('../out/tools/localSeatRepoRead');

describe('BL-1911 the secret-file filter', () => {
  it('catches the three conventions the ticket pins', () => {
    assert.equal(isSecretRelPath('.swarmforge/operator/bridge-token'), true);
    assert.equal(isSecretRelPath('.swarmforge/swarm.env'), true);
    assert.equal(isSecretRelPath('extension/.env'), true);
  });

  it('leaves an ordinary file alone', () => {
    assert.equal(isSecretRelPath('backlog/active/BL-9001-x.yaml'), false);
    assert.equal(isSecretRelPath('docs/reference/local-model-briefing.md'), false);
  });
});

describe('BL-1911 searchRepoForQuestion', () => {
  function withRepo(fn) {
    const root = mkTmpDir('bl1911-repo-');
    try {
      return fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('finds a ticket named by id and returns its text', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'backlog', 'active', 'BL-9001-the-bridge-restarts.yaml'),
        'id: BL-9001\ntitle: "the bridge restarts on a stale build"\n'
      );
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about?');
      assert.equal(reading.ok, true);
      assert.match(reading.context, /the bridge restarts on a stale build/);
    });
  });

  it('never reads a secret file even when the question names it by path', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'bridge-token'), 'SECRET-TOKEN-1911');
      const reading = searchRepoForQuestion(root, 'show me .swarmforge/operator/bridge-token');
      assert.equal(reading.ok, true);
      assert.ok(!reading.context.includes('SECRET-TOKEN-1911'), 'the secret leaked into the context');
    });
  });

  it('never reads a swarm.env or .env file either', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'swarm.env'), 'SECRET-TOKEN-1911');
      fs.writeFileSync(path.join(root, 'extension', '.env'), 'SECRET-TOKEN-1911');
      const a = searchRepoForQuestion(root, 'show me .swarmforge/swarm.env');
      const b = searchRepoForQuestion(root, 'show me extension/.env');
      assert.ok(!a.context.includes('SECRET-TOKEN-1911'));
      assert.ok(!b.context.includes('SECRET-TOKEN-1911'));
    });
  });

  it('reads an ordinary file the question names by path', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'docs', 'reference'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'reference', 'notes.md'), 'ordinary repo text');
      const reading = searchRepoForQuestion(root, 'show me docs/reference/notes.md');
      assert.match(reading.context, /ordinary repo text/);
    });
  });

  it('never escapes the repository root via a traversal path', () => {
    withRepo((root) => {
      const outside = mkTmpDir('bl1911-outside-');
      try {
        fs.writeFileSync(path.join(outside, 'leaked.txt'), 'SECRET-TOKEN-1911');
        const relEscape = path.relative(root, path.join(outside, 'leaked.txt'));
        const reading = searchRepoForQuestion(root, `show me ${relEscape}`);
        assert.ok(!reading.context.includes('SECRET-TOKEN-1911'), 'a traversal path escaped the repository root');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('reports ok: true with empty context when nothing in the question matches anything', () => {
    withRepo((root) => {
      const reading = searchRepoForQuestion(root, 'how is everyone doing today?');
      assert.equal(reading.ok, true);
      assert.equal(reading.context, '');
    });
  });

  it('reports ok: false, naming the reason, when the repository root cannot be read', () => {
    const reading = searchRepoForQuestion('/nonexistent/bl1911/root', 'what is BL-9001 about?');
    assert.equal(reading.ok, false);
    assert.ok(reading.reason && reading.reason.length > 0);
  });

  it('caps the returned context at the byte bound', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-huge.yaml'), 'x'.repeat(50000));
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about?', 100);
      assert.ok(reading.context.length <= 100, `context not capped: ${reading.context.length}`);
    });
    assert.equal(REPO_READ_MAX_BYTES > 0, true);
  });
});

describe('BL-1911 buildPromptWithRepoContext', () => {
  it('is just the question when nothing was found', () => {
    assert.equal(buildPromptWithRepoContext('hello?', { ok: true, context: '' }), 'hello?');
  });

  it('prepends what was read ahead of the question', () => {
    const prompt = buildPromptWithRepoContext('what is BL-9001 about?', {
      ok: true,
      context: 'the bridge restarts on a stale build',
    });
    assert.match(prompt, /the bridge restarts on a stale build/);
    assert.match(prompt, /what is BL-9001 about\?/);
  });

  it('says plainly the repository could not be read, and still carries the question', () => {
    const prompt = buildPromptWithRepoContext('what is BL-9001 about?', {
      ok: false,
      context: '',
      reason: 'EACCES: permission denied',
    });
    assert.match(prompt, /repository could not be read/);
    assert.match(prompt, /EACCES/);
    assert.match(prompt, /what is BL-9001 about\?/);
  });
});
