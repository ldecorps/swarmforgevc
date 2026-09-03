'use strict';

// BL-1339: step handlers proving the land-approval record lands where the
// predicate reads.
//
// Every fixture here has TWO checkouts - a main one and a linked worktree -
// because that is the shape the defect lives in. The ticket is explicit that
// every existing test built ONE root and ran writer and reader against it, so
// writer-root and reader-root were the same directory by construction and the
// defect could not be expressed. A single-root fixture here would repeat that.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAND_STEP_LIB = path.join(SCRIPTS, 'land_step_lib.bb');
const IS_QA_ANCESTOR = path.join(SCRIPTS, 'is_qa_ancestor.sh');
const FIXTURE_PREFIX = 'bl1339-acceptance-';
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // Another scenario tidying its own root is not this sweep's business.
    }
  }
}
sweepStaleFixtures();

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function state(ctx) {
  if (!ctx.bl1339) ctx.bl1339 = {};
  return ctx.bl1339;
}

// A main checkout, a swarmforge-QA ref, and a linked worktree - the real
// topology a pipeline role stands in.
function buildFixture(ctx) {
  const st = state(ctx);
  if (st.main) return st;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const main = path.join(base, 'main');
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main', '.');
  git(main, 'config', 'user.email', 't@t');
  git(main, 'config', 'user.name', 't');
  git(main, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(main, 'seed.txt'), 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'branch', 'swarmforge-QA');
  const worktree = path.join(base, 'wt-QA');
  git(main, 'worktree', 'add', '-q', '-b', 'qa-work', worktree);
  st.base = base;
  st.main = main;
  st.worktree = worktree;
  st.approved = git(main, 'rev-parse', 'HEAD');
  return st;
}

function landApprovalDir(root) {
  return path.join(root, '.swarmforge', 'land-approvals');
}

function recordsIn(root) {
  const dir = landApprovalDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
}

