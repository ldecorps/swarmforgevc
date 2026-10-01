'use strict';

// BL-1852: step handlers for "a post-land re-point carries only QA's own
// commits". Every scenario drives the REAL
// land_step_lib.bb/post-land-repoint! (via bl1852RepointKeepsOwnLineCli.bb)
// against a real git fixture with its own bare origin under mkdtemp -
// never a reimplementation of the keep rule.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, 'lib', 'bl1852RepointKeepsOwnLineCli.bb');

const FEATURE = "BL-1852 A post-land re-point carries only QA's own commits";

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function commitFile(root, relPath, content, subject) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', subject);
  return git(root, 'rev-parse', 'HEAD');
}

function ensure(ctx) {
  if (!ctx.bl1852) {
    const root = mkSocketFixtureRoot('bl1852-repoint-');
    track(root);
    const origin = `${root}-origin.git`;
    track(origin);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    for (const [k, v] of [
      ['user.email', 't@t'],
      ['user.name', 't'],
      ['commit.gpgsign', 'false'],
    ]) {
      git(root, 'config', k, v);
    }
    git(root, 'remote', 'add', 'origin', origin);
    // .swarmforge/ must never read as "uncommitted" - same posture
    // bl1438's own fixture uses, for the same reason (the re-point's own
    // log/lock writes under it must never trip the dirty-tree guard).
    fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
    commitFile(root, 'seed.txt', 'seed\n', 'seed');
    git(root, 'push', '-q', '-u', 'origin', 'main');
    ctx.bl1852 = { root, origin, ownSeq: 0, mergedSeq: 0 };
  }
  return ctx.bl1852;
}

