'use strict';

// BL-656: expeditor posts stage progress to the Operator topic via announce seam.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');
const FEATURE =
  'expeditor posts stage progress to the Telegram Operator topic';

const RUN_TICKET = 'BL-656';
const SIBLING = 'BL-590';

function mkRoot(ctx) {
  if (ctx.bl656?.root) return ctx.bl656.root;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl656-'));
  spawnSync('bash', [FIXTURE_SH, dir, '--active', RUN_TICKET, '--active', SIBLING], {
    encoding: 'utf8',
  });
  const announceLog = path.join(dir, '.swarmforge', 'expedite-fixture', 'announce.log');
  const captureSh = path.join(dir, 'announce-capture.sh');
  fs.writeFileSync(
    captureSh,
    `#!/usr/bin/env bash\nset -euo pipefail\necho "$EXPEDITE_ANNOUNCE_LINE" >> "${announceLog}"\n`,
  );
  fs.chmodSync(captureSh, 0o755);
  const failSh = path.join(dir, 'announce-fail.sh');
  fs.writeFileSync(
    failSh,
    `#!/usr/bin/env bash
echo "fail" >> "${announceLog}"
exit 1
`,
  );
  fs.chmodSync(failSh, 0o755);
  ctx.bl656 = { root: dir, announceLog, captureSh, failSh };
  return dir;
}

function runExpedite(ctx, extraEnv = {}, extraArgs = []) {
  const root = mkRoot(ctx);
  const env = {
    ...process.env,
    EXPEDITE_STAGE_RUNNER: path.join(root, 'stage-runner.sh'),
    EXPEDITE_STOP_CMD: './stop-swarm.sh',
    EXPEDITE_START_CMD: './start-swarm.sh',
    EXPEDITE_ANNOUNCE_CMD: ctx.bl656.announceCmd ?? ctx.bl656.captureSh,
    ...extraEnv,
  };
  const args = [CLI, root, RUN_TICKET, '--no-restart', ...extraArgs];
  const res = spawnSync('bb', args, { encoding: 'utf8', env, cwd: REPO_ROOT });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl656.last = { out, status: res.status, env };
  return ctx.bl656.last;
}

