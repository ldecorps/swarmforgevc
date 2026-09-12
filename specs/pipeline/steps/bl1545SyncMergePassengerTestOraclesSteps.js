'use strict';

// BL-1545: test_bl1374_sync_merge_passengers.sh (BL-1374) has been red on
// `main` since 2026-09-04 with land_step_lib.bb answering correctly both
// times - the test's own oracles are stale. Case 01 greps the WHOLE printed
// own-paths map for the passenger file and trips on the `:excluded` report
// key BL-1389 added (a report of an exclusion is not a delivery). Case 05
// walks from the LIVE origin/main to a pinned tip that origin/main has since
// absorbed, so its range is empty and its absent checks pass vacuously.
//
// Every verdict here comes from the REAL standing test, spawned exactly as
// the standing suite runs it (BL-1374's own handler does the same) - never a
// restatement of what its "ok" lines should say.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1545 The sync-merge passenger test reads :paths and pins its base';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_REL = 'swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh';
const FIXTURE = path.join(REPO_ROOT, FIXTURE_REL);
const BL1374_FEATURE_REL =
  'specs/features/BL-1374-a-sync-merge-is-not-credited-with-its-passengers.feature';
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');

function state(ctx) {
  ctx.bl1545 = ctx.bl1545 || {};
  return ctx.bl1545;
}

