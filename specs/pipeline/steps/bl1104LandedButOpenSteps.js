'use strict';

// BL-1104: step handlers for the landed-but-open feature. Drives the real
// chase_sweep_lib.bb + swarm_handoff.bb through
// landed_but_open_sweep_harness.bb (thin mirror of handoffd.bb's
// landed-but-open-sweep!) — never a live daemon or tmux session.
//
// "the sweep runs" is shared with dispatchGapSteps.js (registry first-match).
// This file hooks via ctx.landedButOpenSweepRunner, same extension point
// pattern as ctx.droppedParcelSweepRunner (BL-719).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const LANDED_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'landed_but_open_sweep_harness.bb');
const CHASE_LIB = path.join(SWARMFORGE_SCRIPTS, 'chase_sweep_lib.bb');

// Outline 03 Examples must stay load-bearing (BL-113 survivors otherwise treat
// ticket ids as interchangeable labels within a self-consistent row).
const EXPECTED_SIBLING_ROWS = {
  'BL-2003|no dispatch trail|dispatch-gap': true,
  'BL-2004|no assignee|unassigned-active': true,
};

function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-landed-but-open-'));
    git(ctx.targetPath, ['init', '-q', '-b', 'main']);
    git(ctx.targetPath, ['commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function coderWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'coder');
}

function qaWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'QA');
}

function writeRolesTsv(ctx) {
  const targetPath = ctx.targetPath;
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.mkdirSync(coderWorktree(ctx), { recursive: true });
  fs.mkdirSync(qaWorktree(ctx), { recursive: true });
  const rows = [
    ['coordinator', 'master', targetPath, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['QA', 'QA', qaWorktree(ctx), 'swarmforge-QA', 'QA', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveYaml(ctx, ticketId, assignedTo) {
  const activeDir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  const assigned =
    assignedTo === undefined || assignedTo === null
      ? ''
      : `assigned_to: ${assignedTo}\n`;
  fs.writeFileSync(
    path.join(activeDir, `${ticketId}.yaml`),
    `id: ${ticketId}\ntitle: "demo"\nstatus: todo\n${assigned}`
  );
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, basename), lines.join('\n') + '\n\nbody\n');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function coderSentDir(ctx) {
  return path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'sent');
}

function readCoordinatorOutbox(ctx) {
  const dir = coordinatorOutboxDir(ctx);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

function listLandedNudges(ctx, ticketId) {
  return readCoordinatorOutbox(ctx).filter(
    (c) =>
      /^to: QA$/m.test(c) &&
      new RegExp(`^message: ${ticketId} landed-but-open `, 'm').test(c)
  );
}

function parseFlagged(output) {
  const m = /FLAGGED:\s*(\[.*\])\s*$/m.exec(output || '');
  if (!m) return [];
  try {
    // bb pr-str of vectors of [id sha] → edn-ish; recover via regex instead
    return [...output.matchAll(/\"(BL-\d+)\"\s+\"([0-9a-f]+)\"/g)].map((x) => ({
      id: x[1],
      sha: x[2],
    }));
  } catch {
    return [];
  }
}

function runLandedSweep(ctx) {
  ctx.landedButOpenSweepOutput = execFileSync('bb', [LANDED_HARNESS, ctx.targetPath], {
    encoding: 'utf8',
  });
  ctx.landedFlagged = parseFlagged(ctx.landedButOpenSweepOutput);
}

function bbLib(expr) {
  return execFileSync('bb', ['-e', `(load-file "${CHASE_LIB}")\n${expr}`], {
    encoding: 'utf8',
  }).trim();
}

function siblingOwns(ctx, owner, ticketId) {
  const active = path.join(ctx.targetPath, 'backlog', 'active');
  const scanDirs = [
    path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'in_process'),
    path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'sent'),
    path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'outbox'),
    path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox'),
    path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new'),
    path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'in_process'),
  ];
  for (const d of scanDirs) fs.mkdirSync(d, { recursive: true });
  const dirsEdn = scanDirs.map((d) => `"${d}"`).join(' ');
  if (owner === 'dispatch-gap') {
    const out = bbLib(
      `(println (pr-str (mapv :id (chase-sweep-lib/dispatch-gap-items "${active}" [${dirsEdn}]))))`
    );
    return out.includes(ticketId);
  }
  if (owner === 'unassigned-active') {
    const out = bbLib(
      `(println (pr-str (mapv :id (chase-sweep-lib/unassigned-active-items "${active}" [${dirsEdn}]))))`
    );
    return out.includes(ticketId);
  }
  throw new Error(`unknown owner sweep: ${owner}`);
}

