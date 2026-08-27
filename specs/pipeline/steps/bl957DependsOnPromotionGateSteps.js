'use strict';

// BL-957: step handlers for "Promotion refuses a ticket whose declared
// dependency has not landed". Drives the REAL promote_and_route_next.sh
// (by-name AND auto-pick) and the REAL promotion_gates_cli.bb evaluate
// against a fixture git repo - same pattern as bl663PromotionGatesSteps.js,
// which this gate extends (one chokepoint, both invocation modes inherit
// it). File-state assertions never trust the script's exit code (no live
// tmux in the fixture; the delivery tail may exit non-zero - BL-663's own
// recorded posture). Fixture roots are tracked and removed in afterEach,
// never leaked (the 2026-08-18 fixture-leak lesson).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMOTE_SCRIPT = path.join(SCRIPTS_DIR, 'promote_and_route_next.sh');
const GATES_CLI = path.join(SCRIPTS_DIR, 'promotion_gates_cli.bb');

const FEATURE_NAME = 'Promotion refuses a ticket whose declared dependency has not landed';

// Scenario Outline cells validated against explicit KNOWN_VALUES
// (engineering article's Scenario Outline rule) - a mutated cell fails
// loudly here, never silently passes through.
const KNOWN_DEPENDENCY_LOCATIONS = new Map([
  ['backlog/done/', 'done'],
  ['backlog/done/M7/', 'done/M7'],
  ['backlog/active/', 'active'],
  ['backlog/paused/', 'paused'],
  ['backlog/hold/', 'hold'],
  ['no folder at all', null],
]);
const KNOWN_VERDICTS = new Set(['ALLOW', 'REFUSE']);
const KNOWN_EMPTY_FORMS = new Map([
  ['[]', 'depends_on: []'],
  ['omitted', null],
]);
const KNOWN_VALUE_FORMS = new Map([
  ['[BL-620]', ['BL-620']],
  ['[BL-620, BL-948]', ['BL-620', 'BL-948']],
  ['BL-620, BL-948 (both must land first)', ['BL-620', 'BL-948']],
]);

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function initRoot(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl957-depends-on-'));
  trackedRoots.push(ctx.root);
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(ctx.root, 'swarmforge'));
  fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 5\n');
  const coderDir = path.join(ctx.root, 'coder');
  mkdirp(coderDir);
  mkdirp(path.join(ctx.root, '.swarmforge'));
  fs.writeFileSync(
    path.join(ctx.root, '.swarmforge', 'roles.tsv'),
    [
      `coder\tcoder-wt\t${coderDir}\tswarmforge-coder\tCoder\tclaude\ttask`,
      `specifier\tmaster\t${ctx.root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
      `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    ].join('\n') + '\n'
  );
}

function writeTicketFile(ctx, id, location, extraLines) {
  const dir = path.join(ctx.root, 'backlog', location);
  mkdirp(dir);
  const lines = [`id: ${id}`, `title: "fixture ${id}"`, 'type: feature', `epic: bl957-${id.toLowerCase()}`].concat(
    extraLines
  );
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `${lines.join('\n')}\n`);
}

function writeCandidate(ctx, id, dependsOnLines, priority = 50) {
  initRoot(ctx);
  writeTicketFile(ctx, id, 'paused', [`priority: ${priority}`, 'human_approval: approved'].concat(dependsOnLines));
  ctx.candidateFiles = ctx.candidateFiles || {};
  ctx.candidateFiles[id] = path.join(ctx.root, 'backlog', 'paused', `${id}-fixture.yaml`);
}

function commitAll(ctx, message) {
  // promote_and_route_next.sh moves tickets with git mv - an uncommitted
  // fixture file is "not under version control" and the move dies (same
  // seeding posture as bl663PromotionGatesSteps.js's commitAll).
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['commit', '-q', '-m', message]);
}

