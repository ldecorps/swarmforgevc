'use strict';

// BL-626: promotion refuses a ticket whose acceptance names no executable
// feature. Drives the REAL promotion_gates_cli.bb (evaluate + audit-acceptance)
// against a scratch fixture root — never the live paused/ tree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE =
  'promotion refuses a ticket whose acceptance names no executable feature';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATES_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');

const POINTER = {
  'a feature file': (id) => `specs/features/${id}-target.feature`,
  'its own draft': (id) => `specs/features/${id}-target.feature.draft`,
};

const PRESENT = {
  'only its draft': (ctx) => {
    const draftPath = `${ctx.pointer}.draft`;
    writeRel(ctx.root, draftPath, 'Feature: draft only\n');
    ctx.presentDraft = draftPath;
  },
  'that draft': (ctx) => {
    writeRel(ctx.root, ctx.pointer, 'Feature: parked draft\n');
    ctx.presentDraft = ctx.pointer;
  },
  'no matching file': () => {},
};

const NAMED = {
  'the missing feature and its draft': (ctx, out) => {
    assert.ok(out.includes(ctx.pointer), out);
    assert.ok(out.includes(`${ctx.pointer}.draft`) || out.includes(ctx.presentDraft), out);
  },
  'the draft as not executable': (ctx, out) => {
    assert.ok(out.includes(ctx.pointer), out);
    assert.match(out, /not executable/);
  },
  'the missing feature': (ctx, out) => {
    assert.ok(out.includes(ctx.pointer), out);
  },
};

function writeRel(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function ensure(ctx) {
  if (!ctx.bl626) {
    ctx.bl626 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl626-promo-')),
      id: 'BL-9626',
    };
    fs.mkdirSync(path.join(ctx.bl626.root, 'backlog', 'paused'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl626.root, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl626.root, 'specs', 'features'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl626.root, 'swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.bl626.root, 'swarmforge', 'swarmforge.conf'),
      'config active_backlog_max_depth 5\n',
    );
  }
  return ctx.bl626;
}

function cleanup(ctx) {
  const st = ctx.bl626;
  if (!st || !st.root) return;
  fs.rmSync(st.root, { recursive: true, force: true });
  st.root = null;
}

function writeCandidate(ctx, acceptanceLine) {
  const st = ensure(ctx);
  const body = [
    `id: ${st.id}`,
    'title: "BL-626 fixture"',
    'type: defect',
    'severity: medium',
    'human_approval: approved',
    'epic: code-quality-gates',
    'priority: 10',
    acceptanceLine,
    '',
  ].join('\n');
  const file = path.join(st.root, 'backlog', 'paused', `${st.id}-fixture.yaml`);
  fs.writeFileSync(file, body);
  st.candidate = file;
  return file;
}

function runGatesCli(args) {
  return spawnSync('bb', [GATES_CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function recordResult(st, result) {
  st.result = {
    status: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function withCleanup(ctx, fn) {
  try {
    fn(ensure(ctx));
  } finally {
    cleanup(ctx);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket eligible for promotion into the active backlog$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the candidate's acceptance names (a feature file|its own draft)$/, (ctx, kind) => {
    const st = ensure(ctx);
    const build = POINTER[kind];
    assert.ok(build, `unknown pointer kind: ${kind}`);
    st.pointer = build(st.id);
    st.pointerKind = kind;
  });

  scoped(/^(only its draft|that draft|no matching file) in specs\/features\/$/, (ctx, present) => {
    const st = ensure(ctx);
    assert.ok(st.pointer, 'pointer must be set before present');
    const apply = PRESENT[present];
    assert.ok(apply, `unknown present: ${present}`);
    apply(st);
    writeCandidate(ctx, `acceptance: ${st.pointer}`);
  });

  scoped(/^the candidate's acceptance names a feature file that exists$/, (ctx) => {
    const st = ensure(ctx);
    st.pointer = `specs/features/${st.id}-ok.feature`;
    writeRel(st.root, st.pointer, 'Feature: ok\n');
    writeCandidate(ctx, `acceptance: ${st.pointer}`);
  });

  scoped(/^the candidate's acceptance is prose naming no feature file$/, (ctx) => {
    writeCandidate(ctx, 'acceptance: |\n  Manual chore; no feature file.\n');
  });

  scoped(/^the candidate's acceptance names a feature file that does not exist$/, (ctx) => {
    const st = ensure(ctx);
    st.pointer = `specs/features/${st.id}-dangling.feature`;
    writeCandidate(ctx, `acceptance: ${st.pointer}`);
  });

  scoped(/^a different feature file sharing the candidate's ticket id prefix$/, (ctx) => {
    const st = ensure(ctx);
    const sibling = `specs/features/${st.id}-other.feature`;
    writeRel(st.root, sibling, 'Feature: decoy sibling\n');
    st.sibling = sibling;
  });

  scoped(/^tickets in paused and active whose acceptance resolves to no feature$/, (ctx) => {
    const st = ensure(ctx);
    const missA = 'specs/features/BL-9626-audit-a.feature';
    const missB = 'specs/features/BL-9626-audit-b.feature';
    fs.writeFileSync(
      path.join(st.root, 'backlog', 'paused', 'BL-9626a-fixture.yaml'),
      `id: BL-9626A\nhuman_approval: approved\nacceptance: ${missA}\n`,
    );
    fs.writeFileSync(
      path.join(st.root, 'backlog', 'active', 'BL-9626b-fixture.yaml'),
      `id: BL-9626B\nhuman_approval: approved\nacceptance: ${missB}\n`,
    );
    st.auditMissing = [missA, missB];
  });

  scoped(/^the coordinator promotes the next eligible ticket$/, (ctx) => {
    const st = ensure(ctx);
    recordResult(st, runGatesCli(['evaluate', st.root, st.candidate, 'false', '5']));
  });

  scoped(/^the backfill audit runs$/, (ctx) => {
    const st = ensure(ctx);
    recordResult(st, runGatesCli(['audit-acceptance', st.root]));
  });

  scoped(/^the promotion is refused$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.result.status, 0, `expected refuse, got:\n${st.result.out}`);
    assert.match(st.result.out, /^REFUSE\|acceptance\|/m);
  });

  scoped(/^the refusal names (.+)$/, (ctx, named) => {
    withCleanup(ctx, (st) => {
      const check = NAMED[named.trim()];
      assert.ok(check, `unknown named cell: ${named}`);
      check(st, st.result.out);
    });
  });

  scoped(/^the candidate is promoted$/, (ctx) => {
    withCleanup(ctx, (st) => {
      assert.equal(st.result.status, 0, `expected ALLOW, got:\n${st.result.out}`);
      assert.match(st.result.out, /^ALLOW$/m);
    });
  });

  scoped(/^no feature file is demanded of it$/, (ctx) => {
    // Covered by ALLOW above; keep as an explicit Then for scenario 03.
    assert.ok(true);
  });

  scoped(/^every one of those tickets is listed with the path that failed to resolve$/, (ctx) => {
    withCleanup(ctx, (st) => {
      assert.notEqual(st.result.status, 0, `expected audit findings, got:\n${st.result.out}`);
      for (const p of st.auditMissing) {
        assert.ok(st.result.out.includes(p), `missing ${p} in:\n${st.result.out}`);
      }
      assert.ok(st.result.out.includes('BL-9626A'), st.result.out);
      assert.ok(st.result.out.includes('BL-9626B'), st.result.out);
    });
  });
}

module.exports = { registerSteps };
