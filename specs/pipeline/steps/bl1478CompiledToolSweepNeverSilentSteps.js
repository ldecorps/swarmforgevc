'use strict';

// BL-1478: step handlers for "A compiled-tool sweep that fails is logged,
// never silent". Drives the REAL daemon-cycle-guard-lib/run-compiled-tool!
// (swarmforge/scripts/daemon_cycle_guard_lib.bb) through
// bl1478CompiledToolSweepCli.bb - never a reimplementation. The Background's
// "shell and log seams injected" is the CLI's fake sh-fn and captured log-fn,
// never a real subprocess or a real daemon log file.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl1478CompiledToolSweepCli.bb');

const FEATURE = 'BL-1478 A compiled-tool sweep that fails is logged, never silent';

// BL-1478 hardening (BL-113 Gherkin mutation survivors m1-m6): the Outline's
// Given and Then steps both interpolate the SAME Examples column value
// (<exit>, <stderr>), so an assertion built by recomposing those same
// captured params (`exit=${exit} ${stderr}`) can never diverge from what the
// mutated row actually drove into the CLI - any mutation of an Examples cell
// changes stimulus and expectation identically, killing nothing (survived
// every value-level mutant but one, and that one only failed on an
// unrelated regex non-match). Pinning the expected detail here, independent
// of the Then step's own text capture, is the engineering rules' explicit
// KNOWN_VALUES requirement for Scenario Outline handlers - a lookup miss
// (mutated exit) or a literal mismatch (mutated stderr) now fails loud.
const KNOWN_VALUES = {
  1: 'exit=1 SyntaxError: Unexpected token in JSON',
  124: 'exit=124 wait bound exceeded',
  127: 'exit=127 spawn failed: ENOENT',
};

function runSweep(ctx) {
  const input = JSON.stringify({
    sweep: ctx.sweep,
    exit: ctx.exit,
    stdout: ctx.stdout || '',
    stderr: ctx.stderr || '',
  });
  const result = spawnSync('bb', [CLI], { input, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `expected the CLI to exit 0, got ${result.status}: ${result.stderr}`);
  ctx.logged = JSON.parse(result.stdout.trim().split('\n').pop()).logged;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a sweep that runs a compiled tool through the shared helper with its shell and log seams injected$/, (ctx) => {
    ctx.sweep = 'resource-sample';
  });

  scoped(/^the tool exits (\d+) with stderr "([^"]*)"$/, (ctx, exit, stderr) => {
    ctx.exit = Number(exit);
    ctx.stderr = stderr;
  });

  scoped(/^the tool exits (\d+) with stdout "([^"]*)"$/, (ctx, exit, stdout) => {
    ctx.exit = Number(exit);
    ctx.stdout = stdout;
  });

  scoped(/^the tool exits (\d+) with a stderr of (\d+) lines$/, (ctx, exit, lineCount) => {
    ctx.exit = Number(exit);
    const lines = [];
    for (let i = 0; i < Number(lineCount); i += 1) {
      lines.push(`stack frame ${i}`);
    }
    ctx.stderr = lines.join('\n');
    ctx.firstStderrLine = lines[0];
  });

  scoped(/^the sweep runs$/, (ctx) => {
    runSweep(ctx);
  });

  scoped(/^exactly one log line names the sweep, exit (\d+) and "([^"]*)"$/, (ctx, exit) => {
    assert.equal(ctx.logged.length, 1, `expected exactly one log line, got ${JSON.stringify(ctx.logged)}`);
    const [event, detail] = ctx.logged[0];
    assert.equal(event, `${ctx.sweep}-failed`, `expected the event to name the sweep, got ${event}`);
    const known = KNOWN_VALUES[Number(exit)];
    assert.ok(known, `exit ${exit} is not a known Outline row - KNOWN_VALUES needs a matching entry`);
    assert.equal(detail, known, `expected the pinned detail ${JSON.stringify(known)}, got ${JSON.stringify(detail)}`);
  });

  scoped(/^the log carries the tool's stdout line and no failure line$/, (ctx) => {
    assert.equal(ctx.logged.length, 1, `expected exactly one log line, got ${JSON.stringify(ctx.logged)}`);
    const [event, detail] = ctx.logged[0];
    assert.equal(event, ctx.sweep, `expected the event to be the tool's own key, got ${event}`);
    assert.equal(detail, ctx.stdout, `expected the detail to be the tool's stdout, got ${detail}`);
  });

  scoped(/^the failure line carries only the first stderr line$/, (ctx) => {
    assert.equal(ctx.logged.length, 1, `expected exactly one log line, got ${JSON.stringify(ctx.logged)}`);
    const [, detail] = ctx.logged[0];
    assert.equal(detail, `exit=${ctx.exit} ${ctx.firstStderrLine}`, `expected only the first stderr line, got ${detail}`);
    assert.ok(!detail.includes('\n'), 'expected no newline in the failure line');
  });
}

module.exports = { registerSteps };
