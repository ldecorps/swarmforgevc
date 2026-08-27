'use strict';

// BL-415: step handlers for "the filed-intake confirmation links to the
// file's GitHub location". The Background files a REAL raw intake through
// the genuine operator_file_question.bb subprocess against a real git repo
// (same fixture shape as operatorPassesAQuestionDownSteps.js's BL-371
// tests), giving every scenario a known committed rel-path + sha. "compose"
// itself then drives operator_lib.bb's pure filed-intake-confirmation-text
// directly via `bb -e` - the same module the CLI wires it through - rather
// than re-invoking the whole CLI a second time, which would mint a NEW
// commit and defeat the "known commit" framing the Background sets up.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARM_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARM_SCRIPTS, 'operator_file_question.bb');
const OPERATOR_LIB = path.join(SWARM_SCRIPTS, 'operator_lib.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo() {
  const dir = mkTmp('sfvc-bl415-repo-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: dir });
  return dir;
}

function fileQuestion(root, thread, question) {
  return spawnSync('bb', [CLI, root, '--thread', thread, '--question', question], { encoding: 'utf8' });
}

function currentOriginUrl(root) {
  const result = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

// Drives operator_lib.bb's pure functions directly, in-process from the
// module's own perspective (no hand-rolled JS reimplementation of the
// normalization/composition logic) - `bb -e` loads the same file the real
// CLI loads and calls the same exported functions.
function githubBaseFromRemoteUrl(remoteUrl) {
  const result = spawnSync('bb', [
    '-e',
    `(load-file "${OPERATOR_LIB}") (println (or (operator-lib/github-base-from-remote-url (first *command-line-args*)) ""))`,
    '--',
    remoteUrl || '',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`github-base-from-remote-url failed: ${result.stderr}`);
  }
  const out = result.stdout.trim();
  return out === '' ? null : out;
}

function filedIntakeConfirmationText(relPath, sha, remoteUrl) {
  const result = spawnSync('bb', [
    '-e',
    '(load-file "' + OPERATOR_LIB + '") ' +
      '(let [[rel sha remote] *command-line-args* ' +
      '      remote (if (clojure.string/blank? remote) nil remote)] ' +
      '  (println (operator-lib/filed-intake-confirmation-text rel sha remote)))',
    '--',
    relPath,
    sha,
    remoteUrl || '',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`filed-intake-confirmation-text failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator has just filed and committed a raw intake file at a known commit$/, (ctx) => {
    ctx.root = gitRepo();
    ctx.question = 'BL-415: does the confirmation link actually work?';
    const result = fileQuestion(ctx.root, 'SUP-1', ctx.question);
    if (result.status !== 0) {
      throw new Error(`setup failed: expected filing to succeed, got: ${result.stdout}${result.stderr}`);
    }
    ctx.filedRelPath = JSON.parse(result.stdout).filed;
    ctx.sha = execFileSync('git', ['-C', ctx.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  });

  // ── intake-reply-github-permalink-01 ────────────────────────────────
  registry.define(/^the origin remote resolves to owner "([^"]+)" and repo "([^"]+)"$/, (ctx, owner, repo) => {
    execFileSync('git', ['-C', ctx.root, 'remote', 'add', 'origin', `git@github.com:${owner}/${repo}.git`]);
  });

  registry.define(/^the filed-intake confirmation is composed$/, (ctx) => {
    const remoteUrl = currentOriginUrl(ctx.root);
    ctx.confirmationText = filedIntakeConfirmationText(ctx.filedRelPath, ctx.sha, remoteUrl);
  });

  registry.define(
    /^it contains the URL https:\/\/github\.com\/ldecorps\/swarmforgevc\/blob\/<sha>\/backlog\/INTAKE-<slug>\.md for the filing commit's sha$/,
    (ctx) => {
      const expected = `https://github.com/ldecorps/swarmforgevc/blob/${ctx.sha}/${ctx.filedRelPath}`;
      if (!ctx.confirmationText.includes(expected)) {
        throw new Error(`expected the confirmation to contain ${expected}, got: ${ctx.confirmationText}`);
      }
    }
  );

  registry.define(/^the URL uses the commit sha, not a mutable branch name$/, (ctx) => {
    if (!ctx.confirmationText.includes(ctx.sha)) {
      throw new Error(`expected the confirmation to carry the real commit sha, got: ${ctx.confirmationText}`);
    }
    if (ctx.confirmationText.includes('/blob/main/')) {
      throw new Error(`expected a commit-sha permalink, not a mutable branch link, got: ${ctx.confirmationText}`);
    }
  });

  // ── intake-reply-github-permalink-02 ────────────────────────────────
  registry.define(/^the origin remote URL is "([^"]+)"$/, (ctx, remoteUrl) => {
    ctx.remoteUrlUnderTest = remoteUrl;
  });

  registry.define(/^the GitHub base for permalinks is derived$/, (ctx) => {
    ctx.derivedBase = githubBaseFromRemoteUrl(ctx.remoteUrlUnderTest);
  });

  registry.define(/^it is "([^"]+)"$/, (ctx, expectedBase) => {
    if (ctx.derivedBase !== expectedBase) {
      throw new Error(`expected the derived GitHub base to be ${expectedBase}, got: ${ctx.derivedBase}`);
    }
  });

  // ── intake-reply-github-permalink-03 ────────────────────────────────
  registry.define(/^the origin remote is absent or not a GitHub URL$/, (ctx) => {
    // The Background's repo has no origin configured at all - this IS the
    // "absent" case; nothing to set up.
    if (currentOriginUrl(ctx.root) !== '') {
      throw new Error('expected no origin remote to be configured for this scenario');
    }
  });

  registry.define(/^it names the intake's plain repo-relative path$/, (ctx) => {
    const expected = `Filed for the swarm: ${ctx.filedRelPath}`;
    if (ctx.confirmationText !== expected) {
      throw new Error(`expected the plain-path fallback text "${expected}", got: ${ctx.confirmationText}`);
    }
  });

  registry.define(/^composing the confirmation does not fail$/, (ctx) => {
    if (typeof ctx.confirmationText !== 'string' || ctx.confirmationText.length === 0) {
      throw new Error('expected composing the confirmation to have produced non-empty text without throwing');
    }
  });
}

module.exports = { registerSteps };
