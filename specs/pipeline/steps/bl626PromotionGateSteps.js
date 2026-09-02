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
  'the missing feature': (ctx, out) => {
    assert.ok(out.includes(ctx.pointer), out);
  },
  // BL-1340: a parked draft still fails, and says which kind of draft it is.
  // "not executable" alone was the old text, and it read the same for a draft
  // the ticket was itself chartered to convert.
  'the draft as parked with no conversion pinned': (ctx, out) => {
    assert.ok(out.includes(ctx.pointer), out);
    assert.match(out, /parked/);
    assert.match(out, /no conversion pinned/);
  },
  // Scenario 04's refusal comes from the pre-QA gate, not the promotion CLI,
  // so it reads the gate's own findings rather than `out`.
  'the unconverted draft': (ctx) => {
    const detail = ctx.qaResult.findings.map((f) => f.detail).join('\n');
    assert.ok(detail.includes(ctx.qaDraft), `the refusal does not name the draft: ${detail}`);
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
      // Scenario 04's refusal comes from the pre-QA gate, which never ran the
      // promotion CLI, so there is no st.result to read.
      check(st, st.result ? st.result.out : '');
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

  // ── BL-1340: promotion admits a self-converting draft ──────────────────

  scoped(/^the candidate pins that draft's conversion in its own charter$/, (ctx) => {
    const st = ensure(ctx);
    // The draft exists - a pin never conjures a file, and admitting a pointer
    // to nothing would be BL-441 again by another door.
    writeRel(st.root, st.pointer, 'Feature: the slice this ticket builds\n');
    // Human ruling A: the pin is a required_wiring entry naming a
    // specs/pipeline/steps registration - this parcel landing the handler
    // that makes the draft executable.
    writeCandidate(
      ctx,
      `acceptance: ${st.pointer}\nrequired_wiring:\n  - 'specs/pipeline/steps/index.js::bl9626Steps::the handler this parcel registers'`,
    );
  });

  scoped(/^the candidate pins no conversion of that draft$/, (ctx) => {
    const st = ensure(ctx);
    writeRel(st.root, st.pointer, 'Feature: somebody else\'s slice\n');
    writeCandidate(ctx, `acceptance: ${st.pointer}`);
  });

  scoped(/^an expedited defect whose acceptance names a self-converting draft$/, (ctx) => {
    const st = ensure(ctx);
    const draft = `specs/features/${st.id}-expedited.feature.draft`;
    writeRel(st.root, draft, 'Feature: the slice this ticket builds\n');
    // A LOW ticket priority deliberately: if buildability or priority - not
    // the expedite lane - were deciding, this ticket would lose.
    st.expedited = path.join(st.root, 'backlog', 'paused', 'BL-9627-expedited.yaml');
    fs.writeFileSync(
      st.expedited,
      [
        'id: BL-9627',
        'type: defect',
        'severity: high',
        'human_approval: approved',
        'epic: solo',
        'priority: 90',
        `acceptance: ${draft}`,
        "required_wiring:",
        "  - 'specs/pipeline/steps/index.js::bl9627Steps::the handler this parcel registers'",
        '',
      ].join('\n'),
    );
  });

  scoped(/^a non-expedited candidate whose acceptance names an existing feature$/, (ctx) => {
    const st = ensure(ctx);
    const feature = `specs/features/${st.id}-buildable.feature`;
    writeRel(st.root, feature, 'Feature: already executable\n');
    st.buildable = path.join(st.root, 'backlog', 'paused', 'BL-9628-buildable.yaml');
    fs.writeFileSync(
      st.buildable,
      [
        'id: BL-9628',
        'type: feature',
        'human_approval: approved',
        'epic: solo',
        'priority: 1',
        `acceptance: ${feature}`,
        '',
      ].join('\n'),
    );
  });

  scoped(/^the expedited defect is promoted first$/, (ctx) => {
    withCleanup(ctx, (st) => {
      const result = runGatesCli(['select', st.root, '5', st.buildable, st.expedited]);
      assert.equal(result.status, 0, `select refused outright:\n${result.stdout}${result.stderr}`);
      const picked = `${result.stdout || ''}`.trim();
      assert.ok(
        picked.includes('BL-9627'),
        `the expedited draft-pointer defect was not selected first; got: ${picked}`,
      );
    });
  });

  // Scenario 04: the exit end. Driven against the pure gate that decides it,
  // with the fact the gatherer supplies for a parcel whose acceptance still
  // names a draft at the cited commit.
  scoped(/^a parcel whose ticket acceptance still names a draft$/, (ctx) => {
    const st = ensure(ctx);
    st.qaDraft = `specs/features/${st.id}-unconverted.feature.draft`;
  });

  scoped(/^the documenter sends it to QA$/, (ctx) => {
    const st = ensure(ctx);
    const program = `
(require '[cheshire.core :as json])
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'acceptance_contract_gate_lib.bb')}")
(println (json/generate-string
  (acceptance-contract-gate-lib/evaluate
    {:ticket-id "${st.id}" :declaration-readable? true
     :declaration-draft "${st.qaDraft}" :registry-loadable? true
     :unresolved-steps []})))`;
    const result = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
    assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
    st.qaResult = JSON.parse(`${result.stdout}`.trim());
  });

  scoped(/^the handoff is refused$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(
      Array.isArray(st.qaResult.findings) && st.qaResult.findings.length > 0,
      `the pre-QA gate did not refuse: ${JSON.stringify(st.qaResult)}`,
    );
  });

}

module.exports = { registerSteps };