function runFixture(ctx, env) {
  const s = state(ctx);
  if (s.run && !env) return s.run;
  const res = spawnSync('bash', [FIXTURE], {
    encoding: 'utf8',
    timeout: 900000,
    env: { ...process.env, ...(env || {}) },
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const run = { out, status: res.status };
  if (!env) s.run = run;
  return run;
}

// Every "ok"/"FAIL" line in the fixture's output is prefixed with the case
// number it proves - "01 premise: ...", "01: ...", "05 premise: ...". A case
// label is the first token after the marker, so this matches ONLY an "ok"
// line that actually belongs to the named case, never a substring elsewhere
// in the message.
function okLinesFor(out, num) {
  const re = new RegExp(`^\\s*ok\\s+${num}(?:\\s|:)`);
  return out.split('\n').filter((line) => re.test(line));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the standing test "(.+)" which drives the real land_step_lib\.bb over mkdtemp git fixtures and the live history$/, (ctx, file) => {
    assert.equal(file, FIXTURE_REL, `unknown fixture example value "${file}"`);
    assert.ok(fs.existsSync(FIXTURE), `missing fixture ${FIXTURE_REL}`);
    state(ctx);
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the standing suite runs "(.+)"$/, (ctx, file) => {
    assert.equal(file, FIXTURE_REL, `unknown fixture example value "${file}"`);
    runFixture(ctx);
  });

  scoped(/^the standing suite runs "(.+)" with GIT_DIR exported as that clone's git directory$/, (ctx, file) => {
    assert.equal(file, FIXTURE_REL, `unknown fixture example value "${file}"`);
    const s = state(ctx);
    assert.ok(s.clone, 'no scratch clone was recorded before running with GIT_DIR exported');
    s.run = runFixture(ctx, { GIT_DIR: path.join(s.clone, '.git') });
  });

  // ── Given (scenario 04) ───────────────────────────────────────────────
  scoped(/^a scratch clone of a tiny mkdtemp repository whose refs and status are recorded$/, (ctx) => {
    const s = state(ctx);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1545-clone-src-'));
    const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git(src, ['init', '-q', '-b', 'main', '.']);
    git(src, ['config', 'user.email', 't@t']);
    git(src, ['config', 'user.name', 't']);
    git(src, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(src, 'f.txt'), 'hi\n');
    git(src, ['add', '-A']);
    git(src, ['commit', '-qm', 'seed']);
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1545-clone-'));
    const cloneRes = spawnSync('git', ['clone', '-q', src, clone], { encoding: 'utf8' });
    assert.equal(cloneRes.status, 0, `git clone failed: ${cloneRes.stderr}`);
    s.cloneSrc = src;
    s.clone = clone;
    s.refsBefore = spawnSync('git', ['-C', clone, 'for-each-ref'], { encoding: 'utf8' }).stdout;
    s.statusBefore = spawnSync('git', ['-C', clone, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
    // BL-1357: registered so the framework's own scenario-teardown removes
    // these regardless of which assertion (if any) throws first - a failed
    // Then step must not leak the scratch clone.
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => {
      fs.rmSync(clone, { recursive: true, force: true });
      fs.rmSync(src, { recursive: true, force: true });
    });
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { status, out } = state(ctx).run;
    const failures = out.split('\n').filter((l) => l.trim().startsWith('FAIL'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}`);
    assert.equal(status, 0, `exited ${status}\n${out}`);
  });

  scoped(/^every case from "(.+)" to "(.+)" reports at least one passed check$/, (ctx, fromNum, toNum) => {
    const { out } = state(ctx).run;
    const from = Number(fromNum);
    const to = Number(toNum);
    assert.ok(Number.isInteger(from) && Number.isInteger(to) && from <= to, `bad case range ${fromNum}..${toNum}`);
    for (let n = from; n <= to; n += 1) {
      const num = String(n).padStart(2, '0');
      const lines = okLinesFor(out, num);
      assert.ok(lines.length > 0, `case ${num} reported no passed check:\n${out}`);
    }
  });

  scoped(/^the acceptance run of "(.+)" resolves all (\d+) scenarios$/, (ctx, feature, count) => {
    assert.equal(feature, BL1374_FEATURE_REL, `unknown feature example value "${feature}"`);
    const featurePath = path.join(REPO_ROOT, feature);
    const res = spawnSync('bash', [RUN_ACCEPTANCE, featurePath], { encoding: 'utf8', timeout: 900000 });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 0, `acceptance run of ${feature} did not exit zero:\n${out}`);
    const passMatch = out.match(/^# pass (\d+)$/m);
    const failMatch = out.match(/^# fail (\d+)$/m);
    assert.ok(passMatch, `could not find a "# pass N" summary line:\n${out}`);
    assert.equal(passMatch[1], count, `expected ${count} passing scenarios, got ${passMatch[1]}:\n${out}`);
    assert.equal(failMatch && failMatch[1], '0', `expected 0 failing scenarios:\n${out}`);
  });

  scoped(/^case "(.+)" reports "(.+)" absent from the delivered :paths value$/, (ctx, num, needle) => {
    const { out } = state(ctx).run;
    const delivered = out
      .split('\n')
      .filter((l) => l.startsWith('OWN-PATHS-DELIVERED '))
      .join('\n');
    assert.ok(delivered.length > 0, `no OWN-PATHS-DELIVERED line found:\n${out}`);
    assert.ok(!delivered.includes(needle), `expected "${needle}" absent from the delivered :paths value: ${delivered}`);
    // And the "ok" line for that check is actually present - the negative
    // control this scenario exists to prove (a whole-map grep would also
    // read "absent" here, for the wrong reason: it is present, under
    // :excluded, not under :paths).
    assert.ok(
      okLinesFor(out, num).some((l) => l.includes('the passenger file is not this ticket')),
      `case ${num} did not report the delivered-paths check:\n${out}`
    );
  });

  scoped(/^case "(.+)" reports "(.+)" present in the delivered :paths value$/, (ctx, num, needle) => {
    const { out } = state(ctx).run;
    const delivered = out
      .split('\n')
      .filter((l) => l.startsWith('OWN-PATHS-DELIVERED '))
      .join('\n');
    assert.ok(delivered.includes(needle), `expected "${needle}" present in the delivered :paths value: ${delivered}`);
    assert.ok(
      okLinesFor(out, '02').some((l) => l.includes("this ticket's own work still replays")),
      `case ${num} did not report the delivered-paths check:\n${out}`
    );
  });

  scoped(
    /^case "(.+)" reports the :excluded entry for "(.+)" naming owners "(.+)" and "(.+)"$/,
    (ctx, num, sharedPath, ownerA, ownerB) => {
      const { out } = state(ctx).run;
      const ownPathsLine = out.split('\n').find((l) => l.startsWith('OWN-PATHS '));
      assert.ok(ownPathsLine, `no OWN-PATHS line found:\n${out}`);
      assert.ok(
        ownPathsLine.includes(`:path "${sharedPath}"`),
        `:excluded entry does not name ${sharedPath}: ${ownPathsLine}`
      );
      assert.ok(ownPathsLine.includes(`"${ownerA}"`), `:excluded owners do not include ${ownerA}: ${ownPathsLine}`);
      assert.ok(ownPathsLine.includes(`"${ownerB}"`), `:excluded owners do not include ${ownerB}: ${ownPathsLine}`);
    }
  );

  scoped(
    /^case "(.+)" reports the walk from "(.+)" to "(.+)" as a non-empty range before any absent check$/,
    (ctx, num, base, tip) => {
      const { out } = state(ctx).run;
      const lines = out.split('\n');
      const rangeIdx = lines.findIndex(
        (l) => l.includes('non-empty range') && l.includes(base) && l.includes(tip)
      );
      assert.ok(rangeIdx >= 0, `no non-empty-range premise naming ${base}..${tip} found:\n${out}`);
      assert.ok(lines[rangeIdx].trim().startsWith('ok'), `the range premise did not pass: ${lines[rangeIdx]}`);
      const firstAbsentIdx = lines.findIndex(
        (l, i) => i > 0 && /^\s*(ok|FAIL)\s+05:/.test(l)
      );
      assert.ok(
        firstAbsentIdx === -1 || rangeIdx < firstAbsentIdx,
        `the range premise must print before case 05's own checks:\n${out}`
      );
    }
  );

  scoped(/^case "(.+)" reports "(.+)" owning "(.+)"$/, (ctx, num, ticket, filePath) => {
    const { out } = state(ctx).run;
    assert.ok(
      okLinesFor(out, num).some((l) => l.includes("passenger's own ticket still owns its file")),
      `case ${num} did not report ${ticket} owning ${filePath}:\n${out}`
    );
  });

  scoped(/^case "(.+)" reports neither "(.+)" nor "(.+)" credited with it$/, (ctx, num, ticketA, ticketB) => {
    const { out } = state(ctx).run;
    assert.ok(
      okLinesFor(out, num).some((l) => l.includes('landing ticket is no longer credited with it')),
      `case ${num} did not report ${ticketA} uncredited:\n${out}`
    );
    assert.ok(
      okLinesFor(out, num).some((l) => l.includes('nor is the other passenger')),
      `case ${num} did not report ${ticketB} uncredited:\n${out}`
    );
  });

  scoped(
    /^the clone's refs and status are byte-identical to the recording, or the run aborted naming a fixture root$/,
    (ctx) => {
      const s = state(ctx);
      const refsAfter = spawnSync('git', ['-C', s.clone, 'for-each-ref'], { encoding: 'utf8' }).stdout;
      const statusAfter = spawnSync('git', ['-C', s.clone, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
      const aborted = s.run.status !== 0 && /ABORT: fixture root/.test(s.run.out);
      if (!aborted) {
        assert.equal(refsAfter, s.refsBefore, "the clone's refs changed under an inherited GIT_DIR");
        assert.equal(statusAfter, s.statusBefore, "the clone's status changed under an inherited GIT_DIR");
      }
    }
  );

  scoped(/^no branch "(.+)" exists in the repository the test ran from$/, (ctx, branch) => {
    const res = spawnSync('git', ['-C', REPO_ROOT, 'branch', '--list', branch], { encoding: 'utf8' });
    assert.equal(res.stdout.trim(), '', `stray branch "${branch}" found in the live repository`);
  });
}

module.exports = { registerSteps };
