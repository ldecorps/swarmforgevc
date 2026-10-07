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

  // QA bounce 2026-10-07 D1: six real secret names the live repo carries
  // that the first build's filter missed.
  it('catches a backed-up, disabled, or dotfile .env variant, and anything under .swarmforge/operator/', () => {
    assert.equal(isSecretRelPath('.swarmforge/swarm.env.bak-before-bob-20260901T0940Z'), true);
    assert.equal(isSecretRelPath('.swarmforge/qwen.env.disabled'), true);
    assert.equal(isSecretRelPath('.swarmforge/openrouter.env.bak-anthropic-20260730'), true);
    assert.equal(isSecretRelPath('.swarmforge/operator/vscode-cli/data/token.json'), true);
    assert.equal(isSecretRelPath('.swarmforge/operator/vscode-cli/data/agent-host-token'), true);
    assert.equal(isSecretRelPath('.env.local'), true);
  });

  it('catches the operator directory itself, bare, not only a file under it', () => {
    assert.equal(isSecretRelPath('.swarmforge/operator'), true);
  });

  it('does not catch a sibling directory that merely shares the "operator" prefix', () => {
    assert.equal(isSecretRelPath('.swarmforge/operator-logs/notes.txt'), false);
  });

  // D1's component rule must not catch a name that merely CONTAINS "env" as
  // a substring rather than as a whole dot-delimited segment.
  it('leaves an "environment"-named file alone - "env" must be a whole component, not a substring', () => {
    assert.equal(isSecretRelPath('docs/environment.md'), false);
    assert.equal(isSecretRelPath('src/environment-setup.ts'), false);
  });

  // QA bounce D2: macOS's default APFS volume is case-insensitive, so a
  // case-sensitive filter would still open the real secret under a
  // differently-cased name.
  it('matches a secret name regardless of case', () => {
    assert.equal(isSecretRelPath('.swarmforge/operator/BRIDGE-TOKEN'), true);
    assert.equal(isSecretRelPath('.swarmforge/SWARM.ENV'), true);
    assert.equal(isSecretRelPath('extension/.ENV'), true);
    assert.equal(isSecretRelPath('.SWARMFORGE/OPERATOR/vscode-cli/data/token.json'), true);
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
    // The reason names the REAL underlying error, not a generic placeholder
    // - this is the only diagnostic a caller gets when the read fails.
    assert.match(reading.reason, /ENOENT|no such file/);
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

  it('leaves content exactly AT the cap untruncated, and truncates one character past it', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      // The cap is a strict ">", not ">=" - content whose length EQUALS the
      // cap must pass through unchanged.
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-exact.yaml'), 'x'.repeat(100));
      const atCap = searchRepoForQuestion(root, 'what is BL-9001 about?', 100);
      assert.equal(atCap.context.length, 100, `content at the exact cap was truncated: ${atCap.context.length}`);
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-exact.yaml'), 'x'.repeat(101));
      const overCap = searchRepoForQuestion(root, 'what is BL-9001 about?', 100);
      assert.equal(overCap.context.length, 100, `content one over the cap was not truncated: ${overCap.context.length}`);
    });
  });

  // QA bounce D3: a symlink INSIDE the repo pointing OUTSIDE it must not
  // leak the outside file's contents.
  it('never follows a symlink that points outside the repository', () => {
    withRepo((root) => {
      const outside = mkTmpDir('bl1911-outside-link-');
      try {
        fs.writeFileSync(path.join(outside, 'creds.txt'), 'SECRET-TOKEN-1911');
        fs.symlinkSync(outside, path.join(root, 'vendor'));
        const reading = searchRepoForQuestion(root, 'show me vendor/creds.txt');
        assert.ok(!reading.context.includes('SECRET-TOKEN-1911'), 'followed an outward symlink');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  // QA bounce D3: a symlink INSIDE the repo pointing at a secret must not
  // leak the secret's contents under the symlink's own, innocuous name.
  it('never follows a symlink to a secret file, even under an innocuous name', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'bridge-token'), 'SECRET-TOKEN-1911');
      fs.symlinkSync('../.swarmforge/operator/bridge-token', path.join(root, 'docs', 'notes.txt'));
      const reading = searchRepoForQuestion(root, 'show me docs/notes.txt');
      assert.ok(!reading.context.includes('SECRET-TOKEN-1911'), 'read a secret through a symlink to it');
    });
  });

  // QA bounce D4: 49% of done tickets sit under backlog/done/<milestone>/.
  it('finds a ticket filed under a nested backlog/done/<milestone>/ directory', () => {
    withRepo((root) => {
      const dir = path.join(root, 'backlog', 'done', 'M8');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'BL-9006-x.yaml'), 'title: "shipped under a milestone folder"\n');
      const reading = searchRepoForQuestion(root, 'what is BL-9006 about?');
      assert.match(reading.context, /shipped under a milestone folder/);
    });
  });

  // QA bounce D4: GH-<n> ids are never matched by /\bBL-\d+\b/.
  it('finds a GH-<n> ticket named by id, same as a BL-<n> one', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'done', 'GH-22-x.yaml'), 'title: "a github-sourced ticket"\n');
      const reading = searchRepoForQuestion(root, 'what is GH-22 about?');
      assert.match(reading.context, /a github-sourced ticket/);
    });
  });

  // QA bounce D4's own caveat about the shared lookup's looser match: a
  // question naming a SHORTER id that is a lexical prefix of a real file's
  // id must not pick that longer id's file.
  it('never picks a longer ticket id\'s file for a shorter id that is its lexical prefix', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9901-x.yaml'), 'title: "DECOY-LONGER-ID"\n');
      const reading = searchRepoForQuestion(root, 'what is BL-990 about?');
      assert.equal(reading.ok, true);
      assert.equal(reading.context, '');
    });
  });

  it('finds a ticket filed under any backlog subdirectory, not only active/', () => {
    withRepo((root) => {
      const placed = [
        ['paused', 'BL-9002', 'paused for later'],
        ['done', 'BL-9003', 'already shipped'],
        ['hold', 'BL-9004', 'held for the human'],
        ['archive', 'BL-9005', 'long since archived'],
      ];
      for (const [subdir, id, marker] of placed) {
        const dir = path.join(root, 'backlog', subdir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}-x.yaml`), `title: "${marker}"\n`);
      }
      for (const [, id, marker] of placed) {
        const reading = searchRepoForQuestion(root, `what is ${id} about?`);
        assert.match(reading.context, new RegExp(marker), `${id} (in its own subdir) was not found`);
      }
    });
  });

  it('picks the file matching BOTH the ticket-id prefix AND the .yaml suffix, never a decoy matching only one', () => {
    withRepo((root) => {
      const dir = path.join(root, 'backlog', 'active');
      fs.mkdirSync(dir, { recursive: true });
      // Right prefix, wrong extension - must not be picked.
      fs.writeFileSync(path.join(dir, 'BL-9001-notes.txt'), 'DECOY-WRONG-EXTENSION');
      // Right extension, wrong prefix - must not be picked.
      fs.writeFileSync(path.join(dir, 'BL-9002-other.yaml'), 'DECOY-WRONG-PREFIX');
      // The real match.
      fs.writeFileSync(path.join(dir, 'BL-9001-the-real-one.yaml'), 'title: "the real ticket text"\n');
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about?');
      assert.match(reading.context, /the real ticket text/);
      assert.ok(!reading.context.includes('DECOY-WRONG-EXTENSION'), 'picked the wrong-extension decoy');
      assert.ok(!reading.context.includes('DECOY-WRONG-PREFIX'), 'picked the wrong-prefix decoy');
    });
  });

  it('picks the file matching BOTH the ticket-id prefix AND the .yaml suffix under hold/, never a decoy matching only the prefix', () => {
    // hold/ and archive/ are NOT findTicketYamlPath's domain (D4) - they
    // stay this module's own flat loop, the only place that still checks
    // name.endsWith('.yaml') itself, so this decoy has to live here to
    // exercise that check at all.
    withRepo((root) => {
      const dir = path.join(root, 'backlog', 'hold');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'BL-9001-notes.txt'), 'DECOY-WRONG-EXTENSION');
      fs.writeFileSync(path.join(dir, 'BL-9001-the-real-one.yaml'), 'title: "the real held ticket text"\n');
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about?');
      assert.match(reading.context, /the real held ticket text/);
      assert.ok(!reading.context.includes('DECOY-WRONG-EXTENSION'), 'picked the wrong-extension decoy under hold/');
    });
  });

  it('finds nothing for a ticket id the question names when no backlog file matches it anywhere', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      const reading = searchRepoForQuestion(root, 'what is BL-4242 about?');
      assert.equal(reading.ok, true);
      assert.equal(reading.context, '');
    });
  });

  it('strips more than one layer of surrounding punctuation from a path token before resolving it', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'notes.md'), 'ordinary repo text');
      const reading = searchRepoForQuestion(root, 'see ((docs/notes.md))??');
      assert.match(reading.context, /ordinary repo text/);
    });
  });

  it('strips leading punctuation only from the START of the token, never from inside the real path', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      // A parenthesis that is part of the path itself (not surrounding
      // punctuation) must survive the strip untouched.
      fs.writeFileSync(path.join(root, 'docs', '(notes).md'), 'ordinary repo text');
      const reading = searchRepoForQuestion(root, 'see docs/(notes).md');
      assert.match(reading.context, /ordinary repo text/);
    });
  });

  it('skips a path token that resolves to a directory, and one that resolves to a nonexistent file, without crashing or leaking the literal "undefined"', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'notes.md'), 'ordinary repo text');
      // "docs/" (trailing slash) resolves to the directory itself, so it is
      // a path-shaped token that genuinely reaches the isFile() check.
      const reading = searchRepoForQuestion(root, 'look at docs/, docs/missing.md and docs/notes.md');
      assert.equal(reading.ok, true);
      assert.match(reading.context, /ordinary repo text/);
      assert.ok(!reading.context.includes('undefined'), `leaked a skipped read: ${reading.context}`);
    });
  });

  it('skips a path token that resolves to an existing, unreadable file, without crashing', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      const unreadable = path.join(root, 'docs', 'locked.md');
      fs.writeFileSync(unreadable, 'SHOULD NOT BE READ');
      fs.chmodSync(unreadable, 0o000);
      try {
        const reading = searchRepoForQuestion(root, 'see docs/locked.md');
        assert.equal(reading.ok, true);
        assert.equal(reading.context, '');
      } finally {
        fs.chmodSync(unreadable, 0o644);
      }
    });
  });

  it('never adds a blank entry for a skipped read sandwiched between two real snippets', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-x.yaml'), 'TICKET-SNIPPET');
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'notes.md'), 'PATH-SNIPPET');
      // The skipped directory token sits textually BETWEEN the ticket id
      // and the real path, so a wrongly-pushed "undefined" entry would
      // widen the separator to four newlines instead of two.
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about, also see docs/ and docs/notes.md');
      assert.equal(reading.context, 'TICKET-SNIPPET\n\nPATH-SNIPPET', `wrong join: ${JSON.stringify(reading.context)}`);
    });
  });

  it('joins two found snippets with a blank line between them, not run together', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-x.yaml'), 'TICKET-SNIPPET');
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'notes.md'), 'PATH-SNIPPET');
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about, see docs/notes.md');
      assert.match(reading.context, /TICKET-SNIPPET\n\nPATH-SNIPPET/);
    });
  });

  it('trims the joined context of surrounding whitespace', () => {
    withRepo((root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9001-x.yaml'), '\nhello\n');
      const reading = searchRepoForQuestion(root, 'what is BL-9001 about?');
      assert.equal(reading.context, 'hello');
    });
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
