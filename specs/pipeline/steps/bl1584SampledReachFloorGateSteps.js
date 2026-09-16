'use strict';

// BL-1584: step handlers for "a new property test with a sampled reach
// floor is refused at send". Drives the REAL swarm_handoff.bb (and its real
// sampled_reach_floor_guard_lib.bb call chain) against a real fixture git
// repo, same pattern as bl1576MergeDropGuardSteps.js - a single fixture git
// repo playing the role of "the branch" (git operations always target
// ctx.root), with the sender role's own in_process mailbox seeded directly.
//
// Scenario 06 needs no git_handoff machinery at all - it drives the census
// CLI directly over a throwaway fixture tree built from the frozen corpus
// under specs/pipeline/fixtures/bl1584/, never the live extension/test/
// population the sweep keeps changing (BL-1006).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const CENSUS_CLI = path.join(SCRIPTS_DIR, 'sampled_reach_floor_census_cli.bb');
const FIXTURE_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'fixtures', 'bl1584');

const TASK_NAME = 'BL-1584-fixture';
const TICKET_ID = 'BL-1584';
const FEATURE_NAME = 'BL-1584 a new property test with a sampled reach floor is refused at send';

const ALL_FIXTURE_NAMES = [
  'bl1327DescentLadderInvariants', 'bl1342CrashloopStampInvariants',
  'bl1384LocalSeatTopicForwardedInvariants', 'cursorSeatDriver',
  'bl687WithinEpicLiveItems', 'bl946EpicIconPoolInvariants',
  'bl1078UncertifiedCursorRefused', 'bl1003BusyVerdictParity',
  'bl1529ScriptSenderAuditOutcomesInvariant', 'bl1281ReachFloorConstructionInvariants',
  'bl1113CursorHotfixStampOff', 'bl1304DryRunSpawnsNothing', 'pilotSafeDefects',
];

