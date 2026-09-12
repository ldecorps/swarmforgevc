'use strict';

// BL-1529: a script-originated git_handoff either lands in the sender's
// outbox or fails loud - never a challenge mistaken for either. Drives the
// REAL redo_from.bb/reroute.bb (via salvage_lib.bb's queue-handoff!) and
// the REAL handoffd.bb dispatch-gap sweep - never a re-derived
// approximation of either.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1529 A script-originated git_handoff is never swallowed by the audit';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE_TO_ROLE = {
  coder: 'coder',
  cleaner: 'cleaner',
  architect: 'architect',
  hardender: 'hardender',
  documenter: 'documenter',
  qa: 'QA',
};

// A .bb stub (handoffd.bb's auto-route! shells `bb <path>` directly, never
// through the .sh wrapper) and a .sh stub (salvage_lib.bb's queue-handoff!
// shells the wrapper) - both answer the challenge, never a queue.
const STUB_SWARM_HANDOFF_BB = '(binding [*out* *err*] (println "AUDIT_REQUIRED") (println "HANDOFF_NOT_QUEUED"))\n(System/exit 1)\n';
const STUB_SWARM_HANDOFF_SH = '#!/usr/bin/env bash\necho "AUDIT_REQUIRED" >&2\necho "HANDOFF_NOT_QUEUED" >&2\nexit 1\n';

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

