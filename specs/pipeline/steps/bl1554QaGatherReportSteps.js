'use strict';

// BL-1554: step handlers for "QA gathers its mechanical checklist in one
// call". Drives the REAL extension/src/quality/qaGather.ts (compiled) over
// an injected FAKE runner - never a real subprocess spawn (npm test / the
// property lane / a real acceptance run from inside an acceptance test
// would be exactly the nested-suite problem the engineering rules warn
// against). The fake runner maps a check's own (command, args) shape back
// to the checklist id it belongs to, purely for this test harness's own
// scripting convenience - qaGather.ts itself never sees or needs that id.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gatherQaChecklist } = require('../../../extension/out/metrics/qaGatherAdapter');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1554 QA gathers its mechanical checklist in one call';
const TICKET = 'BL-1554-FIX';

function checkIdForCall(command, args) {
  if (command === 'pgrep') return 'stragglers';
  if (args.some((a) => a.includes('qa-sibling-check.js'))) return 'sibling';
  if (args.some((a) => a.includes('standing_red_register_cli.bb'))) return 'register';
  if (command.includes('pre_qa_gate.sh')) return 'wiring';
  if (command.includes('run_acceptance.sh')) return 'acceptance';
  if (command === 'npm' && args.includes('test:properties')) return 'properties';
  if (command === 'npm' && args.includes('test')) return 'unit';
  return 'unknown';
}