function evaluateVerdict(ctx, id) {
  const res = spawnSync('bb', [GATES_CLI, 'evaluate', ctx.root, ctx.candidateFiles[id], 'false', '5'], {
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return (res.stdout || '').trim();
}

function inDir(ctx, dir, id) {
  const d = path.join(ctx.root, 'backlog', dir);
  return fs.existsSync(d) && fs.readdirSync(d).some((n) => n.startsWith(`${id}-`) && n.endsWith('.yaml'));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a backlog whose promotions are decided by the promotion_gates chokepoint$/, (ctx) => {
    initRoot(ctx);
  });

  scoped(/^ticket "([^"]+)" is in "([^"]+)"$/, (ctx, id, location) => {
    initRoot(ctx);
    if (!KNOWN_DEPENDENCY_LOCATIONS.has(location)) {
      throw new Error(`BL-957: unrecognized dependency location "${location}"`);
    }
    const dir = KNOWN_DEPENDENCY_LOCATIONS.get(location);
    if (dir !== null) {
      writeTicketFile(ctx, id, dir, ['priority: 50']);
    }
  });

  scoped(/^every dependency it names is in "backlog\/active\/"$/, (ctx) => {
    for (const id of ctx.declaredIds || []) {
      writeTicketFile(ctx, id, 'active', ['priority: 50']);
    }
  });

  // ── Givens: candidate shapes ──────────────────────────────────────────
  scoped(/^paused ticket "([^"]+)" declares depends_on "([^"]+)"$/, (ctx, id, deps) => {
    const ids = deps.split(',').map((s) => s.trim());
    // BL-955 gets a BETTER priority than any sibling so scenario 02 proves
    // auto-pick SKIPPED the blocked ranked-first candidate, not merely
    // outranked it.
    writeCandidate(ctx, id, [`depends_on: [${ids.join(', ')}]`], id === 'BL-955' ? 10 : 50);
    ctx.declaredIds = ids;
    ctx.namedTicket = id;
  });

  scoped(/^paused ticket "([^"]+)" whose depends_on field is "([^"]+)"$/, (ctx, id, form) => {
    if (KNOWN_EMPTY_FORMS.has(form)) {
      const line = KNOWN_EMPTY_FORMS.get(form);
      writeCandidate(ctx, id, line === null ? [] : [line]);
      ctx.declaredIds = [];
    } else if (KNOWN_VALUE_FORMS.has(form)) {
      writeCandidate(ctx, id, [`depends_on: ${form}`]);
      ctx.declaredIds = KNOWN_VALUE_FORMS.get(form);
    } else {
      throw new Error(`BL-957: unrecognized depends_on field form "${form}" - not in KNOWN_VALUES`);
    }
    ctx.namedTicket = id;
  });

  scoped(
    /^paused ticket "([^"]+)" declares depends_on as a block list of "([^"]+)" and "([^"]+)"$/,
    (ctx, id, dep1, dep2) => {
      writeCandidate(ctx, id, ['depends_on:', `  - ${dep1}`, `  - ${dep2}`]);
      ctx.declaredIds = [dep1, dep2];
      ctx.namedTicket = id;
    }
  );

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^the coordinator promotes "([^"]+)" by name$/, (ctx, id) => {
    // Both halves of the same chokepoint: the CLI's own crisp
    // ALLOW/REFUSE contract, and the real by-name script for file state.
    commitAll(ctx, 'seed depends_on fixtures');
    ctx.verdict = evaluateVerdict(ctx, id);
    ctx.result = spawnSync('bash', [PROMOTE_SCRIPT, id, ctx.root], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: processEnvAllowlist(),
    });
  });

  scoped(/^the coordinator promotes without naming a ticket$/, (ctx) => {
    commitAll(ctx, 'seed depends_on fixtures');
    ctx.result = spawnSync('bash', [PROMOTE_SCRIPT, ctx.root], {
      cwd: ctx.root,
      encoding: 'utf8',
      env: processEnvAllowlist(),
    });
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^promotion is refused naming gate "([^"]+)"$/, (ctx, gate) => {
    assert.ok(
      ctx.verdict.startsWith(`REFUSE|${gate}|`),
      `expected REFUSE|${gate}|..., got: ${ctx.verdict}`
    );
  });

  scoped(/^the refusal names dependency "([^"]+)"$/, (ctx, id) => {
    assert.ok(ctx.verdict.includes(id), `refusal does not name ${id}: ${ctx.verdict}`);
  });

  scoped(/^the refusal does not name dependency "([^"]+)"$/, (ctx, id) => {
    assert.ok(!ctx.verdict.includes(id), `refusal wrongly names satisfied ${id}: ${ctx.verdict}`);
  });

  scoped(/^the refusal names exactly the dependencies "([^"]+)"$/, (ctx, idsRead) => {
    const expected = idsRead.split(',').map((s) => s.trim()).sort();
    assert.deepEqual(
      [...(ctx.declaredIds || [])].sort(),
      expected,
      `Examples table names "${idsRead}" but KNOWN_VALUES read ${JSON.stringify(ctx.declaredIds)}`
    );
    assert.ok(ctx.verdict.startsWith('REFUSE|depends_on|'), `expected a depends_on refusal, got: ${ctx.verdict}`);
    const named = [...new Set(ctx.verdict.split('|')[2].match(/(?:BL|GH)-\d+/g) || [])].sort();
    assert.deepEqual(named, expected, `refusal names ${JSON.stringify(named)}, expected exactly ${JSON.stringify(expected)}`);
  });

  scoped(/^the promotion gate answers "([^"]+)"$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`BL-957: unrecognized verdict "${verdict}" - not in KNOWN_VALUES`);
    }
    const got = ctx.verdict.split('|')[0];
    assert.equal(got, verdict, `expected ${verdict}, got: ${ctx.verdict}`);
  });

  scoped(/^"([^"]+)" is still in "backlog\/paused\/"$/, (ctx, id) => {
    assert.ok(inDir(ctx, 'paused', id), `${id} is no longer in backlog/paused/`);
    assert.ok(!inDir(ctx, 'active', id), `${id} was wrongly promoted to backlog/active/`);
  });

  scoped(/^"([^"]+)" is promoted to "backlog\/active\/"$/, (ctx, id) => {
    assert.ok(
      inDir(ctx, 'active', id),
      `${id} was not promoted. output:\n${ctx.result.stdout}\n${ctx.result.stderr}`
    );
    assert.ok(!inDir(ctx, 'paused', id), `${id} is still in backlog/paused/ after promotion`);
  });
}

module.exports = { registerSteps };