function mkTmp(prefix) {
  return mkSocketFixtureRoot(prefix);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// BL-1390: a fresh mkdtemp dir under mkSocketFixtureRoot - `git init` here
// can never touch the live checkout - proven right after init, BEFORE any
// mutating git command follows.
function proveFixtureIsolated(root) {
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

// Each non-coder role gets its OWN worktree-path subdirectory - sharing
// ctx.root across roles would collapse every role's mailbox into the same
// physical directory (handoff_lib.bb's mailbox-base-dir keys only on
// worktree-path for a non-master role), so coder's own seeded in_process
// parcel would misread as architect's, tripping the duplicate-chain guard
// on a parcel that was never actually sent there.
function architectDir(ctx) { return path.join(ctx.root, 'architect'); }
function cleanerDir(ctx) { return path.join(ctx.root, 'cleaner'); }

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder-wt\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `architect\tarchitect-wt\t${architectDir(ctx)}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `cleaner\tcleaner-wt\t${cleanerDir(ctx)}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
  ];
  fs.mkdirSync(path.join(ctx.root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(architectDir(ctx), { recursive: true });
  fs.mkdirSync(cleanerDir(ctx), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function writeFile(ctx, name, content) {
  const full = path.join(ctx.root, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(ctx, message) {
  git(ctx.root, ['add', '-A']);
  git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function head(ctx) {
  return gitOut(ctx.root, ['rev-parse', 'HEAD']);
}

function seedReceivedParcel(ctx, commitSha) {
  const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const content = `type: git_handoff\nto: cleaner\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${commitSha}\nfrom: coder\nrole: coder\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '00_received.handoff'), content);
}

function runSwarmHandoff(ctx, draftContent) {
  const draftPath = path.join(ctx.root, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'coder' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function frozenFixtureContent(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${name}.property.fixture.js`), 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────

  scoped(/^a fixture repository carrying the frozen classifier corpus under specs\/pipeline\/fixtures\/bl1584$/, (ctx) => {
    ctx.root = mkTmp('bl1584-gate-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    proveFixtureIsolated(ctx.root);
    git(ctx.root, ['config', 'user.email', 'bl1584@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1584']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeRoles(ctx);
    writeFile(ctx, 'seed.txt', 'seed\n');
    commit(ctx, 'seed base');
  });

  scoped(/^a role holding a received parcel commit in its in_process mailbox, ready to hand off$/, (ctx) => {
    writeFile(ctx, 'backlog/active/BL-1584-fixture-x.yaml', 'id: BL-1584\n');
    commit(ctx, `${TICKET_ID}-fixture: own ticket seed`);
    ctx.received = head(ctx);
    seedReceivedParcel(ctx, ctx.received);
  });

  // ── Given / When (scenarios 01-05) ──────────────────────────────────────

  scoped(/^the parcel's own commit adds a property test file shaped like the corpus file (\S+)$/, (ctx, name) => {
    const relPath = `extension/test/${name}.property.test.js`;
    writeFile(ctx, relPath, frozenFixtureContent(name));
    commit(ctx, `${TICKET_ID}-fixture: adds ${name} as a new property test`);
    ctx.subjectPath = relPath;
    ctx.subjectFixtureName = name;
  });

  scoped(/^the received parcel commit already carries a property test file shaped like the corpus file (\S+)$/, (ctx, name) => {
    const relPath = `extension/test/${name}.property.test.js`;
    writeFile(ctx, relPath, frozenFixtureContent(name));
    commit(ctx, `pre-existing: ${name}, already on main`);
    // Re-point the received pointer to include this commit - Background's
    // own seed ran before this file existed, and this scenario's whole
    // point is that the file was ALREADY there at the received commit.
    ctx.received = head(ctx);
    seedReceivedParcel(ctx, ctx.received);
    ctx.subjectPath = relPath;
    ctx.subjectFixtureName = name;
  });

  scoped(/^the parcel's own commit modifies that file without constructing its floor$/, (ctx) => {
    const full = path.join(ctx.root, ctx.subjectPath);
    fs.appendFileSync(full, '\n// touched, same shape\n');
    commit(ctx, `${TICKET_ID}-fixture: touches the pre-existing file`);
  });

  scoped(/^the received parcel commit recorded in the in_process mailbox cannot be read$/, (ctx) => {
    seedReceivedParcel(ctx, 'deadbeef00');
  });

  scoped(/^the role sends the git_handoff$/, (ctx) => {
    const tipSha = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
    const draft = `type: git_handoff\nto: architect\npriority: 50\ntask: ${TASK_NAME}\ncommit: ${tipSha}\n`;
    ctx.result = runSwarmHandoff(ctx, draft);
  });

  // ── Then (scenarios 01-05) ───────────────────────────────────────────

  const REFUSAL_MARKER = /SAMPLED_REACH_FLOOR: Cannot send git_handoff/;
  const WARNING_MARKER = /SAMPLED_REACH_FLOOR WARNING/;

  scoped(/^the send is (refused|allowed)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    const refused = REFUSAL_MARKER.test(out);
    if (outcome === 'refused') {
      if (ctx.result.status !== 2 || !refused) {
        throw new Error(`expected BL-1584's own gate to have refused (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      return;
    }
    // Not a status===0 check: the self-audit challenge (BL-1529, Article
    // 2.3) can legitimately answer AUDIT_REQUIRED / HANDOFF_NOT_QUEUED
    // (exit 1) on a fixture's first-ever send for a sender+task - a real,
    // non-refusing outcome for THIS gate's own purposes, same convention
    // bl1576MergeDropGuardSteps.js's own "allowed" check follows (it never
    // asserts an exit code at all, only the absence of its own marker).
    if (refused) {
      throw new Error(`expected the send to be allowed, but BL-1584's gate refused it: ${out}`);
    }
  });

  scoped(/^the refusal names the added property test file$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(ctx.subjectPath)) {
      throw new Error(`expected the refusal to name ${ctx.subjectPath}, got: ${out}`);
    }
  });

  scoped(/^the refusal quotes the reach-floor assertion it matched$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/never exercised/.test(out)) {
      throw new Error(`expected the refusal to quote the matched assertion text, got: ${out}`);
    }
  });

  scoped(/^the refusal states the draw budget (\d+)$/, (ctx, budget) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes(`budget ${budget}`)) {
      throw new Error(`expected the refusal to state the budget ${budget}, got: ${out}`);
    }
  });

  scoped(/^the refusal names runsPerCell and assertReachFloor as the remedy$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes('runsPerCell') || !out.includes('assertReachFloor')) {
      throw new Error(`expected the refusal to name the remedy, got: ${out}`);
    }
  });

  scoped(/^a sampled reach floor warning names that property test file$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!(WARNING_MARKER.test(out) && out.includes(ctx.subjectPath))) {
      throw new Error(`expected a SAMPLED_REACH_FLOOR WARNING naming ${ctx.subjectPath}, got: ${out}`);
    }
  });

  scoped(/^a warning names the ticket whose received commit could not be read$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!(WARNING_MARKER.test(out) && out.includes(TICKET_ID))) {
      throw new Error(`expected a SAMPLED_REACH_FLOOR WARNING naming ${TICKET_ID}, got: ${out}`);
    }
  });

  // ── Scenario 06: the census CLI, no git_handoff involved ────────────────

  scoped(/^the census CLI runs over a tree holding exactly the thirteen corpus files$/, (ctx) => {
    ctx.censusRoot = mkTmp('bl1584-census-');
    for (const name of ALL_FIXTURE_NAMES) {
      const dest = path.join(ctx.censusRoot, 'extension', 'test', `${name}.property.test.js`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, frozenFixtureContent(name));
    }
    const res = spawnSync('bb', [CENSUS_CLI, ctx.censusRoot], { encoding: 'utf8', env: processEnvAllowlist() });
    ctx.censusResult = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  });

  scoped(/^it prints thirteen rows and a summary$/, (ctx) => {
    const lines = ctx.censusResult.stdout.trim().split('\n');
    const rowLines = lines.filter((l) => !l.startsWith('SUMMARY '));
    const summaryLines = lines.filter((l) => l.startsWith('SUMMARY '));
    if (rowLines.length !== ALL_FIXTURE_NAMES.length) {
      throw new Error(`expected ${ALL_FIXTURE_NAMES.length} rows, got ${rowLines.length}: ${ctx.censusResult.stdout}`);
    }
    if (summaryLines.length !== 1) {
      throw new Error(`expected exactly one summary line, got ${summaryLines.length}: ${ctx.censusResult.stdout}`);
    }
    for (const line of rowLines) {
      if (line.split('\t').length !== 3) {
        throw new Error(`expected 3 tab-separated fields per row, got: ${JSON.stringify(line)}`);
      }
    }
  });

  scoped(/^the row for (\S+) reads (\S+) with budget (\S+)$/, (ctx, name, verdict, budget) => {
    const lines = ctx.censusResult.stdout.trim().split('\n');
    const line = lines.find((l) => l.startsWith(`extension/test/${name}.property.test.js\t`));
    if (!line) {
      throw new Error(`expected a row for ${name}, got: ${ctx.censusResult.stdout}`);
    }
    const expected = `extension/test/${name}.property.test.js\t${verdict}\t${budget}`;
    if (line !== expected) {
      throw new Error(`expected row ${JSON.stringify(expected)}, got ${JSON.stringify(line)}`);
    }
  });
}

module.exports = { registerSteps };