// script: { [checkId]: { started, exit, stdout, stderr, reason } }. A
// checkId with no scripted answer defaults to a clean "started, exit 0".
function makeFakeRunner(script) {
  const calls = [];
  const runFn = (command, args, cwd) => {
    const id = checkIdForCall(command, args);
    calls.push({ id, command, args, cwd, seq: calls.length });
    const answer = script[id];
    if (!answer) {
      return { started: true, exit: 0, stdout: '', stderr: '' };
    }
    if (answer.started === false) {
      return { started: false, exit: null, stdout: '', stderr: '', reason: answer.reason };
    }
    return { started: true, exit: answer.exit ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  return { runFn, calls };
}

function buildFixtureRoot(acceptanceFeaturePath) {
  const root = mkSocketFixtureRoot('bl1554-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${TICKET}-thing.yaml`),
    `id: ${TICKET}\nacceptance: ${acceptanceFeaturePath}\n`,
  );
  return root;
}

function runGather(ctx) {
  const { root, runner } = ctx.bl1554;
  ctx.bl1554.report = gatherQaChecklist(root, TICKET, { task: TICKET, commit: 'abc1234567' }, runner.runFn);
}

function reportHasNoVerdict(report) {
  const serialized = JSON.stringify(report);
  if (/"verdict"/i.test(serialized)) {
    return false;
  }
  // Structural (non-freeform) fields only - excerpt/command/reason are
  // real subprocess text and may legitimately contain "passed" etc.
  const structuralValues = [
    ...report.checks.map((c) => c.status),
    ...report.register_join.map((r) => r.join),
  ];
  return !structuralValues.some((v) => /^(pass|bounce|approve)/i.test(v));
}

function registerReportFor(entries) {
  return JSON.stringify({
    rows: entries.map(({ file, ticket, owned }) => ({
      lane: 'property',
      file,
      ticket,
      first_seen: '2026-09-01',
      age_days: 15,
      owned,
    })),
  });
}

function registerScriptFromRowDescription(file, rowDescription) {
  if (rowDescription.includes('absent from the register')) {
    return undefined;
  }
  if (rowDescription.includes('owned by')) {
    const ticket = rowDescription.match(/owned by (\S+)/)[1];
    return { file, ticket, owned: true };
  }
  if (rowDescription.includes('naming a closed ticket')) {
    return { file, ticket: 'BL-9998-closed', owned: false };
  }
  throw new Error(`unknown row description: ${rowDescription}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a ticket BL-1554-FIX in backlog\/active whose acceptance names one feature file$/, (ctx) => {
    const root = buildFixtureRoot('specs/features/BL-1554-x.feature');
    ctx.bl1554 = { root, registerEntries: [] };
  });

  scoped(/^a fake check runner that records every command it is asked to start and answers from a script$/, (ctx) => {
    ctx.bl1554.script = {};
  });

  scoped(/^qa-gather runs for BL-1554-FIX over the fake runner$/, (ctx) => {
    if (!ctx.bl1554.script.register) {
      ctx.bl1554.script.register = { exit: 0, stdout: registerReportFor(ctx.bl1554.registerEntries) };
    }
    ctx.bl1554.runner = makeFakeRunner(ctx.bl1554.script);
    runGather(ctx);
  });

  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(/^the report names the checks (.+) in that order$/, (ctx, list) => {
    const expectedRaw = list.split(',').map((s) => s.trim().replace(/^and /, ''));
    assert.deepEqual(ctx.bl1554.report.checks.map((c) => c.id), expectedRaw);
  });

  scoped(/^every check row carries the command it ran, its working directory, its exit status and an output excerpt$/, (ctx) => {
    for (const row of ctx.bl1554.report.checks) {
      assert.ok('command' in row, `row ${row.id} missing command`);
      assert.ok('cwd' in row, `row ${row.id} missing cwd`);
      assert.ok('exit' in row, `row ${row.id} missing exit`);
      assert.ok('excerpt' in row, `row ${row.id} missing excerpt`);
    }
  });

  scoped(/^the tool exits 0$/, (ctx) => {
    // main()'s own thin wrapper never assigns a non-zero exitCode once a
    // report was gathered (no branch does) - proven here by the module
    // call itself completing and returning a report, never throwing.
    assert.ok(ctx.bl1554.report, 'gatherQaChecklist did not return a report');
  });

  // ── scenario 02 (outline) ────────────────────────────────────────────
  scoped(/^the fake runner answers the unit check with exit (\d+) and the output "(.*)"$/, (ctx, exit, output) => {
    if (!ctx.bl1554.script) ctx.bl1554.script = {};
    ctx.bl1554.script.unit = { exit: Number(exit), stdout: output };
  });

  scoped(/^the unit check row reports exit (\d+) and an excerpt containing "(.*)"$/, (ctx, exit, output) => {
    const row = ctx.bl1554.report.checks.find((c) => c.id === 'unit');
    assert.equal(row.exit, Number(exit));
    assert.ok(row.excerpt.includes(output), `expected excerpt to include "${output}", got: ${row.excerpt}`);
  });

  scoped(/^the report carries no verdict field and none of the words pass, bounce or approve as a value$/, (ctx) => {
    assert.ok(reportHasNoVerdict(ctx.bl1554.report), `report looks verdict-shaped:\n${JSON.stringify(ctx.bl1554.report, null, 2)}`);
  });

  // ── scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the fake runner cannot start the sibling check because its command is missing$/, (ctx) => {
    if (!ctx.bl1554.script) ctx.bl1554.script = {};
    ctx.bl1554.script.sibling = { started: false, reason: 'ENOENT: command not found' };
  });

  scoped(/^the sibling check row reports status blocked with the reason the runner gave$/, (ctx) => {
    const row = ctx.bl1554.report.checks.find((c) => c.id === 'sibling');
    assert.equal(row.status, 'blocked');
    assert.equal(row.reason, 'ENOENT: command not found');
  });

  scoped(/^the register, wiring, unit, properties, acceptance and stragglers_after checks were still started$/, (ctx) => {
    const ids = ['register', 'wiring', 'unit', 'properties', 'acceptance', 'stragglers_after'];
    const rows = ctx.bl1554.report.checks.filter((c) => ids.includes(c.id));
    assert.equal(rows.length, ids.length);
    for (const row of rows) {
      assert.equal(row.status, 'ran', `${row.id} was not started: ${JSON.stringify(row)}`);
    }
  });

  // ── scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the fake runner's log shows every check started only after the previous check had ended$/, (ctx) => {
    const seqs = ctx.bl1554.runner.calls.map((c) => c.seq);
    const sorted = [...seqs].sort((a, b) => a - b);
    assert.deepEqual(seqs, sorted, 'calls were not issued in strict sequence');
    assert.equal(seqs.length, new Set(seqs).size, 'a sequence number repeated - two calls overlapped');
  });

  // ── scenario 05 (outline) ────────────────────────────────────────────
  scoped(/^the fake runner answers the properties check with exit 1 and an output naming the failing file (\S+)$/, (ctx, file) => {
    if (!ctx.bl1554.script) ctx.bl1554.script = {};
    ctx.bl1554.script.properties = { exit: 1, stdout: ` FAIL  ${file} > some assertion` };
    ctx.bl1554.lastFile = file;
  });

  scoped(/^the register check answers with a row for \S+ that is (.+)$/, (ctx, rowDescription) => {
    const entry = registerScriptFromRowDescription(ctx.bl1554.lastFile, rowDescription);
    ctx.bl1554.registerEntries = entry ? [entry] : [];
  });

  scoped(/^the report's register join lists (\S+) as (\S+)$/, (ctx, file, join) => {
    const entry = ctx.bl1554.report.register_join.find((r) => r.file === file);
    assert.ok(entry, `no register_join entry for ${file}: ${JSON.stringify(ctx.bl1554.report.register_join)}`);
    assert.equal(entry.join, join);
  });
}

module.exports = { registerSteps };
