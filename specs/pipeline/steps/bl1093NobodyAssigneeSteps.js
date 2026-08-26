'use strict';

// BL-1093: step handlers for nobody-assignee stranding. Drives both
// active-backlog sweeps via nobody_assignee_sweeps_harness.bb (mirrors
// handoffd.bb's same-tick dispatch-gap + unassigned-active wiring).
//
// "When the daemon runs its active-backlog sweeps" is unique to this
// feature — not shared with dispatchGapSteps.js's "the sweep runs".
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'nobody_assignee_sweeps_harness.bb');
const CHASE_LIB = path.join(SWARMFORGE_SCRIPTS, 'chase_sweep_lib.bb');
const COHERENCE_LIB = path.join(SWARMFORGE_SCRIPTS, 'task_commit_coherence_gate_lib.bb');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const HANDOFFD = path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb');

const TICKET = 'BL-1093';

function git(root, args) {
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1093-'));
    git(ctx.targetPath, ['init', '-q', '-b', 'main']);
    git(ctx.targetPath, ['commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function coderWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'coder');
}

function writeRolesTsv(ctx) {
  const root = ctx.targetPath;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(coderWorktree(ctx), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      ['coordinator', 'master', root, 'swarmforge-coordinator', 'C', 'claude', 'task'],
      ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ]
      .map((r) => r.join('\t'))
      .join('\n') + '\n'
  );
}

function writeActive(ctx, id, assignedTo) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  let body = `id: ${id}\ntitle: "demo"\nstatus: todo\n`;
  if (assignedTo === 'absent') {
    // no assigned_to key
  } else if (assignedTo === 'blank') {
    body += 'assigned_to: \n';
  } else if (assignedTo === 'the word none') {
    body += 'assigned_to: none\n';
  } else if (assignedTo === 'unassigned') {
    body += 'assigned_to: unassigned\n';
  } else if (assignedTo === 'names nobody') {
    body += 'assigned_to: none\n';
  } else {
    body += `assigned_to: ${assignedTo}\n`;
  }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), body);
}

function coordinatorOutbox(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function readOutbox(ctx) {
  const dir = coordinatorOutbox(ctx);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.handoff'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    return [];
  }
}

function runSweeps(ctx) {
  ctx.sweepOutput = execFileSync('bb', [HARNESS, ctx.targetPath], { encoding: 'utf8' });
}

function parseList(output, label) {
  const m = new RegExp(`${label}:\\s*(\\[.*?\\])\\s*$`, 'm').exec(output || '');
  if (!m) return [];
  return [...m[1].matchAll(/"(BL-[^"]+)"/g)].map((x) => x[1]);
}

