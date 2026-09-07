'use strict';

// BL-1469: a ticket declaring `not_before: YYYY-MM-DD` is never promoted
// before that UTC date, on every path including a caller-declared
// queue-jump. Drives the REAL promotion_gates_lib.bb (scenarios 01-05, via
// `bb -e`) and the REAL promote_and_route_next.sh (scenario 06, via
// symlinks into a disposable fixture root - never a copy of the gate
// library's own dependency chain, which drifts as the codebase grows;
// scenario 06's fixture proved this the hard way against the pre-existing
// copy-based shell test, whose copied `backlog_depth_lib.bb` no longer
// carries its own `daemon_cycle_guard_lib.bb` dependency).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1469 A ticket is never promoted before the date it declares';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_lib.bb');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// Fixed, never the real clock - every scenario 01-05 assertion is immune
// to whatever date this actually runs on.
const TODAY = '2026-01-08';

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function evaluateTicket(content, { today = TODAY, queueJump = false } = {}) {
  const expr =
    `(require '[cheshire.core :as json])\n` +
    `(load-file "${LIB}")\n` +
    `(println (json/generate-string (promotion-gates-lib/evaluate ` +
    `{:content "${content}" :held? false :active-count 0 :max-depth 5 :active-epics {} ` +
    `:today "${today}" :queue-jump? ${queueJump ? 'true' : 'false'}})))`;
  return JSON.parse(bb(expr));
}

function ticketYaml(id, priority) {
  return `id: ${id}\nstatus: paused\npriority: ${priority}\nhuman_approval: approved\n`;
}

// Scenario 06 only: a disposable git root wired to the REAL gate chain by
// symlink (never copied - a copy silently drifts the moment the library
// gains a new transitive load-file, exactly what broke the pre-existing
// test_promote_and_route_next_priority.sh's own copy list). Only
// route_backlog_to_coder.sh is a real, local stub file - it is the one
// piece this scenario must control rather than let run for real.
const GATE_DEPS = [
  'promote_and_route_next.sh',
  'promotion_gates_cli.bb',
  'promotion_gates_lib.bb',
  'backlog_depth_lib.bb',
  'daemon_cycle_guard_lib.bb',
  'swarm_identity_lib.bb',
  'acceptance_pointer_gate_lib.bb',
  'headroom_cap_raise_lib.bb',
  'slice_size_envelope_gate_lib.bb',
];

function buildShellFixture(tickets) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1469-shell-'));
  fixtureRoots.push(root);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  for (const f of GATE_DEPS) {
    fs.symlinkSync(path.join(SCRIPTS, f), path.join(root, 'swarmforge', 'scripts', f));
  }
  fs.symlinkSync(
    path.join(REPO_ROOT, 'extension', 'out', 'tools', 'deprecate-check.js'),
    path.join(root, 'extension', 'out', 'tools', 'deprecate-check.js'),
  );
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'route_backlog_to_coder.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"\n',
    { mode: 0o755 },
  );
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init']);
  for (const { id, content } of tickets) {
    fs.writeFileSync(path.join(root, 'backlog', 'paused', `${id}-fixture.yaml`), content);
  }
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'fixture backlog']);
  return root;
}