function readAnnounces(ctx) {
  mkRoot(ctx);
  try {
    return fs.readFileSync(ctx.bl656.announceLog, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project root with expedite announce seam enabled$/, (ctx) => {
    mkRoot(ctx);
  });

  scoped(/^EXPEDITE_ANNOUNCE_CMD captures announce lines for acceptance runs$/, (ctx) => {
    ctx.bl656.announceCmd = ctx.bl656.captureSh;
  });

  scoped(
    /^an expedite run completes initiation park each stage entry each verdict final verdict and restart$/,
    (ctx) => {
      runExpedite(ctx);
      assert.equal(ctx.bl656.last.status, 0, ctx.bl656.last.out);
    },
  );

  scoped(/^each milestone is announced exactly once to the Operator topic$/, (ctx) => {
    const lines = readAnnounces(ctx);
  const kinds = {
      initiation: lines.filter((l) => l.includes(': initiation OK')).length,
      park: lines.filter((l) => l.includes(': park ')).length,
      entered: lines.filter((l) => l.includes(' entered (')).length,
      verdict: lines.filter((l) => /: (PASS|SEND BACK|FORWARD|APPROVED)/.test(l)).length,
      final: lines.filter((l) => l.includes(': final ')).length,
      restart: lines.filter((l) => l.includes(': restart ')).length,
    };
    assert.equal(kinds.initiation, 1, lines.join('\n'));
    assert.equal(kinds.park, 1, lines.join('\n'));
    assert.equal(kinds.entered, 7, lines.join('\n'));
    assert.equal(kinds.verdict, 7, lines.join('\n'));
    assert.equal(kinds.final, 1, lines.join('\n'));
    assert.equal(kinds.restart, 1, lines.join('\n'));
    assert.equal(lines.length, 18, `unexpected duplicate milestones:\n${lines.join('\n')}`);
  });

  scoped(
    /^the announced sequence reconstructs the ride without reading the log file$/,
    (ctx) => {
      const lines = readAnnounces(ctx);
      const joined = lines.join('\n');
      assert.match(joined, /initiation OK/);
      assert.match(joined, /park.*BL-590/);
      assert.match(joined, /specifier entered/);
      assert.match(joined, /QA: PASS/);
      assert.match(joined, /final done/);
      assert.match(joined, /restart not-attempted/);
    },
  );

  scoped(/^expedite initiation refuses because teardown is not clean$/, (ctx) => {
    const root = mkRoot(ctx);
    const probe = path.join(os.tmpdir(), `bl656-probe-${process.pid}.json`);
    fs.writeFileSync(
      probe,
      JSON.stringify({ 'tmux-servers-answering': 0, babysitterd: true, 'role-agents': 0 }),
    );
    ctx.bl656.probeFile = probe;
    runExpedite(ctx, {
      EXPEDITE_PROBE_FILE: probe,
      EXPEDITE_STOP_CMD: './stop-swarm-lying.sh',
    });
    assert.equal(ctx.bl656.last.status, 1);
    assert.match(ctx.bl656.last.out, /REFUSE teardown/);
  });

  scoped(/^the refuse milestone is announced$/, (ctx) => {
    const lines = readAnnounces(ctx);
    assert.ok(lines.some((l) => l.includes('REFUSE initiation')), lines.join('\n'));
  });

  scoped(/^the announce line names the BL id and the surviving processes that blocked start$/, (ctx) => {
    const lines = readAnnounces(ctx);
    const refuse = lines.find((l) => l.includes('REFUSE initiation'));
    assert.ok(refuse, lines.join('\n'));
    assert.match(refuse, /BL-656/);
    assert.match(refuse, /babysitterd/);
  });

  scoped(/^the default announcer cannot reach Telegram$/, (ctx) => {
    ctx.bl656.announceCmd = ctx.bl656.failSh;
  });

  scoped(
    /^an expedite run completes through final verdict and optional restart$/,
    (ctx) => {
      runExpedite(ctx);
      assert.equal(ctx.bl656.last.status, 0, ctx.bl656.last.out);
    },
  );

  scoped(/^gate outcomes and verdicts match a run with a working announcer$/, (ctx) => {
    assert.match(ctx.bl656.last.out, /ticket done/);
    const root = ctx.bl656.root;
    assert.equal(
      fs.readdirSync(path.join(root, 'backlog', 'done')).filter((f) => f.includes(RUN_TICKET)).length,
      1,
    );
  });

  scoped(/^a warning is logged that announce delivery failed$/, (ctx) => {
    assert.match(ctx.bl656.last.out, /WARNING announce delivery failed/);
  });

  scoped(/^an expedite run emits milestones under EXPEDITE_ANNOUNCE_CMD$/, (ctx) => {
    runExpedite(ctx);
    assert.equal(ctx.bl656.last.status, 0, ctx.bl656.last.out);
  });

  scoped(/^every milestone line is captured by the announce command$/, (ctx) => {
    const lines = readAnnounces(ctx);
    assert.ok(lines.length >= 10, lines.join('\n'));
  });

  scoped(/^no live Telegram API call is required for acceptance$/, (ctx) => {
    assert.equal(ctx.bl656.announceCmd, ctx.bl656.captureSh);
    assert.ok(readAnnounces(ctx).length > 0, 'milestones must be captured locally');
  });

  scoped(/^a stage verdict carries a reason longer than the note-length discipline$/, (ctx) => {
    const root = mkRoot(ctx);
    const longReason = 'x'.repeat(120);
    const evidence = 'backlog/evidence/BL-656-long-reason.md';
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'expedite-fixture', 'cleaner.verdict'),
      JSON.stringify({
        verdict: 'pass',
        reason: longReason,
        'evidence-path': evidence,
      }),
    );
    runExpedite(ctx);
    ctx.bl656.longReason = longReason;
    ctx.bl656.evidence = evidence;
  });

  scoped(/^the verdict milestone is announced$/, (ctx) => {
    const lines = readAnnounces(ctx);
    assert.ok(lines.some((l) => l.includes('cleaner: PASS')), lines.join('\n'));
  });

  scoped(/^the posted line truncates the reason$/, (ctx) => {
    const lines = readAnnounces(ctx);
    const line = lines.find((l) => l.includes('cleaner: PASS'));
    assert.ok(line, lines.join('\n'));
    assert.ok(!line.includes(ctx.bl656.longReason), line);
  });

  scoped(/^the line includes the evidence file path as the pointer to full detail$/, (ctx) => {
    const lines = readAnnounces(ctx);
    const line = lines.find((l) => l.includes('cleaner: PASS'));
    assert.ok(line?.includes(ctx.bl656.evidence), line);
  });
}

module.exports = { registerSteps };
