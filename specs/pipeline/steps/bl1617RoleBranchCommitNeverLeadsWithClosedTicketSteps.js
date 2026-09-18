'use strict';

// BL-1617: step handlers for "A role-branch commit never leads with a
// closed ticket" (specifier-authored feature, lands with this handler in
// the same parcel - BL-233, BL-1371). Drives the REAL commit-msg hook
// (swarmforge/scripts/check_closed_ticket_subject.sh, wired into
// swarmforge/git-hooks/commit-msg) against a real fixture git repository
// with a fake origin/main (BL-1390's mkdtemp-fixture posture).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1617 A role-branch commit never leads with a closed ticket';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_closed_ticket_subject.sh');

// Explicit KNOWN_VALUES per the Scenario Outline handler rule: every
// Examples row's subject and outcome text is looked up here, never passed
// through unchecked.
const OUTCOME_KINDS = new Map([
  [
    'is refused naming BL-0001 as closed and telling the author to lead with the open owner',
    { refused: true, mustInclude: ['BL-0001', 'closed'] },
  ],
  [
    'is committed',
    { refused: false },
  ],
  [
    'is refused as ambiguous naming BL-0001 and BL-0002 and telling the author to lead with the open owner',
    { refused: true, mustInclude: ['BL-0001', 'BL-0002', 'ambiguous'] },
  ],
  [
    'is refused naming BL-0009 as unknown on origin/main and telling the author to lead with the open owner',
    { refused: true, mustInclude: ['BL-0009', 'no ticket file'] },
  ],
]);

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function runGuard(root, msgFile) {
  const r = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository whose origin\/main files BL-0001 under backlog\/done\/ and BL-0002 under backlog\/active\/$/,
    (ctx) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1617-fixture-'));
      git(root, 'init', '-q', '-b', 'work');
      git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
      for (const [id, folder] of [
        ['BL-0001', 'done'],
        ['BL-0002', 'active'],
      ]) {
        const dir = path.join(root, 'backlog', folder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\n`);
      }
      git(root, 'add', '-A');
      git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed BL-0001/BL-0002');
      ctx.root = root;
      ctx.msgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1617-msg-'));
    }
  );

  scoped(/^origin\/main cannot be resolved$/, (ctx) => {
    ctx.originUnresolved = true;
  });

  scoped(/^the repository is checked out on a role branch$/, () => {
    // Already on "work" (never "main") from the Background's own init.
    // origin/main is marked lazily, just before the commit is attempted -
    // "origin/main cannot be resolved" (when present) is a LATER step in
    // the same scenario and must still be able to suppress it.
  });

  scoped(/^the repository is checked out on main$/, (ctx) => {
    git(ctx.root, 'branch', '-m', 'main');
  });

  scoped(/^a commit is attempted with the subject "(.+)"$/, (ctx, subject) => {
    if (!ctx.originMarked && !ctx.originUnresolved) {
      git(ctx.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      ctx.originMarked = true;
    }
    const msgFile = path.join(ctx.msgDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(msgFile, `${subject}\n`);
    ctx.guardResult = runGuard(ctx.root, msgFile);
  });

  scoped(/^the commit (.+)$/, (ctx, outcomeToken) => {
    const kind = OUTCOME_KINDS.get(outcomeToken);
    if (kind) {
      if (kind.refused) {
        assert.notEqual(ctx.guardResult.status, 0, `expected refusal, got: ${JSON.stringify(ctx.guardResult)}`);
        const combined = ctx.guardResult.stdout + ctx.guardResult.stderr;
        for (const needle of kind.mustInclude) {
          assert.ok(combined.toLowerCase().includes(needle.toLowerCase()), `expected refusal to include "${needle}", got: ${combined}`);
        }
      } else {
        assert.equal(ctx.guardResult.status, 0, `expected commit, got: ${JSON.stringify(ctx.guardResult)}`);
      }
      return;
    }
    if (outcomeToken === 'is committed and the guard warns that it could not read origin/main') {
      assert.equal(ctx.guardResult.status, 0, `expected the commit to still succeed, got: ${JSON.stringify(ctx.guardResult)}`);
      const combined = ctx.guardResult.stdout + ctx.guardResult.stderr;
      assert.ok(/warning/i.test(combined), `expected a warning about the unreadable origin/main, got: ${combined}`);
      return;
    }
    throw new Error(`bl1617: unknown outcome token: ${outcomeToken}`);
  });
}

module.exports = { registerSteps };
