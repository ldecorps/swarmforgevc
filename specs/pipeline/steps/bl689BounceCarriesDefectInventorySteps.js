'use strict';

// BL-689: step handlers for "One bounce event carries its whole defect
// inventory" (specs/features/BL-689-bounce-carries-its-defect-inventory.feature).
// Every scenario shells out to the REAL compiled binary
// (extension/out/tools/record-bounce.js) against a real temp fixture repo -
// the recordBounceCli.test.js/bl635RecordBounceByRoleSteps.js/
// bl688RecordableSpecFailureClassesSteps.js pattern, never a reimplementation
// of the CLI's own validation/degrade logic in JS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');
const { readBounceRecords } = require(path.join(EXT_DIR, 'out', 'metrics', 'bounceStore'));
const { computeQaBounceTally, computeBounceTallyByBouncingRole, computeDefectsPerBounce } = require(path.join(EXT_DIR, 'out', 'quality', 'qaBounce'));
const { formatBounceLine } = require(path.join(EXT_DIR, 'out', 'tools', 'qa-bounce-line'));

const FEATURE_NAME = 'One bounce event carries its whole defect inventory';
const TICKET = 'BL-9689';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl689-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

// Distinct commits per call so the recorder never treats two calls in the
// same scenario as an idempotent re-write of the same bounce (the natural
// key includes commit).
let commitCounter = 0;
function nextCommit() {
  commitCounter += 1;
  return `bl689${String(commitCounter).padStart(5, '0')}`;
}

function buildInventoryItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `D${i + 1}`,
    class: 'behavior',
    blamed: 'coder',
    pointer: `fixture.ts:${i + 1} someFunction()`,
  }));
}