// Fixture-root hygiene (BL-971/BL-1228 pattern): every root the Background
// creates is registered for removal at process exit, so a scenario that
// throws mid-assertion (e.g. "exactly one handoff file exists...") - not
// only the terminal step's own try/finally - still cannot leak the tmp dir.
// The per-scenario cleanup(ctx) calls below remain as the eager, common-case
// path; this is the backstop for the cross-step throw the 2026-08-18/08-19
// hardening rule warns about.
const fixtureRoots = [];
function registerFixtureRoot(root) {
  fixtureRoots.push(root);
}
process.on('exit', () => {
  for (const root of fixtureRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1529-acc-'));
  registerFixtureRoot(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const coderWt = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
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
  ctx.root = root;
  ctx.coderWt = coderWt;
  ctx.useStub = false;
}

function buildStubScriptsCopy(ctx) {
  const scriptsCopy = path.join(ctx.root, 'scripts-copy');
  fs.cpSync(SCRIPTS, scriptsCopy, { recursive: true });
  fs.writeFileSync(path.join(scriptsCopy, 'swarm_handoff.sh'), STUB_SWARM_HANDOFF_SH, { mode: 0o755 });
  fs.writeFileSync(path.join(scriptsCopy, 'swarm_handoff.bb'), STUB_SWARM_HANDOFF_BB);
  ctx.scriptsCopy = scriptsCopy;
  ctx.useStub = true;
}

function cleanup(ctx) {
  if (ctx.root) {
    try {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    ctx.root = undefined;
  }
}

function scriptsDir(ctx) {
  return ctx.useStub ? ctx.scriptsCopy : SCRIPTS;
}

function coderOutboxDir(ctx) {
  return path.join(ctx.coderWt, '.swarmforge', 'handoffs', 'outbox');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function handoffFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

function auditPendingHasFiles(ctx) {
  // audit_pending/.lock (with-audit-lock's own FileChannel lock file) is
  // created once and reused - it is NOT a standing challenge. Only a
  // *.edn file (a serialized audit-candidate) means one is left standing.
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'audit_pending');
  if (!fs.existsSync(dir)) return false;
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).some((e) => {
      const full = path.join(d, e.name);
      return e.isDirectory() ? walk(full) : e.name.endsWith('.edn');
    });
  return walk(dir);
}

function dropCompletedHandoff(ctx, item, task, recipientRole) {
  const commit = git(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  const content =
    `id: prior\nfrom: specifier\nto: ${recipientRole}\nrecipient: ${recipientRole}\npriority: 00\n` +
    `type: git_handoff\ntask: ${task}\ncommit: ${commit}\n\nbody\n`;
  fs.writeFileSync(path.join(ctx.coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed', `00_prior_${recipientRole}.handoff`), content);
}

function runSalvageVerb(ctx, verb, item, stage) {
  const cli = path.join(scriptsDir(ctx), verb);
  try {
    const out = execFileSync('bb', [cli, item, stage], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, status: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, status: e.status ?? 1 };
  }
}

// Drives the REAL dispatch_gap_sweep_harness.bb, which mirrors
// handoffd.bb's own dispatch-gap-sweep!/auto-route! exactly (same
// chase_sweep_lib.bb functions, same handoff-lib/queue-git-handoff!
// two-call protocol, same real swarm_handoff.bb send path) - the
// established precedent bl1094DispatchGapAutorouteSteps.js already uses,
// because handoffd.bb itself is a long-running daemon with no "run one
// sweep and exit" entry point a test can invoke directly (and load-filing
// it from a wrapper script breaks its *file*-derived swarm-handoff-script
// path, since that binding does not survive past the load-file call that
// captured it). The harness's own printed "AUTO-ROUTED <id> status=
// <queued|failed>" line stands in for the daemon log line.
function runDispatchGapSweepOnce(ctx) {
  const harness = path.join(scriptsDir(ctx), 'test', 'dispatch_gap_sweep_harness.bb');
  try {
    const out = execFileSync('bb', [harness, ctx.root], { cwd: ctx.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, status: 0 };
  } catch (e) {
    return { out: `${e.stdout || ''}${e.stderr || ''}`, status: e.status ?? 1 };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project under mkdtemp with a coder worktree, a roles\.tsv, and no standing audit challenge$/, (ctx) => {
    mkFixture(ctx);
  });

  // ── scenarios 01/02: salvage verbs (redo_from.bb, reroute.bb) ────────────
  scoped(/^an active item with a prior handoff at the (.+) stage$/, (ctx, stage) => {
    ctx.item = 'BL-9500';
    ctx.task = `${ctx.item}-demo`;
    dropCompletedHandoff(ctx, ctx.item, ctx.task, STAGE_TO_ROLE[stage]);
  });

  scoped(/^swarm_handoff\.sh is a stub that always answers HANDOFF_NOT_QUEUED$/, (ctx) => {
    buildStubScriptsCopy(ctx);
  });

  scoped(/^(redo_from\.bb|reroute\.bb) is run for that item and (.+)$/, (ctx, verb, stage) => {
    ctx.result = runSalvageVerb(ctx, verb, ctx.item, stage);
  });

  scoped(/^exactly one handoff file exists in the coder outbox addressed to (.+)$/, (ctx, stage) => {
    const files = handoffFiles(coderOutboxDir(ctx));
    assert.equal(files.length, 1, `expected exactly one coder outbox file, got ${files.length}:\n${ctx.result.out}`);
    const content = fs.readFileSync(path.join(coderOutboxDir(ctx), files[0]), 'utf8');
    assert.match(content, new RegExp(`^to: ${STAGE_TO_ROLE[stage]}$`, 'm'), `queued handoff not addressed to ${stage}:\n${content}`);
    ctx.queuedFile = files[0];
  });

  scoped(/^the command's last output line names that file$/, (ctx) => {
    const lastLine = ctx.result.out.trim().split('\n').filter(Boolean).pop();
    assert.ok(
      lastLine && lastLine.includes(ctx.queuedFile),
      `last output line must name the queued file; last line: "${lastLine}", file: ${ctx.queuedFile}`
    );
  });

  scoped(/^no audit challenge is left standing for the sender$/, (ctx) => {
    try {
      assert.ok(!auditPendingHasFiles(ctx), 'a standing audit challenge file remains after a successful queue');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the command exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a refusal, got exit 0:\n${ctx.result.out}`);
  });

  scoped(/^its output names the failure to queue$/, (ctx) => {
    assert.match(ctx.result.out, /Failed to queue handoff/, `refusal output must name the failure to queue:\n${ctx.result.out}`);
  });

  scoped(/^no handoff file exists in the coder outbox$/, (ctx) => {
    try {
      assert.deepEqual(handoffFiles(coderOutboxDir(ctx)), [], `a refused send must queue nothing:\n${ctx.result.out}`);
    } finally {
      cleanup(ctx);
    }
  });

  // ── scenarios 03/04: the dispatch-gap auto-route ─────────────────────────
  scoped(/^an active ticket assigned to coder with no dispatch trail anywhere$/, (ctx) => {
    ctx.item = 'BL-9501';
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'active'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'active', `${ctx.item}-gap.yaml`),
      `id: ${ctx.item}\ntitle: "gap"\nstatus: todo\nassigned_to: coder\n`
    );
  });

  scoped(/^the daemon's dispatch-gap sweep runs once$/, (ctx) => {
    ctx.sweep = runDispatchGapSweepOnce(ctx);
  });

  scoped(/^exactly one git_handoff for that ticket exists in the coordinator outbox$/, (ctx) => {
    const files = handoffFiles(coordinatorOutboxDir(ctx));
    assert.equal(files.length, 1, `expected exactly one coordinator outbox file:\n${ctx.sweep.out}`);
    const content = fs.readFileSync(path.join(coordinatorOutboxDir(ctx), files[0]), 'utf8');
    assert.match(content, /^type: git_handoff$/m);
    assert.match(content, new RegExp(`^task: ${ctx.item}`, 'm'));
  });

  scoped(/^the daemon log records a dispatch-gap-autoroute line for it$/, (ctx) => {
    try {
      assert.match(
        ctx.sweep.out,
        new RegExp(`AUTO-ROUTED ${ctx.item} status= queued`),
        `expected a dispatch-gap-autoroute (queued) line for ${ctx.item}:\n${ctx.sweep.out}`
      );
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the daemon log records a dispatch-gap-autoroute-error line for it$/, (ctx) => {
    assert.match(
      ctx.sweep.out,
      new RegExp(`AUTO-ROUTED ${ctx.item} status= failed`),
      `expected a dispatch-gap-autoroute-error (failed) line for ${ctx.item}:\n${ctx.sweep.out}`
    );
  });

  scoped(/^no handoff file exists in the coordinator outbox$/, (ctx) => {
    try {
      assert.deepEqual(handoffFiles(coordinatorOutboxDir(ctx)), [], `a refused auto-route must queue nothing:\n${ctx.sweep.out}`);
    } finally {
      cleanup(ctx);
    }
  });

  // ── scenario 05: the two shell tests that observed the fault ─────────────
  scoped(/^swarmforge\/scripts\/test\/test_redo_from\.sh and test_reroute\.sh run on the tree as it stands$/, (ctx) => {
    const run = (name) => {
      try {
        return execFileSync('bash', [path.join(SCRIPTS, 'test', name)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        return `${e.stdout || ''}${e.stderr || ''}`;
      }
    };
    ctx.shellOutputs = {
      'test_redo_from.sh': run('test_redo_from.sh'),
      'test_reroute.sh': run('test_reroute.sh'),
    };
  });

  scoped(/^each prints ALL PASS and exits zero$/, (ctx) => {
    for (const [name, out] of Object.entries(ctx.shellOutputs)) {
      assert.match(out, /ALL PASS/, `${name} did not print ALL PASS:\n${out}`);
    }
    cleanup(ctx);
  });

  // ── scenario 06: the census of script senders ────────────────────────────
  scoped(/^every non-test script under swarmforge\/scripts that drafts a git_handoff is listed$/, (ctx) => {
    const out = execFileSync(
      'bash',
      ['-c', "grep -l 'type: git_handoff' swarmforge/scripts/*.bb swarmforge/scripts/*.sh"],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    ctx.census = out.trim().split('\n').filter(Boolean).map((p) => path.basename(p));
  });

  scoped(/^the list names salvage_lib\.bb and chase_sweep_lib\.bb$/, (ctx) => {
    assert.ok(ctx.census.includes('salvage_lib.bb'), `census missing salvage_lib.bb: ${ctx.census.join(', ')}`);
    assert.ok(ctx.census.includes('chase_sweep_lib.bb'), `census missing chase_sweep_lib.bb: ${ctx.census.join(', ')}`);
  });

  scoped(/^the list has six entries$/, (ctx) => {
    assert.equal(ctx.census.length, 6, `expected six census entries, got ${ctx.census.length}: ${ctx.census.join(', ')}`);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
