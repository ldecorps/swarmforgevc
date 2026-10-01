'use strict';

// BL-1853: step handlers for "a land reads each commit's diff once" - the
// post-land-plan diff cache in land_step_lib.bb's commit-line-changes.
// Drives the REAL land-step-lib/land-plan against a real git fixture
// (never a JavaScript restatement of the cache or the attribution walk).
//
// Fixtures under mkdtemp, proven via `git rev-parse --git-common-dir`
// before any mutating command (BL-1390) - gitCommonDir() below both reads
// that and is the one place this file computes it from.
//
// The fixture's "origin/main" is a tracking ref this file writes directly
// (git update-ref), never a real bare remote: the same convention
// land_step_lib_test_runner.bb's own mark-origin-main-here! already uses
// for this exact file's tests, kept here rather than introducing a second
// isolation posture for the identical library.
//
// commit-line-changes is exercised through sibling-own-line-changes (via
// land-plan's own entanglement/attribution walk), never called directly -
// the two real call sites that read a commit's diff on the land's hot
// path (BL-1853's own ticket text).
//
// The 200-commit tip is built with ONE `git fast-import` stream (the
// ticket's own "How": "git fast-import builds 200 commits in well under a
// second"), tagged to a SIBLING ticket (never the landing ticket) so
// land-plan's entanglement walk reads every one of their diffs via
// sibling-own-line-changes - the same shape BL-1852's own evidence found
// for the real 2026-09-30 incident (absorbed sibling bookkeeping, not the
// landing ticket's own work).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1853 A land reads each commit's diff once";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const LANDING_TICKET = 'BL-9001';
const SIBLING_TICKET = 'BL-9002';

function ensure(ctx) {
  if (!ctx.bl1853) {
    ctx.bl1853 = { siblingCount: 0 };
  }
  return ctx.bl1853;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
}

// BL-1390: the real git-common-dir, resolved and proven (a non-zero exit
// here is a fixture bug, never silently swallowed into "" - which `git -C
// ""` would read as the live checkout).
function gitCommonDir(root) {
  const reported = git(root, 'rev-parse', '--git-common-dir').trim();
  if (!reported) {
    throw new Error(`bl1853: git-common-dir did not resolve for fixture root ${root}`);
  }
  return path.resolve(root, reported);
}

function headSha(root) {
  return git(root, 'rev-parse', 'HEAD').trim();
}

// Appends `count` commits onto the current `main` tip in ONE fast-import
// stream, each adding its own file so each has a real, distinct diff;
// each subject leads with `ticketId` so commit-ticket-id attributes it.
function appendCommits(root, { ticketId, count, filePrefix }) {
  let parentSha = null;
  try {
    parentSha = git(root, 'rev-parse', '-q', '--verify', 'main').trim();
  } catch (_) {
    parentSha = null;
  }
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const mark = i + 1;
    const subject = `${ticketId}: ${filePrefix}-${i}`;
    const subjectBytes = Buffer.byteLength(subject, 'utf8');
    const content = `${filePrefix}-${i}\n`;
    const contentBytes = Buffer.byteLength(content, 'utf8');
    lines.push('commit refs/heads/main');
    lines.push(`mark :${mark}`);
    lines.push('author t <t@t> 0 +0000');
    lines.push('committer t <t@t> 0 +0000');
    lines.push(`data ${subjectBytes}`);
    lines.push(subject);
    if (mark === 1) {
      if (parentSha) {
        lines.push(`from ${parentSha}`);
      }
    } else {
      lines.push(`from :${mark - 1}`);
    }
    lines.push(`M 100644 inline ${filePrefix}-${i}.txt`);
    lines.push(`data ${contentBytes}`);
    lines.push(content);
    lines.push('');
  }
  const stream = `${lines.join('\n')}\n`;
  execFileSync('git', ['-C', root, 'fast-import', '--quiet'], { input: stream, encoding: 'utf8' });
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

function cacheDir(root) {
  return path.join(gitCommonDir(root), 'land-diff-cache');
}

function cachePath(root, commit) {
  return path.join(cacheDir(root), commit);
}

// A successful replay leaves its branch + owner record behind on purpose
// (land_step_lib.bb's own replay! docstring); a second land-plan call for
// the SAME {task-ticket-id, commit} in the SAME process is otherwise
// refused as "owned by a live run" by its leftover-scratch guard. Reset
// before every call (harmless/no-op before the first).
function resetScratch(root, commit) {
  const id = `${LANDING_TICKET}-${commit.slice(0, 10)}`;
  try {
    git(root, 'branch', '-D', `land-replay/${id}`);
  } catch (_) {
    // no such branch yet - fine
  }
  fs.rmSync(path.join(gitCommonDir(root), 'land-replay-worktrees'), { recursive: true, force: true });
}

// Warms the diff cache the same way land-plan's own entanglement walk
// would (sibling-own-line-changes, land-plan's real, non-reimplemented
// call site for every sibling commit's diff - commit-ticket-id's own
// *commit-meta* preloaded here exactly as land-plan preloads it
// internally), WITHOUT paying for a full land-plan call's replay/tree-
// guards/own-paths-attribution machinery, which costs the same whether
// or not the cache is warm (measured: ~0.1s/commit regardless, the
// pre-existing cost of task_scope_gate_lib.bb's own per-commit path walk
// over land-plan's OWN commits too - outside this ticket's scope, which
// is why "the land plan has already run once" is implemented via the
// cache-filling call land-plan itself makes, not a second, full land-plan
// invocation on every Background).
function warmSiblingCache(root, commit) {
  const expr = `(load-file ${JSON.stringify(LIB)})
(let [root ${JSON.stringify(root)}
      commit ${JSON.stringify(commit)}
      origin (land-step-lib/origin-main-sha root)
      candidates (land-step-lib/ancestry-commits root origin commit)
      meta (land-step-lib/range-commit-meta root origin commit)]
  (binding [land-step-lib/*commit-meta* meta]
    (land-step-lib/sibling-own-line-changes root candidates ${JSON.stringify(SIBLING_TICKET)})))`;
  bb(expr);
}