function runPromoter(root) {
  return spawnSync('bash', [path.join(root, 'swarmforge', 'scripts', 'promote_and_route_next.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ROUTE_LOG: path.join(root, 'route.log'),
      SWARMFORGE_SKIP_DAEMON: '1',
      SWARMFORGE_ROLE: 'coordinator',
    },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture backlog under mkdtemp with a paused, approved ticket, an open slot and an injected today$/,
    (ctx) => {
      ctx.today = TODAY;
      ctx.content = ticketYaml('BL-9001', 5);
      ctx.secondTicket = null;
    },
  );

  scoped(/^the ticket declares not_before three days after today$/, (ctx) => {
    const date = addDaysIso(ctx.today, 3);
    ctx.content += `not_before: ${date}\n`;
    ctx.expectedDate = date;
    ctx.expectedDays = 3;
  });

  scoped(/^the ticket declares not_before (today|yesterday)$/, (ctx, when) => {
    const date = when === 'today' ? ctx.today : addDaysIso(ctx.today, -1);
    ctx.content += `not_before: ${date}\n`;
  });

  scoped(/^the ticket declares not_before as text that is not a calendar date$/, (ctx) => {
    ctx.malformedValue = 'next-tuesday';
    ctx.content += `not_before: ${ctx.malformedValue}\n`;
  });

  scoped(/^the ticket declares no not_before$/, () => {
    // Background's own ticket already declares none - nothing to do.
  });

  scoped(/^a second paused approved ticket of lower priority with no not_before$/, (ctx) => {
    ctx.secondTicket = { id: 'BL-9002', content: ticketYaml('BL-9002', 8) };
  });

  scoped(/^the first ticket declares not_before three days after today$/, (ctx) => {
    // Scenario 06 runs the REAL script, which resolves `today` from the
    // real clock itself (no injection point in the shell path) - "three
    // days after today" here is computed from the actual wall clock, not
    // the fixed injected TODAY the other scenarios use, so it is always a
    // genuine future date whenever this actually runs.
    const realTodayIso = new Date().toISOString().slice(0, 10);
    const date = addDaysIso(realTodayIso, 3);
    ctx.content += `not_before: ${date}\n`;
  });

  scoped(/^the promotion gates evaluate it$/, (ctx) => {
    ctx.result = evaluateTicket(ctx.content, { today: ctx.today });
  });

  scoped(/^the promotion gates evaluate it as a caller-declared queue-jump$/, (ctx) => {
    ctx.result = evaluateTicket(ctx.content, { today: ctx.today, queueJump: true });
  });

  scoped(/^the promoter runs against the fixture$/, (ctx) => {
    assert.ok(ctx.secondTicket, 'expected the second ticket to have been declared first');
    ctx.shellRoot = buildShellFixture([
      { id: 'BL-9001', content: ctx.content },
      ctx.secondTicket,
    ]);
    ctx.shellResult = runPromoter(ctx.shellRoot);
  });

  scoped(/^it is refused by the not_before gate and the refusal names that date$/, (ctx) => {
    assert.equal(ctx.result.ok, false, `expected a refusal, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.gate, 'not_before', `expected gate not_before, got: ${JSON.stringify(ctx.result)}`);
    assert.ok(
      ctx.result.reason.includes(ctx.expectedDate),
      `expected the refusal to name ${ctx.expectedDate}, got: ${ctx.result.reason}`,
    );
  });

  scoped(/^the not_before gate raises no refusal$/, (ctx) => {
    assert.equal(ctx.result.ok, true, `expected no refusal, got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^it is refused by the not_before gate and the refusal names the value$/, (ctx) => {
    assert.equal(ctx.result.ok, false, `expected a refusal, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.gate, 'not_before', `expected gate not_before, got: ${JSON.stringify(ctx.result)}`);
    assert.ok(
      ctx.result.reason.includes(ctx.malformedValue),
      `expected the refusal to name ${ctx.malformedValue}, got: ${ctx.result.reason}`,
    );
  });

  scoped(/^the verdict is the one the gates gave before this feature$/, (ctx) => {
    assert.equal(ctx.result.ok, true, `expected the pre-existing clean verdict, got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^the second ticket is promoted and the first stays paused$/, (ctx) => {
    const { status, stdout, stderr } = ctx.shellResult;
    assert.equal(status, 0, `expected the promoter to exit 0, got ${status}: ${stdout}${stderr}`);
    const active = fs.readdirSync(path.join(ctx.shellRoot, 'backlog', 'active'));
    const paused = fs.readdirSync(path.join(ctx.shellRoot, 'backlog', 'paused'));
    assert.ok(
      active.some((f) => f.startsWith('BL-9002')),
      `expected BL-9002 to be promoted, active/ has: ${active.join(', ')}`,
    );
    assert.ok(
      paused.some((f) => f.startsWith('BL-9001')),
      `expected BL-9001 to stay paused, paused/ has: ${paused.join(', ')}`,
    );
  });
}

module.exports = { registerSteps };