function runCli(ctx, args) {
  try {
    const out = execFileSync('node', [CLI, ...args], { cwd: ctx.target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.cliError = null;
    return JSON.parse(out);
  } catch (err) {
    ctx.cliError = err;
    ctx.cliStderr = err.stderr ? err.stderr.toString() : '';
    return null;
  }
}

function recordBounce(ctx, { items, blocked } = {}) {
  const args = ['--ticket', TICKET, '--role', 'coder', '--type', 'defect', '--class', 'behavior', '--commit', nextCommit(), '--by', 'architect'];
  if (items !== undefined) {
    args.push('--items', items);
  }
  if (blocked !== undefined) {
    args.push('--blocked', String(blocked));
  }
  ctx.result = runCli(ctx, args);
  return ctx.result;
}

function currentRecords(ctx) {
  return readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
}

function bounceLine(ctx) {
  const records = currentRecords(ctx);
  return formatBounceLine(computeBounceTallyByBouncingRole(records), computeQaBounceTally(records), computeDefectsPerBounce(records));
}

function registerSteps(registry) {
  function step(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  step(/^an empty bounce log$/, (ctx) => {
    ctx.target = mkFixtureRepo();
  });

  // ── bounce-carries-its-defect-inventory-01: an inventory of any size ────
  step(/^a bounce is recorded with an inventory of "(\d+)" defects and "(\d+)" blocked checks$/, (ctx, items, blocked) => {
    const result = recordBounce(ctx, { items: JSON.stringify(buildInventoryItems(Number(items))), blocked: Number(blocked) });
    if (!result || result.recorded !== true) {
      throw new Error(`expected the bounce to be recorded, got ${JSON.stringify(result)} (stderr: ${ctx.cliStderr || ''})`);
    }
  });

  // ── bounce-carries-its-defect-inventory-03: no inventory at all ─────────
  step(/^a bounce is recorded with no inventory$/, (ctx) => {
    const result = recordBounce(ctx);
    if (!result || result.recorded !== true) {
      throw new Error(`expected the bounce to be recorded, got ${JSON.stringify(result)} (stderr: ${ctx.cliStderr || ''})`);
    }
  });

  // ── bounce-carries-its-defect-inventory-04: a rejected inventory ────────
  step(/^a bounce is recorded with the inventory "(.*)"$/, (ctx, inventory) => {
    const result = recordBounce(ctx, { items: inventory });
    if (!result || result.recorded !== true) {
      throw new Error(`expected the bounce to still be recorded despite a rejected inventory, got ${JSON.stringify(result)} (stderr: ${ctx.cliStderr || ''})`);
    }
  });

  step(/^the bounce log holds "(\d+)" records$/, (ctx, count) => {
    const records = currentRecords(ctx);
    if (records.length !== Number(count)) {
      throw new Error(`expected ${count} records for ${TICKET}, got ${records.length}: ${JSON.stringify(records)}`);
    }
  });

  step(/^that record carries "(\d+)" inventory items and "(\d+)" blocked checks$/, (ctx, items, blocked) => {
    const records = currentRecords(ctx);
    const record = records[records.length - 1];
    if (!record.items || record.items.length !== Number(items)) {
      throw new Error(`expected ${items} inventory items, got: ${JSON.stringify(record.items)}`);
    }
    if (record.blocked !== Number(blocked)) {
      throw new Error(`expected blocked=${blocked}, got: ${record.blocked}`);
    }
  });

  step(/^that record carries no inventory field$/, (ctx) => {
    const records = currentRecords(ctx);
    const record = records[records.length - 1];
    if ('items' in record || 'blocked' in record) {
      throw new Error(`expected no inventory field on the record, got: ${JSON.stringify(record)}`);
    }
  });

  step(/^the recorder reports the degrade reason "([^"]*)"$/, (ctx, reason) => {
    if (!ctx.result || ctx.result.inventoryDegradeReason !== reason) {
      throw new Error(`expected degrade reason "${reason}", got: ${JSON.stringify(ctx.result)}`);
    }
  });

  step(/^the recorder exits zero$/, (ctx) => {
    if (ctx.cliError) {
      throw new Error(`expected the recorder to exit zero, got an error: ${ctx.cliStderr || ctx.cliError.message}`);
    }
  });

  // ── bounce-carries-its-defect-inventory-02/03/06: the briefing line ─────
  step(/^the briefing bounce line is printed$/, (ctx) => {
    ctx.bounceLine = bounceLine(ctx);
  });

  step(/^it reports a total of "(\d+)" bounces$/, (ctx, total) => {
    if (!new RegExp(`^Bounces: ${total} total\\b`).test(ctx.bounceLine)) {
      throw new Error(`expected the briefing line to report a total of ${total} bounces, got: ${ctx.bounceLine}`);
    }
  });

  step(/^it reports "(\d+)" defects for that bounce$/, (ctx, count) => {
    if (!new RegExp(`\\(${count}\\.0 defects/bounce\\)`).test(ctx.bounceLine)) {
      throw new Error(`expected the briefing line to report ${count} defects for that bounce, got: ${ctx.bounceLine}`);
    }
  });

  step(/^the briefing bounce line reports a total of "(\d+)" bounces$/, (ctx, total) => {
    const line = bounceLine(ctx);
    if (!new RegExp(`^Bounces: ${total} total\\b`).test(line)) {
      throw new Error(`expected the briefing line to report a total of ${total} bounces, got: ${line}`);
    }
  });

  step(/^it reports a defects-per-bounce figure of "([\d.]+)"$/, (ctx, figure) => {
    if (!ctx.bounceLine.includes(`(${figure} defects/bounce)`)) {
      throw new Error(`expected the briefing line to report a defects-per-bounce figure of ${figure}, got: ${ctx.bounceLine}`);
    }
  });

  // ── bounce-carries-its-defect-inventory-05: each item's own fields ──────
  step(/^inventory item "(\d+)" carries a class, a blamed role and a remediation pointer$/, (ctx, n) => {
    const records = currentRecords(ctx);
    const record = records[records.length - 1];
    const item = record.items && record.items[Number(n) - 1];
    if (!item || typeof item.class !== 'string' || typeof item.blamed !== 'string' || typeof item.pointer !== 'string') {
      throw new Error(`expected inventory item ${n} to carry class/blamed/pointer, got: ${JSON.stringify(item)}`);
    }
  });
}

module.exports = { registerSteps };
