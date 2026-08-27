'use strict';

// BL-1032: step handlers for "the tmux-reaper guard scopes by hazard, not by a
// token".
//
// Every scenario drives the REAL guard from specs/pipeline/steps/lib -
// findTmuxReaperViolation and startsTmuxServer, the exact pair
// extension/test/tmuxReaperGuard.test.js calls. Scenarios 01-02 pass file TEXT
// rather than writing files, because the scoping decision is a pure function
// of a file's contents; scenario 03 scans the committed tree.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'the tmux-reaper guard scopes by hazard, not by a token';

const STEPS_DIR = path.join(__dirname);
const {
  findTmuxReaperViolation,
  startsTmuxServer,
} = require(path.join(STEPS_DIR, 'lib', 'tmuxReaperGuard'));

// Explicit known values per the Scenario Outline handler rule: scenario 02's
// closed set of hazard routes. A row the handlers do not know is a hard
// failure, never a passthrough.
const KNOWN_ROUTES = new Map([
  [
    'by spawning tmux directly',
    ["execFileSync('tmux', ['-S', sock, 'new-session', '-d']);"].join('\n'),
  ],
  [
    'through a tmux stub it puts on PATH',
    // bl958ControlPlaneLossSteps.js's shape, and the measured reason scoping on
    // a literal spawn alone is wrong.
    [
      "fs.writeFileSync(path.join(root, 'bin', 'tmux'), stub);",
      "fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);",
      "env.PATH = `${path.join(root, 'bin')}:${env.PATH}`;",
      "const creates = out.filter((c) => has(c, 'new-session'));",
    ].join('\n'),
  ],
]);

// The shape that broke the old guard: 'new-session' as a quoted argv element,
// inside a filter over command vectors, starting nothing.
const ASSERTS_ABOUT_ARGV = [
  "execFileSync('bb', ['-e', expr], { encoding: 'utf8' });",
  "const creates = ctx.commands.filter((c) => has(c, 'new-session'));",
  "assert.ok(!has(cmd, 'kill-server'), 'no repair may kill the server');",
].join('\n');

const REAPER = ["const { track } = require('./lib/fixtureReaper');", 'track(root);'].join('\n');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the tmux-reaper guard scanning the step-handler tree$/, (ctx) => {
    ctx.text = '';
    ctx.adoptsReaper = false;
  });

  scoped(/^a step file that evaluates resolved tmux commands as data and asserts about them$/, (ctx) => {
    ctx.text = ASSERTS_ABOUT_ARGV;
  });

  scoped(/^that file starts no tmux server$/, (ctx) => {
    // Asserted, not assumed: if the fixture changed to actually spawn one,
    // scenario 01 would pass while testing the opposite of its own name.
    assert.equal(startsTmuxServer(ctx.text), false,
      'the fixture for this scenario must genuinely start no server');
  });

  scoped(/^a step file that reaches a tmux server (.+)$/, (ctx, by) => {
    assert.ok(KNOWN_ROUTES.has(by), `unknown route "${by}" - the handlers know ${[...KNOWN_ROUTES.keys()]}`);
    ctx.text = KNOWN_ROUTES.get(by);
    ctx.route = by;
  });

  scoped(/^that file adopts no reaper$/, (ctx) => {
    ctx.adoptsReaper = false;
    assert.ok(!/fixtureReaper/.test(ctx.text), 'the fixture must not already adopt one');
  });

  scoped(/^the step handlers as committed$/, (ctx) => {
    ctx.wholeTree = true;
  });

  scoped(/^the guard scans it$/, (ctx) => {
    ctx.violation = findTmuxReaperViolation('fixture.js', ctx.text + (ctx.adoptsReaper ? `\n${REAPER}` : ''));
  });

  scoped(/^the guard scans the whole tree$/, (ctx) => {
    ctx.violations = [];
    ctx.adoptsWithoutHazard = [];
    for (const name of fs.readdirSync(STEPS_DIR)) {
      if (!name.endsWith('.js')) continue;
      const full = path.join(STEPS_DIR, name);
      if (!fs.statSync(full).isFile()) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (findTmuxReaperViolation(name, text)) ctx.violations.push(name);
      // Invariant 2's tree-level half. The reaper covers DETACHED PROCESS
      // TREES generally (nohup'd front-desk supervisor/bridge/bot as well as
      // tmux servers), so merely adopting it without a tmux hazard is
      // legitimate and common. What must not exist is an adoption justified BY
      // THIS GUARD in a file the guard does not scope - that is the coercion
      // bl958's "Required by extension/test/tmuxReaperGuard.test.js" comment
      // recorded, and the thing invariant 2 forbids.
      if (/tmuxReaperGuard/.test(text) && !startsTmuxServer(text)) ctx.adoptsWithoutHazard.push(name);
    }
  });

  scoped(/^the guard reports no violation for that file$/, (ctx) => {
    assert.equal(ctx.violation, null,
      'a file that only asserts about tmux argv starts no server, so it has nothing to reap');
  });

  scoped(/^the guard reports a violation for that file$/, (ctx) => {
    assert.ok(ctx.violation,
      `a file reaching tmux ${ctx.route} can cause a server to run and must stay in scope`);
  });

  scoped(/^the guard reports no violations$/, (ctx) => {
    assert.deepEqual(ctx.violations, [],
      `the committed tree must be clean: ${ctx.violations.join(', ')}`);
  });

  scoped(/^no step file adopts the reaper without starting a tmux server$/, (ctx) => {
    assert.deepEqual(ctx.adoptsWithoutHazard, [],
      `a reaper adopted to satisfy THIS guard, in a file it does not scope, is the coercion ` +
        `invariant 2 forbids: ${ctx.adoptsWithoutHazard.join(', ')}`);
  });
}

module.exports = { registerSteps };
