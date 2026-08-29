'use strict';

// BL-1245: step handlers for "a role reopens its own question slot when no
// answer ever reached the store". Drives the REAL role_ask.bb CLI against a
// real tmp fixture (same "drive the real CLI" posture as
// gh26RoleQuestionUndeliverableClearsMarkerSteps.js and
// bl607RoleClarifyingPollSteps.js's -05 scenario) - the resolve logic lives
// entirely in the bb script, not in the TypeScript core.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROLE_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');

const FEATURE_NAME =
  'A role reopens its own question slot when no answer ever reached the store';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE_NAME);
}

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1245-'));
}

function writeAwaitingMarker(root, role, contents) {
  const p = path.join(root, '.swarmforge', 'operator', 'role-awaiting', `${role}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(contents));
}

function runRoleAsk(root, args) {
  // execFileSync with an args array; we return {stdout, exitCode} so the
  // step handlers can assert on both. A non-zero exit code does NOT throw -
  // the feature exercises refusal paths.
  try {
    const stdout = execFileSync('bb', [ROLE_ASK_CLI, root, ...args], { encoding: 'utf8' });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', exitCode: err.status || 1 };
  }
}

function readArchive(root) {
  const dir = path.join(root, '.swarmforge', 'operator', 'role-awaiting-archive');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => ({
    name,
    content: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
  }));
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^a project root with a role-awaiting store$/, (ctx) => {
    ctx.root = mkTmpRoot();
    // Ensure the role-awaiting/ directory exists so writes into it work.
    fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'operator', 'role-awaiting'), { recursive: true });
  });

  // ── Givens ──────────────────────────────────────────────────────────
  scoped(registry, /^role "([^"]+)" has a pending question "([^"]+)"$/, (ctx, role, question) => {
    ctx.role = role;
    ctx.question = question;
    ctx.askedAtMs = 1700000000000;
    writeAwaitingMarker(ctx.root, role, { question, asked_at_ms: ctx.askedAtMs });
  });

  scoped(registry, /^role "([^"]+)" has no pending question$/, (ctx, role) => {
    ctx.role = role;
    // No marker written - intentionally empty.
  });

  // ── Whens ───────────────────────────────────────────────────────────
  scoped(registry, /^the role resolves its pending question with reason "([^"]*)"$/, (ctx, reason) => {
    ctx.resolveResult = runRoleAsk(ctx.root, ['--role', ctx.role, '--resolve', '--reason', reason]);
    ctx.resolveReason = reason;
  });

  scoped(registry, /^role "([^"]+)" asks "([^"]+)"$/, (ctx, role, question) => {
    ctx.askResult = runRoleAsk(ctx.root, ['--role', role, '--question', question]);
    ctx.newQuestion = question;
  });

  // ── Thens ───────────────────────────────────────────────────────────
  scoped(registry, /^the ask is accepted$/, (ctx) => {
    const parsed = JSON.parse(ctx.askResult.stdout);
    if (parsed.asked !== true) {
      throw new Error(`expected the ask to be accepted, got: ${ctx.askResult.stdout}`);
    }
  });

  scoped(registry, /^the ask is refused as already-pending$/, (ctx) => {
    const parsed = JSON.parse(ctx.askResult.stdout);
    if (parsed.asked !== false || parsed.reason !== 'already-pending') {
      throw new Error(`expected ask refused as already-pending, got: ${ctx.askResult.stdout}`);
    }
  });

  scoped(registry, /^the question "([^"]+)", its asked_at_ms, and the reason "([^"]+)" are all still readable$/, (ctx, question, reason) => {
    const archive = readArchive(ctx.root);
    if (archive.length === 0) {
      throw new Error('expected a preserved record in role-awaiting-archive/, found none');
    }
    const record = archive[0].content;
    if (record.question !== question) {
      throw new Error(`expected preserved question "${question}", got "${record.question}"`);
    }
    if (record.asked_at_ms !== ctx.askedAtMs) {
      throw new Error(`expected preserved asked_at_ms ${ctx.askedAtMs}, got ${record.asked_at_ms}`);
    }
    if (record.reason !== reason) {
      throw new Error(`expected preserved reason "${reason}", got "${record.reason}"`);
    }
  });

  scoped(registry, /^the resolve is refused$/, (ctx) => {
    const parsed = JSON.parse(ctx.resolveResult.stdout);
    if (parsed.resolved !== false) {
      throw new Error(`expected the resolve to be refused (resolved:false), got: ${ctx.resolveResult.stdout}`);
    }
    // The marker must still exist afterwards, preserving the pending state.
    const markerPath = path.join(ctx.root, '.swarmforge', 'operator', 'role-awaiting', `${ctx.role}.json`);
    if (!fs.existsSync(markerPath)) {
      throw new Error('expected the marker to remain after a refused resolve');
    }
  });

  scoped(registry, /^the resolve reports that nothing was pending$/, (ctx) => {
    const parsed = JSON.parse(ctx.resolveResult.stdout);
    if (parsed.resolved !== false || parsed.reason !== 'nothing-pending') {
      throw new Error(`expected resolved:false reason:nothing-pending, got: ${ctx.resolveResult.stdout}`);
    }
  });

  scoped(registry, /^the only pending question for role "([^"]+)" is "([^"]+)"$/, (ctx, role, question) => {
    const markerPath = path.join(ctx.root, '.swarmforge', 'operator', 'role-awaiting', `${role}.json`);
    if (!fs.existsSync(markerPath)) {
      throw new Error(`expected a pending marker at ${markerPath}, found none`);
    }
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (marker.question !== question) {
      throw new Error(`expected the only pending question to be "${question}", got "${marker.question}"`);
    }
    // And the archive still holds the original (the preserved evidence was
    // never destroyed by the new ask).
    const archive = readArchive(ctx.root);
    if (archive.length === 0) {
      throw new Error('expected the preserved record to survive the new ask');
    }
    if (archive[0].content.question !== ctx.question) {
      throw new Error(`expected the archive to still hold "${ctx.question}", got "${archive[0].content.question}"`);
    }
  });
}

module.exports = { registerSteps };