function registerSteps(registry) {
  registry.define(/^an active ticket whose assigned_to is (absent|blank|the word none|unassigned)$/, (ctx, spelling) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActive(ctx, TICKET, spelling);
    ctx.nobodySpelling = spelling;
  });

  registry.define(/^that ticket has no dispatch trail$/, () => {
    // No-op: fixture starts with empty mailboxes.
  });

  registry.define(/^the daemon runs its active-backlog sweeps$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    runSweeps(ctx);
  });

  registry.define(/^the coordinator is nudged about the ticket$/, (ctx) => {
    const nudges = readOutbox(ctx).filter(
      (c) => /^to: coordinator$/m.test(c) && new RegExp(`message: ${TICKET} active unassigned`).test(c)
    );
    if (nudges.length === 0) {
      throw new Error(`expected coordinator unassigned nudge for ${TICKET}, got: ${ctx.sweepOutput}`);
    }
  });

  registry.define(/^no handoff is addressed to it by name$/, (ctx) => {
    const bad = readOutbox(ctx).filter((c) => /^to: (none|unassigned)$/m.test(c));
    if (bad.length > 0) {
      throw new Error(`expected no handoff to nobody spellings, got: ${bad.join('\n---\n')}`);
    }
    const gaps = parseList(ctx.sweepOutput, 'GAPS');
    if (gaps.includes(TICKET)) {
      throw new Error(`dispatch-gap must not claim ${TICKET}; GAPS=${gaps}`);
    }
  });

  registry.define(/^an active ticket assigned to the coder$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActive(ctx, TICKET, 'coder');
  });

  registry.define(/^the ticket is auto-routed to the coder$/, (ctx) => {
    const routed = readOutbox(ctx).filter(
      (c) => /^to: coder$/m.test(c) && (new RegExp(`task: ${TICKET}`).test(c) || new RegExp(`message: ${TICKET} `).test(c))
    );
    if (routed.length === 0) {
      throw new Error(`expected auto-route to coder for ${TICKET}, got: ${ctx.sweepOutput}`);
    }
  });

  registry.define(/^a set of active tickets covering every assigned_to spelling in use$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActive(ctx, 'BL-9001', 'absent');
    writeActive(ctx, 'BL-9002', 'blank');
    writeActive(ctx, 'BL-9003', 'the word none');
    writeActive(ctx, 'BL-9004', 'unassigned');
    writeActive(ctx, 'BL-9005', 'coder');
    writeActive(ctx, 'BL-9006', 'specifier');
    ctx.coverIds = ['BL-9001', 'BL-9002', 'BL-9003', 'BL-9004', 'BL-9005', 'BL-9006'];
  });

  registry.define(/^no ticket is claimed by both sweeps$/, (ctx) => {
    const gaps = new Set(parseList(ctx.sweepOutput, 'GAPS'));
    const unassigned = new Set(parseList(ctx.sweepOutput, 'UNASSIGNED'));
    for (const id of gaps) {
      if (unassigned.has(id)) {
        throw new Error(`ticket ${id} claimed by both sweeps`);
      }
    }
  });

  registry.define(/^no ticket is claimed by neither$/, (ctx) => {
    const gaps = new Set(parseList(ctx.sweepOutput, 'GAPS'));
    const unassigned = new Set(parseList(ctx.sweepOutput, 'UNASSIGNED'));
    for (const id of ctx.coverIds || []) {
      if (!gaps.has(id) && !unassigned.has(id)) {
        throw new Error(`ticket ${id} claimed by neither sweep; GAPS=${[...gaps]} UNASSIGNED=${[...unassigned]}`);
      }
    }
  });

  registry.define(/^an active ticket whose assigned_to names nobody$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActive(ctx, TICKET, 'names nobody');
  });

  registry.define(/^the daemon builds an auto-route draft for it$/, (ctx) => {
    ctx.draftLines = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${CHASE_LIB}")\n(println (pr-str (chase-sweep-lib/dispatch-gap-draft-lines {:id "${TICKET}" :assigned-to "none"} "aaaaaaaaaa")))`,
      ],
      { encoding: 'utf8' }
    ).trim();
  });

  registry.define(/^no draft naming that value as recipient is produced$/, (ctx) => {
    if (ctx.draftLines !== 'nil' && /"to: none"/.test(ctx.draftLines)) {
      throw new Error(`expected no draft to: none, got: ${ctx.draftLines}`);
    }
    if (ctx.draftLines !== 'nil' && ctx.draftLines !== '[]') {
      // nil is the belt-and-braces return; empty vector also acceptable
      if (!/^nil$|^\[\]$/.test(ctx.draftLines)) {
        throw new Error(`expected nil/empty draft for nobody assignee, got: ${ctx.draftLines}`);
      }
    }
  });

  registry.define(/^an auto-route that the handoff validator rejects$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    const draft = path.join(ctx.targetPath, 'bad-draft.txt');
    fs.writeFileSync(draft, 'type: note\nto: none\npriority: 00\nmessage: BL-1093 probe\n');
    let err = '';
    try {
      execFileSync('bb', [SWARM_HANDOFF, draft], {
        cwd: ctx.targetPath,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SWARMFORGE_ROLE: 'coordinator',
          SWARMFORGE_SKIP_SYNC_INJECT: '1',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      err = String(e.stderr || e.message || e);
    }
    if (!/Unknown recipient role 'none'/.test(err)) {
      throw new Error(`expected Unknown recipient refusal, got: ${err}`);
    }
    ctx.validatorStderr = err;
  });

  registry.define(/^the daemon logs the failure$/, (ctx) => {
    ctx.failureLogLine = execFileSync(
      'bb',
      [
        '-e',
        `(load-file "${COHERENCE_LIB}")\n(println (task-commit-coherence-gate-lib/operator-refusal-log-line ${JSON.stringify(ctx.validatorStderr)}))`,
      ],
      { encoding: 'utf8' }
    ).trim();
    const src = fs.readFileSync(HANDOFFD, 'utf8');
    if (!/dispatch-gap-autoroute-error[\s\S]*operator-refusal-log-line/.test(src)) {
      throw new Error('handoffd.bb auto-route! must log via operator-refusal-log-line');
    }
  });

  registry.define(/^the log line states the validator's reason$/, (ctx) => {
    if (!/Unknown recipient role 'none'/.test(ctx.failureLogLine || '')) {
      throw new Error(`expected log line to carry validator reason, got: ${ctx.failureLogLine}`);
    }
    if (!/^gate=/.test(ctx.failureLogLine || '')) {
      throw new Error(`expected gate= prefix, got: ${ctx.failureLogLine}`);
    }
  });
}

module.exports = { registerSteps };