function runLandPlan(root, commit, { logPath, disableCache } = {}) {
  resetScratch(root, commit);
  const bindings = [];
  if (logPath) {
    bindings.push(`land-step-lib/*diff-read-log* ${JSON.stringify(logPath)}`);
  }
  if (disableCache) {
    bindings.push('land-step-lib/*diff-cache-disabled* true');
  }
  const call = `(land-step-lib/land-plan {:root ${JSON.stringify(root)} :commit ${JSON.stringify(commit)} :task-ticket-id ${JSON.stringify(LANDING_TICKET)}})`;
  const wrapped = bindings.length ? `(binding [${bindings.join(' ')}] (println (json/generate-string ${call})))` : `(println (json/generate-string ${call}))`;
  const expr = `(require '[cheshire.core :as json])\n(load-file ${JSON.stringify(LIB)})\n${wrapped}`;
  const out = bb(expr);
  const jsonLine = out
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .pop();
  return JSON.parse(jsonLine);
}

function readLogShas(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// A verdict compared for EQUALITY, excluding :commit/:branch - every
// land-plan call builds its own fresh replay commit (a real object), so
// those two fields legitimately differ between two independent calls
// even with no bug; the invariant is about the verdict's own content
// (action/entangled/own-paths/...), not byte-identical replay artifacts.
function verdictForComparison(plan) {
  const copy = { ...plan };
  delete copy.commit;
  delete copy.branch;
  return copy;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with its own bare origin and a tip holding 200 ticket-tagged commits since origin\/main$/, (ctx) => {
    const st = ensure(ctx);
    const root = trackedTmpRoot('bl1853-land-');
    st.root = root;
    initRepo(root);
    git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
    git(root, 'update-ref', 'refs/remotes/origin/main', headSha(root));
    appendCommits(root, { ticketId: SIBLING_TICKET, count: 200, filePrefix: 'sibling' });
    st.siblingCount = 200;
    // The landing ticket's own single commit on top, so land-plan finds a
    // real entanglement (the 200 sibling commits) to attribute and read.
    fs.writeFileSync(path.join(root, 'own.txt'), 'own\n');
    git(root, 'add', '-A');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${LANDING_TICKET}: own work`);
    st.tip = headSha(root);
  });

  scoped(/^the land plan has already run once over that tip$/, (ctx) => {
    const st = ensure(ctx);
    warmSiblingCache(st.root, st.tip);
  });

  scoped(/^(\d+) more ticket-tagged commits are added to the tip$/, (ctx, count) => {
    const st = ensure(ctx);
    const before = st.tip;
    appendCommits(st.root, { ticketId: SIBLING_TICKET, count: Number(count), filePrefix: `sibling-r2-${st.siblingCount}` });
    st.siblingCount += Number(count);
    st.newCommitsSince = git(st.root, 'rev-list', `${before}..main`).trim().split('\n').filter(Boolean);
    st.tip = headSha(st.root);
  });

  scoped(/^the cache entry of one commit is (missing|corrupt|written for a different commit)$/, (ctx, state) => {
    const st = ensure(ctx);
    // The very first sibling commit - cached by the Background's own run.
    const target = git(st.root, 'rev-list', '--reverse', `refs/remotes/origin/main..${st.tip}`).trim().split('\n')[0];
    st.mutatedCommit = target;
    const p = cachePath(st.root, target);
    if (state === 'missing') {
      fs.rmSync(p, { force: true });
    } else if (state === 'corrupt') {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, 'not edn {{{');
    } else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '{:commit "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" :diff {"bogus.txt" {:added #{"x"}}}}');
    }
  });

  scoped(/^the land plan runs again$/, (ctx) => {
    const st = ensure(ctx);
    const logPath = path.join(st.root, `diff-reads-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    st.logPath = logPath;
    st.plan = runLandPlan(st.root, st.tip, { logPath });
  });

  scoped(/^it reads a commit diff from git for exactly the (\d+) new commits$/, (ctx, count) => {
    const st = ensure(ctx);
    const readShas = new Set(readLogShas(st.logPath));
    assert.equal(readShas.size, Number(count), `expected ${count} distinct git reads, got ${readShas.size}: ${[...readShas].join(',')}`);
    const expected = new Set(st.newCommitsSince);
    assert.deepEqual(readShas, expected, 'expected the git reads to be exactly the new commits, not any of the already-cached ones');
  });

  scoped(/^it reads that commit's diff from git$/, (ctx) => {
    const st = ensure(ctx);
    const readShas = readLogShas(st.logPath);
    assert.deepEqual(readShas, [st.mutatedCommit], `expected exactly one git read, for the mutated commit, got: ${readShas.join(',')}`);
  });

  scoped(/^its verdict equals the verdict of a land plan with no cache$/, (ctx) => {
    const st = ensure(ctx);
    const noCachePlan = runLandPlan(st.root, st.tip, { disableCache: true });
    assert.deepEqual(verdictForComparison(st.plan), verdictForComparison(noCachePlan), 'expected the same verdict with and without the cache');
  });
}

module.exports = { registerSteps };