// The REAL recorder, run from the given checkout.
// The lib's field is :ok?, so the JSON key carries the question mark.
function recordFrom(cwd, { commit, source, ticket, breakRoot }) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string (land-step-lib/record-land-approval!
  {:root "${breakRoot ? path.join(os.tmpdir(), 'bl1339-not-a-repo') : cwd}"
   :commit "${commit}" :source "${source}" :task-ticket-id "${ticket}"})))`;
  const r = spawnSync('bb', ['-e', program], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const CHECKOUT = { 'the main checkout': 'main', 'the linked worktree': 'worktree' };

const FEATURE = "BL-1339 a land-approval record lands where the predicate reads it";

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a repository with a main checkout and a linked worktree for a pipeline role$/, (ctx) => {
    buildFixture(ctx);
  });

  scoped(/^an approved parcel with no bounce verdict on file$/, (ctx) => {
    const st = buildFixture(ctx);
    // Approved: reachable from the QA ref, and no bounce store anywhere.
    assert.ok(!fs.existsSync(path.join(st.main, '.swarmforge', 'bounces')));
    // A REAL commit standing in for the landed replay - the predicate
    // resolves shas, so a made-up token would fail as unresolvable and never
    // reach the question this scenario asks.
    fs.writeFileSync(path.join(st.main, 'landed.txt'), 'landed replay\n');
    git(st.main, 'add', '-A');
    git(st.main, 'commit', '-q', '-m', 'BL-9339: tip-pure replay onto origin/main');
    st.landed = git(st.main, 'rev-parse', 'HEAD').slice(0, 10);
  });

  scoped(/^the land step is run from "?(the main checkout|the linked worktree)"?$/, (ctx, checkout) => {
    const st = buildFixture(ctx);
    st.cwd = st[CHECKOUT[checkout]];
    assert.ok(st.cwd, `unknown checkout: ${checkout}`);
  });

  scoped(/^the shared root cannot be resolved$/, (ctx) => {
    state(ctx).breakRoot = true;
  });

  scoped(/^a land-approval record written by a land step run from the main checkout$/, (ctx) => {
    const st = buildFixture(ctx);
    st.first = recordFrom(st.main, { commit: 'bbbbbbbbbb', source: st.approved, ticket: 'BL-9339a' });
    assert.equal(st.first['ok?'], true, `the first record was not written: ${JSON.stringify(st.first)}`);
  });

  scoped(/^it replays (?:the|a second) approved parcel onto the main branch and records the approval$/, (ctx) => {
    const st = state(ctx);
    st.result = recordFrom(st.cwd, {
      commit: st.landed || 'cccccccccc',
      source: st.approved,
      ticket: 'BL-9339',
      breakRoot: st.breakRoot,
    });
  });

  scoped(/^a bounce verdict is then recorded against that parcel$/, (ctx) => {
    const st = state(ctx);
    // BL-952's own sequence: approve, land, THEN bounce. Written at the target
    // root, which is where the machine-local bounce store lives.
    const dir = path.join(st.main, '.swarmforge', 'bounces');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-09.jsonl'),
      `${JSON.stringify({ at: '2026-09-03T00:00:00Z', commit: st.approved.slice(0, 10), ticket: 'BL-9339' })}\n`,
    );
  });

  scoped(/^no merge into the QA ref has happened since that land$/, (ctx) => {
    const st = state(ctx);
    // Deliberately nothing: the whole point of BL-1334's record is that the
    // landed replay is approved WITHOUT one.
    assert.equal(git(st.main, 'rev-parse', 'swarmforge-QA'), st.approved);
  });

  scoped(/^the shared QA-approval predicate is asked about the landed commit from the shared root$/, (ctx) => {
    const st = state(ctx);
    const r = spawnSync('bash', [IS_QA_ANCESTOR, st.landed || 'cccccccccc'], {
      cwd: st.main,
      encoding: 'utf8',
    });
    st.predicate = { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  });

  scoped(/^the approval record is in the shared root's land-approval store$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.result['ok?'], true, `the record was not written: ${JSON.stringify(st.result)}`);
    const shared = recordsIn(st.main);
    assert.equal(shared.length, 1, `expected one record at the shared root, got ${JSON.stringify(shared)}`);
    fs.rmSync(st.base, { recursive: true, force: true });
  });

  scoped(/^the linked worktree has no land-approval store of its own$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.result['ok?'], true, `the record was not written: ${JSON.stringify(st.result)}`);
    assert.ok(
      !fs.existsSync(landApprovalDir(st.worktree)),
      'the land step created a per-worktree store, which is the store a reader misses',
    );
    assert.equal(recordsIn(st.main).length, 1, 'the shared root did not get the record');
    fs.rmSync(st.base, { recursive: true, force: true });
  });

  scoped(/^both approval records are in the shared root's land-approval store$/, (ctx) => {
    const st = state(ctx);
    const shared = recordsIn(st.main);
    assert.equal(shared.length, 2, `append, never truncate: expected two records, got ${JSON.stringify(shared)}`);
    assert.ok(!fs.existsSync(landApprovalDir(st.worktree)), 'a per-worktree store appeared');
    fs.rmSync(st.base, { recursive: true, force: true });
  });

  scoped(/^it answers approved$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.predicate.status, 0, `the predicate did not approve the landed replay:\n${st.predicate.out}`);
    fs.rmSync(st.base, { recursive: true, force: true });
  });

  scoped(/^it answers not approved$/, (ctx) => {
    const st = state(ctx);
    assert.notEqual(st.predicate.status, 0, `a bounced source was still approved:\n${st.predicate.out}`);
    fs.rmSync(st.base, { recursive: true, force: true });
  });

  scoped(/^no approval record is written anywhere$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual(recordsIn(st.main), [], 'a record was written despite an unresolvable root');
    assert.deepEqual(recordsIn(st.worktree), [], 'a record was written into the worktree');
  });

  scoped(/^the land step reports the approval as unrecorded$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.result['ok?'], false, 'the recorder claimed success with no root');
    assert.match(String(st.result.reason), /shared target root|could not/i, `the reason does not say why: ${st.result.reason}`);
  });

  scoped(/^the land step still succeeds$/, (ctx) => {
    const st = state(ctx);
    // The contract: bookkeeping that could not be written never kills the
    // land - it degrades to the sanctioned override and says so.
    assert.equal(st.result['ok?'], false);
    assert.ok(st.result.reason, 'an unrecorded land must say why');
    fs.rmSync(st.base, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