function runRepoint(ctx, landedTaskTicketId) {
  const st = ensure(ctx);
  const args = [CLI, st.root];
  if (landedTaskTicketId) args.push(landedTaskTicketId);
  const result = spawnSync('bb', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bl1852RepointKeepsOwnLineCli.bb failed (exit ${result.status}): ${result.stderr}`);
  }
  st.result = JSON.parse(result.stdout.trim().split('\n').pop());
}

// Writes a `land-repoint.log` entry EXACTLY the shape
// log-repoint!/post-land-repoint! already writes (a plain `<ts> <edn-map>`
// line) - the "2026-09-30 shape", no new marker field - so the own-line
// re-derivation is proven against a record this ticket's own code never
// wrote.
function writeRepointLogEntry(root, entry) {
  const logPath = path.join(root, '.swarmforge', 'daemon', 'land-repoint.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  // Mirrors log-repoint!'s own `(str (java.time.Instant/now) " " entry
  // "\n")` exactly - an Instant's own toString has no embedded space (e.g.
  // "2026-09-30T20:00:00Z"), which is what the reader's "split on the
  // FIRST space" relies on. A quoted/tagged timestamp (`#inst "..."`)
  // would put a space INSIDE the timestamp token itself and silently
  // break that split - caught by hand while building this fixture.
  const kept = entry.kept.map((k) => `{:sha "${k.sha}" :subject "${k.subject}"}`).join(' ');
  const line = `2026-09-30T20:00:00Z {:action :repointed, :old-tip "${entry.oldTip}", :new-tip "${entry.newTip}", :kept [${kept}], :dropped []}\n`;
  fs.appendFileSync(logPath, line);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture repository with its own bare origin and a QA branch last re-pointed onto origin\/main$/, (ctx) => {
    ensure(ctx);
    // "last re-pointed onto origin/main": no prior log record at all -
    // own-line-candidates' own no-record fallback (first-parent since the
    // merge-base with origin/main) applies, which for a branch sitting
    // exactly AT origin/main reduces to "nothing yet" - scenarios then
    // build their own history on top.
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^QA has since made (\d+) commits? of its own$/, (ctx, count) => {
    const st = ensure(ctx);
    for (let i = 0; i < Number(count); i += 1) {
      st.ownSeq += 1;
      st.lastOwnSha = commitFile(
        st.root,
        `backlog/evidence/BL-9001-own-${st.ownSeq}.md`,
        `own note ${st.ownSeq}\n`,
        `BL-9001: own note ${st.ownSeq}`
      );
      st.ownShas = st.ownShas || [];
      st.ownShas.push(st.lastOwnSha);
    }
  });

  scoped(/^QA has merged a parcel whose lineage holds (\d+) evidence commits of other tickets that are not on origin\/main$/, (ctx, count) => {
    const st = ensure(ctx);
    const base = git(st.root, 'rev-parse', 'HEAD');
    const branch = 'fixture-parcel-branch';
    git(st.root, 'checkout', '-q', '-b', branch);
    const mergedShas = [];
    for (let i = 1; i <= Number(count); i += 1) {
      mergedShas.push(
        commitFile(st.root, `backlog/evidence/BL-9002-ev-${i}.md`, `evidence ${i}\n`, `BL-9002: evidence ${i}`)
      );
    }
    git(st.root, 'checkout', '-q', 'main');
    git(st.root, 'merge', '--no-ff', '-q', '-m', 'Merge fixture-parcel-branch into main.', branch);
    git(st.root, 'branch', '-D', branch);
    st.mergedShas = mergedShas;
    void base;
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^the last re-point carried (\d+) of QA's own commits and (\d+) evidence commits that had come in through a merge, recorded the way land-repoint\.log records it on 2026-09-30$/,
    (ctx, ownCount, mergedCount) => {
      const st = ensure(ctx);
      // Build the HISTORICAL shape: own commits, then a merge bringing in
      // the "other ticket" evidence commits - the exact shape the real
      // 2026-09-30 incident had (QA's own first-parent line, then a merge
      // whose second parent carries another ticket's bookkeeping).
      const ownShas = [];
      for (let i = 1; i <= Number(ownCount); i += 1) {
        ownShas.push(
          commitFile(st.root, `backlog/evidence/BL-9001-record-own-${i}.md`, `own note ${i}\n`, `BL-9001: own note ${i}`)
        );
      }
      const branch = 'fixture-old-parcel-branch';
      git(st.root, 'checkout', '-q', '-b', branch);
      const mergedShas = [];
      for (let i = 1; i <= Number(mergedCount); i += 1) {
        mergedShas.push(
          commitFile(st.root, `backlog/evidence/BL-9002-ev-${i}.md`, `evidence ${i}\n`, `BL-9002: evidence ${i}`)
        );
      }
      git(st.root, 'checkout', '-q', 'main');
      git(st.root, 'merge', '--no-ff', '-q', '-m', 'Merge fixture-old-parcel-branch into main.', branch);
      git(st.root, 'branch', '-D', branch);
      const recordOldTip = git(st.root, 'rev-parse', 'HEAD');

      // Simulate the OLD BUGGY re-point: reset to origin/main, then
      // cherry-pick EVERY one of the 32 non-merge commits (own + merged
      // alike - the bug's own shape) flat onto it, oldest first.
      const originMain = git(st.origin, 'rev-parse', 'main');
      git(st.root, 'reset', '-q', '--hard', originMain);
      for (const sha of [...ownShas, ...mergedShas]) {
        git(st.root, 'cherry-pick', sha);
      }
      const recordNewTip = git(st.root, 'rev-parse', 'HEAD');

      writeRepointLogEntry(st.root, {
        oldTip: recordOldTip,
        newTip: recordNewTip,
        kept: [...ownShas, ...mergedShas].map((sha) => ({ sha, subject: git(st.root, 'log', '-1', '--format=%s', sha) })),
      });

      st.recordOwnCount = Number(ownCount);
      st.recordMergedCount = Number(mergedCount);
    }
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  // BL-1852 hardening (2026-10-01): own-line-candidates concatenates the
  // carried-forward baseline commits with the new delta commits
  // (`(concat baseline-shas delta)`) and the code's own comment says the
  // result "already answers oldest first - a cherry-pick replay must
  // apply in authored order." No scenario or property-test fixture ever
  // made that order OBSERVABLE: every existing case's baseline and delta
  // commits touch disjoint files, so a reversed concat (confirmed by hand:
  // `(concat delta baseline-shas)`) still cherry-picks cleanly and passes
  // every existing assertion. This step makes the delta commit edit the
  // SAME file the carried-forward (baseline) commit set, as a real
  // sequential edit - its own git patch therefore has baseline's content
  // as context, so replaying it before baseline is cherry-picked would
  // conflict (post-land-repoint! does not abort on a conflict; it drops
  // that one commit with reason "conflict" and keeps going - BL-1852's own
  // doseq/cherry-pick loop), discriminating the order even though neither
  // commit is ever dropped by content-shape rules.
  scoped(/^QA has since edited the same file an earlier re-point carried forward$/, (ctx) => {
    const st = ensure(ctx);
    const relPath = 'backlog/evidence/BL-9001-record-own-1.md';
    const prior = fs.readFileSync(path.join(st.root, relPath), 'utf8');
    st.deltaSha = commitFile(st.root, relPath, `${prior}plus more\n`, 'BL-9001: own note 1 follow-up');
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the change of one of them has since landed on origin\/main$/, (ctx) => {
    const st = ensure(ctx);
    const landedSha = st.ownShas[0];
    const content = fs.readFileSync(path.join(st.root, `backlog/evidence/BL-9001-own-1.md`), 'utf8');
    // Push the SAME content directly to origin/main from a scratch clone,
    // so the fixture's own commit (landedSha) becomes a no-op cherry-pick
    // against the new origin/main - "already landed", never a second copy
    // under a different path.
    const scratch = `${st.root}-scratch`;
    track(scratch);
    execFileSync('git', ['clone', '-q', st.origin, scratch]);
    git(scratch, 'config', 'user.email', 't@t');
    git(scratch, 'config', 'user.name', 't');
    git(scratch, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(scratch, 'backlog', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'backlog/evidence/BL-9001-own-1.md'), content);
    git(scratch, 'add', '-A');
    git(scratch, 'commit', '-q', '-m', 'BL-9001: own note 1');
    git(scratch, 'push', '-q', 'origin', 'main');
    fs.rmSync(scratch, { recursive: true, force: true });
    // origin-main-sha reads the LOCAL refs/remotes/origin/main - a push
    // straight to the bare origin from the scratch clone above never
    // updates it on its own.
    git(st.root, 'fetch', '-q', 'origin');
    void landedSha;
  });

  // ── When ────────────────────────────────────────────────────────────
  scoped(/^the post-land re-point runs$/, (ctx) => {
    runRepoint(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^it re-applies exactly QA's (\d+) commits?$/, (ctx, count) => {
    const st = ensure(ctx);
    assert.equal(st.result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.kept.length, Number(count), `expected ${count} kept commits, got: ${JSON.stringify(st.result.kept)}`);
  });

  scoped(/^the new QA tip is (\d+) commits? ahead of origin\/main$/, (ctx, count) => {
    const st = ensure(ctx);
    const aheadCount = git(st.root, 'rev-list', '--count', `origin/main..HEAD`);
    assert.equal(aheadCount, count, `expected HEAD to be ${count} commit(s) ahead of origin/main, got ${aheadCount}`);
  });

  scoped(/^it re-applies QA's (\d+) commits and none of the (\d+)$/, (ctx, totalCount, mergedCount) => {
    const st = ensure(ctx);
    assert.equal(st.result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(st.result)}`);
    assert.equal(
      st.result.kept.length,
      Number(totalCount),
      `expected ${totalCount} kept commits, got: ${JSON.stringify(st.result.kept)}`
    );
    const mergedSubjects = new Set(Array.from({ length: Number(mergedCount) }, (_, i) => `BL-9002: evidence ${i + 1}`));
    for (const k of st.result.kept) {
      assert.ok(!mergedSubjects.has(k.subject), `expected none of the merged-in commits kept; found: ${k.subject}`);
    }
  });

  scoped(/^it re-applies only the commit whose change has not landed$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(st.result)}`);
    const aheadCount = git(st.root, 'rev-list', '--count', 'origin/main..HEAD');
    assert.equal(aheadCount, '1', `expected exactly 1 new commit ahead of origin/main, got ${aheadCount}`);
  });

  scoped(/^it re-applies both commits with no conflict, and the carried file ends with both edits in order$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.result.action, 'repointed', `expected :repointed, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.kept.length, 2, `expected both commits kept, got: ${JSON.stringify(st.result)}`);
    const conflicts = (st.result.dropped || []).filter((d) => d.reason === 'conflict');
    assert.equal(conflicts.length, 0, `expected no conflict drops (a sign the two were applied out of order): ${JSON.stringify(conflicts)}`);
    const finalContent = fs.readFileSync(path.join(st.root, 'backlog/evidence/BL-9001-record-own-1.md'), 'utf8');
    assert.equal(finalContent, 'own note 1\nplus more\n', `expected the carried file to hold both edits in authored order, got: ${JSON.stringify(finalContent)}`);
  });
}

module.exports = { registerSteps };