function registerSteps(registry) {
  registry.define(/^the landed-but-open sweep runs over the active backlog and the main ref$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    // required_wiring: call site must contain the literal landed-but-open
    const src = fs.readFileSync(path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb'), 'utf8');
    const cadenceBlock = src.split('chase-sweep-every-cycles))')[1] || '';
    if (!/landed-but-open/.test(cadenceBlock)) {
      throw new Error(
        'expected landed-but-open to be CALLED from handoffd.bb chase cadence (required_wiring)'
      );
    }
    ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
  });

  registry.define(/^the sweep runs again$/, (ctx) => {
    if (!ctx.landedButOpenSweepRunner) {
      throw new Error('landed-but-open runner not installed before "the sweep runs again"');
    }
    ctx.landedButOpenSweepRunner();
  });

  registry.define(
    /^active ticket "([^"]+)" whose QA approval is reachable from the main ref$/,
    (ctx, ticketId) => {
      ensureTargetPath(ctx);
      writeRolesTsv(ctx);
      writeActiveYaml(ctx, ticketId, 'coder');
      // Complete trail so dispatch-gap does not also claim this ticket.
      writeHandoff(coderSentDir(ctx), `00_${ticketId}_trail.handoff`, {
        from: 'coder',
        to: 'cleaner',
        type: 'git_handoff',
        task: `${ticketId}-demo`,
        commit: '0000000000',
      });
      git(ctx.targetPath, [
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        `Merge origin/main into QA-approved ${ticketId} (aaaaaaaaaa) for landing`,
      ]);
      ctx.lastApprovalSha = git(ctx.targetPath, ['rev-parse', '--short=10', 'HEAD']);
      ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
    }
  );

  registry.define(/^no close commit for "([^"]+)" on the main ref$/, () => {
    // No-op: fixture starts without a Close subject for the ticket.
  });

  registry.define(
    /^active ticket "([^"]+)" whose parcel has reached QA$/,
    (ctx, ticketId) => {
      ensureTargetPath(ctx);
      writeRolesTsv(ctx);
      writeActiveYaml(ctx, ticketId, 'coder');
      writeHandoff(coderSentDir(ctx), `00_${ticketId}_trail.handoff`, {
        from: 'documenter',
        to: 'QA',
        type: 'git_handoff',
        task: `${ticketId}-demo`,
        commit: '1111111111',
      });
      ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
    }
  );

  registry.define(/^no QA approval for "([^"]+)" is reachable from the main ref$/, () => {
    // No-op: no QA-approved / QA pass inventory subject committed.
  });

  registry.define(
    /^active ticket "([^"]+)" with (no dispatch trail|no assignee) and no QA approval on the main ref$/,
    (ctx, ticketId, condition) => {
      ensureTargetPath(ctx);
      writeRolesTsv(ctx);
      if (condition === 'no assignee') {
        writeActiveYaml(ctx, ticketId, null);
      } else {
        writeActiveYaml(ctx, ticketId, 'coder');
        // no trail files
      }
      ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
      ctx.siblingOwnerTicket = ticketId;
      ctx.siblingOwnerCondition = condition;
    }
  );

  registry.define(
    /^active ticket "([^"]+)" with no QA approval of its own$/,
    (ctx, ticketId) => {
      ensureTargetPath(ctx);
      writeRolesTsv(ctx);
      writeActiveYaml(ctx, ticketId, 'coder');
      writeHandoff(coderSentDir(ctx), `00_${ticketId}_trail.handoff`, {
        from: 'coder',
        to: 'cleaner',
        type: 'git_handoff',
        task: `${ticketId}-demo`,
        commit: '0000000000',
      });
      ctx.bodyOnlyTicket = ticketId;
      ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
    }
  );

  registry.define(
    /^a commit on the main ref whose subject names "([^"]+)" and whose body mentions "([^"]+)"$/,
    (ctx, subjectTicket, bodyTicket) => {
      ensureTargetPath(ctx);
      const msg = `Merge origin/main into QA-approved ${subjectTicket} (bbbbbbbbbb) for landing

Mentions ${bodyTicket} only in the body — must not flag that id.`;
      git(ctx.targetPath, ['commit', '-q', '--allow-empty', '-m', msg]);
    }
  );

  registry.define(/^active ticket "([^"]+)" flagged as landed-but-open$/, (ctx, ticketId) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActiveYaml(ctx, ticketId, 'coder');
    writeHandoff(coderSentDir(ctx), `00_${ticketId}_trail.handoff`, {
      from: 'coder',
      to: 'cleaner',
      type: 'git_handoff',
      task: `${ticketId}-demo`,
      commit: '0000000000',
    });
    git(ctx.targetPath, [
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `Merge origin/main into QA-approved ${ticketId} (cccccccccc) for landing`,
    ]);
    ctx.lastApprovalSha = git(ctx.targetPath, ['rev-parse', '--short=10', 'HEAD']);
    ctx.idempotenceTicket = ticketId;
    ctx.landedButOpenSweepRunner = () => runLandedSweep(ctx);
    // First pass so the ticket is actually flagged before the "already on record" Given.
    runLandedSweep(ctx);
  });

  registry.define(/^a QA re-notify nudge for "([^"]+)" is already on record$/, (ctx, ticketId) => {
    const existing = listLandedNudges(ctx, ticketId);
    if (existing.length === 0) {
      // Seed one if the prior Given did not send (defensive).
      writeHandoff(coordinatorOutboxDir(ctx), `00_${ticketId}_nudge.handoff`, {
        from: 'coordinator',
        to: 'QA',
        type: 'note',
        message: `${ticketId} landed-but-open deadbeef01 - resend coordinator notify`,
      });
    }
  });

  registry.define(/^"([^"]+)" is flagged as landed-but-open$/, (ctx, ticketId) => {
    const flagged = (ctx.landedFlagged || []).some((f) => f.id === ticketId);
    if (!flagged) {
      throw new Error(
        `expected ${ticketId} flagged, got output: ${ctx.landedButOpenSweepOutput}`
      );
    }
  });

  registry.define(/^"([^"]+)" is not flagged$/, (ctx, ticketId) => {
    const flagged = (ctx.landedFlagged || []).some((f) => f.id === ticketId);
    if (flagged) {
      throw new Error(
        `expected ${ticketId} NOT flagged, got output: ${ctx.landedButOpenSweepOutput}`
      );
    }
  });

  registry.define(/^QA is nudged to resend the coordinator notify for "([^"]+)"$/, (ctx, ticketId) => {
    const nudges = listLandedNudges(ctx, ticketId);
    if (nudges.length === 0) {
      throw new Error(
        `expected a QA landed-but-open nudge for ${ticketId}, got: ${ctx.landedButOpenSweepOutput}`
      );
    }
  });

  registry.define(/^the nudge names the approval commit that flagged it$/, (ctx) => {
    const ticketId = (ctx.landedFlagged && ctx.landedFlagged[0] && ctx.landedFlagged[0].id) || null;
    if (!ticketId) throw new Error('no flagged ticket to check approval commit naming');
    const sha = ctx.lastApprovalSha;
    const nudges = listLandedNudges(ctx, ticketId);
    if (!nudges.some((c) => c.includes(sha))) {
      throw new Error(
        `expected nudge to name approval commit ${sha}, got: ${nudges.join('\n---\n')}`
      );
    }
  });

  registry.define(/^the "([^"]+)" sweep still returns "([^"]+)"$/, (ctx, owner, ticketId) => {
    const key = `${ticketId}|${ctx.siblingOwnerCondition}|${owner}`;
    if (!EXPECTED_SIBLING_ROWS[key]) {
      throw new Error(`Examples row must match locked table (got ${key})`);
    }
    if (ctx.siblingOwnerTicket && ctx.siblingOwnerTicket !== ticketId) {
      throw new Error(
        `ticket drift across steps: Given ${ctx.siblingOwnerTicket} Then ${ticketId}`
      );
    }
    if (!siblingOwns(ctx, owner, ticketId)) {
      throw new Error(`expected ${owner} to still return ${ticketId}`);
    }
  });

  registry.define(/^no second nudge for "([^"]+)" is sent$/, (ctx, ticketId) => {
    const nudges = listLandedNudges(ctx, ticketId);
    if (nudges.length !== 1) {
      throw new Error(
        `expected exactly one outstanding nudge for ${ticketId}, got ${nudges.length}: ${nudges.join('\n---\n')}`
      );
    }
  });

  registry.define(/^"([^"]+)" is still in the active backlog$/, (ctx, ticketId) => {
    const p = path.join(ctx.targetPath, 'backlog', 'active', `${ticketId}.yaml`);
    if (!fs.existsSync(p)) {
      throw new Error(`expected ${p} to remain in backlog/active/`);
    }
  });

  registry.define(/^no backlog file has been moved or closed by the sweep$/, (ctx) => {
    const doneDir = path.join(ctx.targetPath, 'backlog', 'done');
    if (fs.existsSync(doneDir)) {
      const moved = fs.readdirSync(doneDir);
      if (moved.length > 0) {
        throw new Error(`sweep must not move backlog files; found in done/: ${moved.join(', ')}`);
      }
    }
    const pausedDir = path.join(ctx.targetPath, 'backlog', 'paused');
    if (fs.existsSync(pausedDir)) {
      const moved = fs.readdirSync(pausedDir);
      if (moved.length > 0) {
        throw new Error(`sweep must not move backlog files; found in paused/: ${moved.join(', ')}`);
      }
    }
  });
}

module.exports = { registerSteps };
