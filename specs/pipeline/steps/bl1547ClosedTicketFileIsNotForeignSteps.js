'use strict';

// BL-1547: step handlers for "A file named for a closed ticket is not
// foreign scope at send time". Drives the REAL task_scope_gate_lib.bb (via
// a `bb -e` call, the same JSON-result pattern BL-1257's own step handlers
// already establish for this exact lib) against a real git fixture -
// never a reimplementation of the scope walk or the closure read.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCOPE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');
const FEATURE = 'BL-1547 A file named for a closed ticket is not foreign scope at send time';

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const TASK_ID = 'BL-91050';
const FOREIGN_ID = 'BL-91051';

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, [...GIT_ID, 'commit', '-q', '-m', message]);
}

function commitFile(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  gitCommit(root, message);
}

function markOriginMainHere(root) {
  const sha = gitOut(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/main', sha]);
}

function runScopeLib(root, taskName, commit) {
  const script = `
(require '[cheshire.core :as json])
(load-file "${SCOPE_LIB}")
(def result (task-scope-gate-lib/findings-for-git-handoff {:root "${root}" :task-name "${taskName}" :commit "${commit}"}))
(def message (task-scope-gate-lib/refusal-message (assoc result :task-name "${taskName}")))
(println (json/generate-string (assoc result :refusal-message message)))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with an origin, a main branch, a role branch, a task ticket, and a foreign ticket whose how-to file exists on origin\/main$/,
    (ctx) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1547-'));
      git(root, ['init', '-q', '-b', 'main']);
      git(root, [...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'seed']);
      commitFile(root, `backlog/active/${TASK_ID}-fixture.yaml`, `id: ${TASK_ID}\nstatus: todo\n`, `${TASK_ID}-fixture: task ticket exists`);
      const howToPath = `docs/how-to/${FOREIGN_ID}-guide.md`;
      commitFile(root, howToPath, '# guide\n\noriginal text\n', `${FOREIGN_ID}-fixture: how-to exists`);
      markOriginMainHere(root);
      ctx.bl1547 = { root, howToPath, taskName: `${TASK_ID}-fixture` };
    },
  );

  // ── lane placement of the foreign ticket's own YAML ─────────────────
  scoped(/^the foreign ticket's YAML is filed under backlog\/(done|active)\/ on origin\/main$/, (ctx, lane) => {
    const { root } = ctx.bl1547;
    const yamlPath =
      lane === 'done'
        ? `backlog/done/M8/${FOREIGN_ID}-fixture.yaml`
        : `backlog/active/${FOREIGN_ID}-fixture.yaml`;
    const status = lane === 'done' ? 'done' : 'todo';
    commitFile(root, yamlPath, `id: ${FOREIGN_ID}\nstatus: ${status}\n`, `${FOREIGN_ID}-fixture: filed under backlog/${lane}/`);
    markOriginMainHere(root);
  });

  scoped(/^the foreign ticket's YAML is absent from every backlog folder on origin\/main$/, () => {
    // No-op: the Background never files the foreign ticket's own YAML
    // anywhere - only its how-to exists. Absence is the fixture as built.
  });

  // ── the task-tagged commit under test ───────────────────────────────
  scoped(/^a commit on the role branch leading with the task ticket's id that edits the foreign ticket's how-to$/, (ctx) => {
    const { root, howToPath, taskName } = ctx.bl1547;
    git(root, ['checkout', '-q', '-b', 'role-branch']);
    commitFile(root, howToPath, '# guide\n\nedited text\n', `${taskName}: edits ${FOREIGN_ID}'s how-to`);
    ctx.bl1547.commit = gitOut(root, ['rev-parse', 'HEAD']);
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the task-scope gate evaluates a git_handoff for the task ticket at that commit$/, (ctx) => {
    const { root, taskName, commit } = ctx.bl1547;
    ctx.bl1547.result = runScopeLib(root, taskName, commit);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  scoped(/^the gate accepts with no foreign-scope finding for that path$/, (ctx) => {
    const { result, howToPath } = ctx.bl1547;
    const paths = (result.findings || []).map((f) => f.path);
    assert.ok(!paths.includes(howToPath), `expected no finding for ${howToPath}, got: ${JSON.stringify(result)}`);
  });

  scoped(/^the gate refuses naming that path and the foreign ticket's id, exactly as before this ticket$/, (ctx) => {
    assertRefusesNamingPathAndForeignId(ctx.bl1547);
  });

  scoped(/^the gate refuses naming that path and the foreign ticket's id$/, (ctx) => {
    assertRefusesNamingPathAndForeignId(ctx.bl1547);
  });

  function assertRefusesNamingPathAndForeignId({ result, howToPath }) {
    const findings = result.findings || [];
    assert.ok(
      findings.some((f) => f.path === howToPath && f['ticket-id'] === FOREIGN_ID),
      `expected a finding for ${howToPath} naming ${FOREIGN_ID}, got: ${JSON.stringify(result)}`,
    );
    const message = result['refusal-message'] || '';
    assert.match(message, new RegExp(howToPath.replace(/[/.]/g, '\\$&')), message);
    assert.match(message, new RegExp(FOREIGN_ID), message);
  }
}

module.exports = { registerSteps };
