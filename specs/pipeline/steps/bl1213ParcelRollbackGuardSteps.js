'use strict';

// BL-1213: step handlers for "a forward is refused when the branch rolled
// back an accepted parcel's landed content". Drives the REAL swarm_handoff.bb
// (and its real parcel_rollback_guard_lib.bb call chain) against a real
// fixture git repo, same pattern as bl760DuplicateChainGuardSteps.js
// (BL-760) - a single shared git repo playing the role of "the branch" (git
// operations always target ctx.root), with each pipeline role given its OWN
// mailbox subdirectory (roleDir) so seeding one role's in_process parcel
// never collides with another role's mailbox - project-root resolution
// only needs .swarmforge/roles.tsv to exist at the enclosing repo root,
// which every subdirectory here already satisfies, and git-root always
// walks up to the one shared repo regardless of which subdirectory a
// role's own worktree row names.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const TASK_NAME = 'BL-1213-fixture';
const TICKET_ID = 'BL-1213';
const FEATURE_NAME = "BL-1213 a forward is refused when the branch rolled back an accepted parcel's landed content";

// BL-1213 hardening: this file's Given steps never removed ctx.root - every
// acceptance run leaked a real fixture git repo into /tmp (confirmed: 180+
// stragglers accumulated before this fix). mkSocketFixtureRoot's own
// process.on('exit') backstop (BL-948) covers the throw-before-cleanup case
// with no further code here - no socket is built by this fixture, but the
// helper is this repo's general fixture-root convention, not socket-only
// (see its own docstring).
function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function roleDir(ctx, role) {
  return role === 'coordinator' ? ctx.root : path.join(ctx.root, role);
}

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder-wt\t${roleDir(ctx, 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner-wt\t${roleDir(ctx, 'cleaner')}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
    `architect\tarchitect-wt\t${roleDir(ctx, 'architect')}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `hardender\thardender-wt\t${roleDir(ctx, 'hardender')}\tswarmforge-hardender\tHardener\tclaude\tbatch`,
    `documenter\tdocumenter-wt\t${roleDir(ctx, 'documenter')}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `QA\tQA-wt\t${roleDir(ctx, 'QA')}\tswarmforge-QA\tQa\tclaude\ttask`,
    `coordinator\tmaster\t${roleDir(ctx, 'coordinator')}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    fs.mkdirSync(roleDir(ctx, role), { recursive: true });
  }
}

function writeFile(ctx, name, content) {
  fs.writeFileSync(path.join(ctx.root, name), content);
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function seedReceivedParcel(ctx, role, commitShort) {
  const dir = path.join(roleDir(ctx, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const content = `id: x\nfrom: coder\nto: ${role}\npriority: 50\ntype: git_handoff\nrole: coder\ntask: ${TASK_NAME}\ncommit: ${commitShort}\ncreated_at: 2026-08-28T00:00:00Z\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function runSwarmHandoff(ctx, draftContent, role) {
  const cwd = roleDir(ctx, role);
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function applyTipState(ctx) {
  if (ctx.desiredTip === 'parcel') {
    // The parcel commit itself already left this content - nothing further.
    return;
  }
  if (ctx.desiredTip === 'pre-parcel') {
    if (ctx.revertPresent) {
      git(ctx.root, ['-c', 'user.email=bl1213@example.com', '-c', 'user.name=bl1213', 'revert', '--no-edit', ctx.parcelFullSha]);
    } else {
      writeFile(ctx, ctx.pathName, ctx.preParcelContent);
      commit(ctx, 'recovery: restore tree (bulk restore, not a revert)');
    }
    return;
  }
  if (ctx.desiredTip === 'later-content') {
    writeFile(ctx, ctx.pathName, 'genuinely different later content\n');
    commit(ctx, 'later work: different content for the same path');
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^an active ticket whose accepted parcel commit changed a path on this branch$/, (ctx) => {
    ctx.root = mkTmp('bl1213-parcel-rollback-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    git(ctx.root, ['config', 'user.email', 'bl1213@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1213']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx);
    ctx.pathName = 'file.txt';
    ctx.preParcelContent = 'pre-parcel content\n';
    writeFile(ctx, ctx.pathName, ctx.preParcelContent);
    commit(ctx, 'seed file');
    writeFile(ctx, ctx.pathName, 'parcel content\n');
    commit(ctx, `${TICKET_ID}: parcel change`);
    ctx.parcelFullSha = gitOut(ctx.root, ['rev-parse', 'HEAD']);
    ctx.parcelShortSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  });

  scoped(/^a role holding that branch, ready to hand off$/, (ctx) => {
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, ctx.parcelShortSha);
  });

  // ── Scenario Outline 01 ───────────────────────────────────────────────

  scoped(/^the branch tip holds (pre-parcel|parcel|later-content) for that path$/, (ctx, tipContent) => {
    ctx.desiredTip = tipContent;
  });

  scoped(/^a revert of the parcel commit on this branch is (present|absent)$/, (ctx, revertState) => {
    ctx.revertPresent = revertState === 'present';
    applyTipState(ctx);
  });

  // ── Scenarios 03/05: the literal (non-Outline) "pre-parcel content" phrasing ─

  scoped(/^the branch tip holds pre-parcel content for that path$/, (ctx) => {
    ctx.desiredTip = 'pre-parcel';
    ctx.revertPresent = false;
    applyTipState(ctx);
  });

  // ── Scenario 02: three of the parcel's paths rolled back ────────────────

  scoped(/^the branch tip holds pre-parcel content for three of the paths that parcel commit changed$/, (ctx) => {
    // Rebuild the fixture with a parcel commit touching three paths - the
    // single-path Background fixture above cannot express this shape.
    ctx.root = mkTmp('bl1213-parcel-rollback-3paths-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    git(ctx.root, ['config', 'user.email', 'bl1213@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1213']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx);
    const paths = ['a.txt', 'b.txt', 'c.txt'];
    for (const p of paths) writeFile(ctx, p, `pre-${p}\n`);
    commit(ctx, 'seed three files');
    for (const p of paths) writeFile(ctx, p, `parcel-${p}\n`);
    commit(ctx, `${TICKET_ID}: parcel touches three paths`);
    ctx.parcelShortSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, ctx.parcelShortSha);
    for (const p of paths) writeFile(ctx, p, `pre-${p}\n`);
    commit(ctx, 'recovery: restore tree');
    ctx.rolledBackPaths = paths;
  });

  // ── Scenario 03: a bulk restore is the newest authoring commit ─────────

  scoped(/^a bulk restore commit on this branch is the newest commit authoring that path$/, () => {
    // Structural fact, not a separate action: the Background + the
    // pre-parcel/revert-absent path below always leaves the bulk-restore
    // commit as the newest (and only post-parcel) commit touching the
    // path - nothing further to arrange here.
  });

  // ── Scenario 04: the recorded parcel commit cannot be read ──────────────

  scoped(/^the parcel commit recorded for the ticket cannot be read$/, (ctx) => {
    ctx.senderRole = 'cleaner';
    seedReceivedParcel(ctx, ctx.senderRole, 'deadbeef00');
  });

  // ── When ─────────────────────────────────────────────────────────────

  scoped(/^the role sends the git_handoff$/, (ctx) => {
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draft = `type: git_handoff\nto: architect\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  scoped(/^the role sends a note instead of a git_handoff$/, (ctx) => {
    const draft = `type: note\nto: architect\npriority: 00\nmessage: checking in on ${TICKET_ID}\n`;
    ctx.result = runSwarmHandoff(ctx, draft, ctx.senderRole);
  });

  // ── Then ─────────────────────────────────────────────────────────────

  scoped(/^the send is (refused|allowed)$/, (ctx, outcome) => {
    // The refusal-message's own distinctive phrase is this gate's unique
    // marker - never a bare "BL-1213" substring match, which would also
    // false-positive on the fixture's own task name (BL-1213-fixture)
    // appearing in an UNRELATED gate's refusal text.
    const out = combinedOutput(ctx.result);
    const thisGateRefused = /no revert of that commit explains the rollback/.test(out);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2) {
        throw new Error(`expected the send to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/HANDOFF INVALID/.test(out)) {
        throw new Error(`expected a HANDOFF INVALID report, got: ${out}`);
      }
      if (!thisGateRefused) {
        throw new Error(`expected BL-1213's own gate to have refused, got: ${out}`);
      }
    } else {
      if (thisGateRefused) {
        throw new Error(`expected the send to be allowed, but BL-1213's gate refused it: ${out}`);
      }
    }
  });

  scoped(/^the refusal names all three paths$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    for (const p of ctx.rolledBackPaths) {
      if (!out.includes(p)) {
        throw new Error(`expected the refusal to name ${p}, got: ${out}`);
      }
    }
  });

  scoped(/^the refusal names the parcel commit whose content they rolled back$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(ctx.parcelShortSha)) {
      throw new Error(`expected the refusal to name the parcel commit ${ctx.parcelShortSha}, got: ${out}`);
    }
  });

  scoped(/^a warning names the ticket whose parcel commit could not be read$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/PARCEL_ROLLBACK WARNING/.test(out) || !out.includes(TICKET_ID)) {
      throw new Error(`expected a PARCEL_ROLLBACK warning naming ${TICKET_ID}, got: ${out}`);
    }
  });

  scoped(/^the gate records no finding$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (/BL-1213/.test(out)) {
      throw new Error(`expected no BL-1213 finding for a note send, got: ${out}`);
    }
  });
}

module.exports = { registerSteps };
