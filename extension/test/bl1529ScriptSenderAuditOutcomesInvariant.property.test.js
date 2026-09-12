'use strict';

// BL-1529 declared invariant (coder-authored per BL-654 / coder.prompt):
// "A script-originated git_handoff send reports success only when a
// handoff file exists in the sender's outbox at return: the audit
// challenge, a refusal, and a queue are three distinguishable outcomes to
// every caller of swarm_handoff.sh."
//
// Every draw runs the REAL redo_from.bb CLI (via salvage_lib.bb's
// queue-handoff!, which is handoff-lib/queue-git-handoff!'s two-call
// protocol - the one definition every script-originated sender shares)
// against a REAL fixture git repo, then reads the outbox directory back
// off disk - never the CLI's own claimed exit code alone. Two outcome
// kinds are drawn:
//   'queued' - runs redo_from.bb against the real swarm_handoff.sh. A
//     fresh draft always meets the self-audit challenge once internally
//     (Article 2.3); the two-call protocol resubmits it and it queues.
//   'failed' - runs redo_from.bb against a COPIED scripts dir whose
//     swarm_handoff.sh is replaced with a stub that always answers
//     HANDOFF_NOT_QUEUED. Both of queue-git-handoff!'s calls meet the
//     challenge, so it collapses to a refusal rather than reporting
//     either a queue or a lingering challenge. The copy is required
//     because salvage_lib.bb resolves swarm_handoff.sh from its OWN
//     canonicalized directory, never from PATH, so a PATH-only stub is
//     invisible to it.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// GENERATOR REACH: both outcome kinds x a spread of pipeline stages - a
// floor asserted below, not hoped for.
//
// Non-vacuity (verified 2026-09-12, restored after): reverting
// handoff_lib.bb's queue-git-handoff! to a bare single sh! call (the
// pre-fix shape swarm_handoff.bb's own AUDIT_REQUIRED branch used to fall
// off with exit 0) turns every 'queued' draw RED - "expected exactly one
// queued handoff file, got 0" - because the first call's own audit
// challenge was mistaken for the final answer, exactly BL-1529's defect.
// Restored, ALL PASS.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGES = ['cleaner', 'architect', 'hardender', 'documenter', 'qa'];
const OUTCOME_KINDS = ['queued', 'failed'];

const STUB_SWARM_HANDOFF =
  '#!/usr/bin/env bash\necho "AUDIT_REQUIRED" >&2\necho "HANDOFF_NOT_QUEUED" >&2\nexit 1\n';

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function buildFixture() {
  const root = fs.realpathSync(mkTmpDir('bl1529-audit-outcomes-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(coderWt, { recursive: true });
  // Same six-stage shape as test_redo_from.sh's own fixture roles.tsv - a
  // missing stage entry fails every draw of that stage with "Unknown
  // recipient role", not the outcome this test exists to check.
  const rows = [
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner\t${coderWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
    `architect\tarchitect\t${coderWt}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `hardender\thardender\t${coderWt}\tswarmforge-hardender\tHardender\tclaude\tbatch`,
    `documenter\tdocumenter\t${coderWt}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `QA\tQA\t${root}\tswarmforge-QA\tQA\tclaude\ttask`,
  ].join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows}\n`);

  const scriptsCopy = path.join(root, 'scripts-copy');
  fs.cpSync(SCRIPTS, scriptsCopy, { recursive: true });
  fs.writeFileSync(path.join(scriptsCopy, 'swarm_handoff.sh'), STUB_SWARM_HANDOFF, { mode: 0o755 });

  return { root, scriptsCopy };
}

function outboxDir(root) {
  return path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function clearOutbox(root) {
  const dir = outboxDir(root);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

function outboxFiles(root) {
  const dir = outboxDir(root);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

let seq = 0;

function runRedoFrom(fixture, kind, stage) {
  seq += 1;
  const item = `BL-PROP${seq}`;
  const scriptsDir = kind === 'queued' ? SCRIPTS : fixture.scriptsCopy;
  const cli = path.join(scriptsDir, 'redo_from.bb');
  try {
    const out = execFileSync('bb', [cli, item, stage], {
      cwd: fixture.root,
      encoding: 'utf8',
      // Unset (never blank-but-set) so salvage_lib.bb's own coordinator
      // fallback applies - matches test_redo_from.sh's `unset SWARMFORGE_ROLE`.
      env: { ...process.env, SWARMFORGE_ROLE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, status: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, status: e.status ?? 1 };
  }
}

test(
  'BL-1529 invariant: a challenge, a refusal, and a queue are three distinguishable outcomes',
  () => {
    const fixture = buildFixture();
    const reached = { queued: 0, failed: 0 };
    try {
      fc.assert(
        fc.property(fc.constantFrom(...OUTCOME_KINDS), fc.constantFrom(...STAGES), (kind, stage) => {
          clearOutbox(fixture.root);
          assert.deepEqual(outboxFiles(fixture.root), [], 'outbox must start empty each draw');

          const { out, status } = runRedoFrom(fixture, kind, stage);
          const after = outboxFiles(fixture.root);
          reached[kind] += 1;

          if (kind === 'queued') {
            assert.equal(status, 0, `expected success for stage ${stage}, got exit ${status}:\n${out}`);
            assert.equal(after.length, 1, `expected exactly one queued handoff file for stage ${stage}:\n${out}`);
            const lastLine = out.trim().split('\n').filter(Boolean).pop();
            assert.ok(
              lastLine && lastLine.includes(after[0]),
              `command's last output line must name the queued outbox file; last line: "${lastLine}", file: ${after[0]}`
            );
          } else {
            assert.notEqual(status, 0, `expected a refusal for stage ${stage}, got exit 0:\n${out}`);
            assert.match(out, /Failed to queue handoff/, `refusal output must name the failure to queue:\n${out}`);
            assert.deepEqual(after, [], `a refused send must queue nothing, got:\n${out}`);
          }
        }),
        { numRuns: OUTCOME_KINDS.length * STAGES.length * 2 }
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }

    assert.ok(reached.queued >= STAGES.length, `generator reach floor (queued): ${reached.queued}`);
    assert.ok(reached.failed >= STAGES.length, `generator reach floor (failed): ${reached.failed}`);
  },
  60000
);
