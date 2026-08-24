'use strict';

// BL-1100: promotion candidacy is decided by structured fields, never prose.
//
// Drives the REAL promote_and_route_next.sh (--list-candidates and by-id
// promote) against fixture repos. The defect was a whole-file grep for a
// hold phrase; these scenarios assert that grep is gone.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { installPromotionGates } = require('./lib/promotionGatesFixture');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE = 'Promotion candidacy is decided by structured fields, never by prose';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PROMOTE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const REAL_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const PARKED = {
  'BL-553': {
    repoRel: 'backlog/paused/BL-553-quota-manager-availability-check.yaml',
    directive: 'do not promote ahead of the operator',
  },
  'BL-556': {
    // Done on main; fixture preserves the historical park sentence + blocked.
    directive: 'do not promote until GH-22',
  },
  'BL-828': {
    repoRel: 'backlog/paused/BL-828-bubble-collapsed-gesture-model.yaml',
    directive: 'do not promote; swarm is attacking BL-818',
  },
};

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function installRouteScripts(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const entry of ['promotion_gates_cli.bb', 'route_backlog_to_coder.sh', 'commit_integrity_cli.bb']) {
    for (const name of computeClosure(REAL_SCRIPTS, entry)) {
      const src = path.join(REAL_SCRIPTS, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
    }
  }
  fs.copyFileSync(PROMOTE_SH, path.join(scriptsDir, 'promote_and_route_next.sh'));
  fs.chmodSync(path.join(scriptsDir, 'promote_and_route_next.sh'), 0o755);
}

function makeRoot(ctx) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1100-')));
  installPromotionGates(root, { maxDepth: 50 });
  installRouteScripts(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  ctx.root = root;
  return root;
}

function writePaused(root, id, body) {
  const dir = path.join(root, 'backlog', 'paused');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-fixture.yaml`);
  fs.writeFileSync(file, body);
  return file;
}

function eligibleBody(id, prose) {
  return [
    `id: ${id}`,
    'title: "fixture"',
    'type: feature',
    'status: todo',
    'human_approval: approved',
    'depends_on: []',
    'acceptance: specs/features/BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose.feature',
    'notes: |',
    `  ${prose}`,
    '',
  ].join('\n');
}

function listCandidates(root) {
  const result = spawnSync('bash', [path.join(root, 'swarmforge', 'scripts', 'promote_and_route_next.sh'), '--list-candidates', root], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_SKIP_SYNC_INJECT: '1' },
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    ids: (result.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a paused ticket that is otherwise eligible for promotion$/, (ctx) => {
    makeRoot(ctx);
    ctx.ticketId = 'BL-9100';
    // Feature file must exist relative to fixture for is_buildable / gates.
    const featDir = path.join(ctx.root, 'specs', 'features');
    fs.mkdirSync(featDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'specs', 'features', 'BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose.feature'),
      path.join(featDir, 'BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose.feature')
    );
  });

  scoped(/^the ticket's prose contains (.+)$/, (ctx, sentence) => {
    const prose = sentence.replace(/^"|"$/g, '');
    ctx.prose = prose;
    writePaused(ctx.root, ctx.ticketId, eligibleBody(ctx.ticketId, prose));
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `seed ${ctx.ticketId}`);
  });

  scoped(/^the coordinator scans for a promotion candidate$/, (ctx) => {
    ctx.scan = listCandidates(ctx.root);
  });

  scoped(/^the ticket is among the candidates$/, (ctx) => {
    assert.ok(ctx.scan.ids.includes(ctx.ticketId), `expected ${ctx.ticketId} in [${ctx.scan.ids.join(', ')}]; stderr=${ctx.scan.stderr}`);
  });

  scoped(/^the ticket declares status blocked$/, (ctx) => {
    writePaused(
      ctx.root,
      ctx.ticketId,
      eligibleBody(ctx.ticketId, 'ordinary notes').replace('status: todo', 'status: blocked')
    );
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `seed blocked ${ctx.ticketId}`);
  });

  scoped(/^the ticket is not among the candidates$/, (ctx) => {
    assert.ok(!ctx.scan.ids.includes(ctx.ticketId), `${ctx.ticketId} must not be a candidate`);
  });

  scoped(/^the scan reports that ticket's id and the gate that refused it$/, (ctx) => {
    assert.match(ctx.scan.stderr, new RegExp(`skip ${ctx.ticketId} gate=blocked`));
  });

  scoped(/^the coordinator is asked to promote that ticket by id$/, (ctx) => {
    ctx.promote = spawnSync(
      'bash',
      [path.join(ctx.root, 'swarmforge', 'scripts', 'promote_and_route_next.sh'), ctx.ticketId, ctx.root],
      {
        encoding: 'utf8',
        env: { ...process.env, SWARMFORGE_SKIP_SYNC_INJECT: '1' },
      }
    );
  });

  scoped(/^the ticket is promoted$/, (ctx) => {
    // Route may fail in a fixture without full handoff wiring; the promotion
    // itself is the rename into active/.
    const active = fs.existsSync(path.join(ctx.root, 'backlog', 'active'))
      ? fs.readdirSync(path.join(ctx.root, 'backlog', 'active'))
      : [];
    assert.ok(
      active.some((f) => f.startsWith(ctx.ticketId)),
      `expected ${ctx.ticketId} in active/; promote rc=${ctx.promote.status} stderr=${ctx.promote.stderr}`
    );
  });

  scoped(/^the parked ticket (.+), whose only bar to promotion is a human directive in its prose$/, (ctx, ticket) => {
    makeRoot(ctx);
    ctx.ticketId = ticket;
    const meta = PARKED[ticket];
    assert.ok(meta, `unknown parked ticket ${ticket}`);
    let body;
    if (meta.repoRel && fs.existsSync(path.join(REPO_ROOT, meta.repoRel))) {
      body = fs.readFileSync(path.join(REPO_ROOT, meta.repoRel), 'utf8');
    } else {
      body = eligibleBody(ticket, meta.directive).replace('status: todo', 'status: blocked');
    }
    assert.match(body, /do not promote/i, 'human directive must be present');
    assert.match(body, /^status:\s*blocked\s*$/m, 'park must be structured');
    ctx.directiveSnippet = meta.directive;
    ctx.ticketBody = body;
    writePaused(ctx.root, ticket, body);
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `seed parked ${ticket}`);
  });

  scoped(/^that human directive is still present in the ticket verbatim$/, (ctx) => {
    const onDisk = fs.readFileSync(path.join(ctx.root, 'backlog', 'paused', `${ctx.ticketId}-fixture.yaml`), 'utf8');
    assert.ok(onDisk.includes(ctx.directiveSnippet) || /do not promote/i.test(onDisk));
    // Byte-identical to what we planted (the change must not rewrite the sentence).
    assert.equal(onDisk, ctx.ticketBody);
  });
}

module.exports = { registerSteps };
