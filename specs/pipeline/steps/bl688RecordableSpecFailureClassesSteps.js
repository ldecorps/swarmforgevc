'use strict';

// BL-688: step handlers for "every failure class the role prompts instruct
// is recordable". Every CLI-facing scenario shells out to the REAL compiled
// binary (extension/out/tools/record-bounce.js) against a real temp fixture
// repo - the recordBounceCli.test.js/bl635RecordBounceByRoleSteps.js pattern,
// never a reimplementation of the CLI's own validation/merge logic in JS.
// Scenario 05 (sibling deferral) drives the real compiled decideDisposition
// directly - a pure function, no fixture repo needed. Scenario 06 reads the
// real, already-shipped architect.prompt (BL-654) to ground "the class the
// architect prompt instructs" in the live file, not a copy of its text.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');
const { readBounceRecords } = require(path.join(EXT_DIR, 'out', 'metrics', 'bounceStore'));
const { computeQaBounceTally, computeBounceTallyByBouncingRole } = require(path.join(EXT_DIR, 'out', 'quality', 'qaBounce'));
const { formatBounceLine } = require(path.join(EXT_DIR, 'out', 'tools', 'qa-bounce-line'));
const { decideDisposition } = require(path.join(EXT_DIR, 'out', 'quality', 'siblingDeferral'));

const FEATURE_NAME = 'Every failure class the role prompts instruct is recordable';

const TICKET = 'BL-9688';
const EVIDENCE_PATH = `backlog/evidence/${TICKET}-fixture.md`;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ticketYamlPath(root) {
  return path.join(root, 'backlog', 'active', `${TICKET}-fixture.yaml`);
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl688-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(ticketYamlPath(root), `id: ${TICKET}\ntitle: "fixture"\nstatus: active\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

// Distinct commits per call so the recorder never treats two calls in the
// same scenario as an idempotent re-write of the same bounce (bounceNaturalKey
// includes commit).
let commitCounter = 0;
function nextCommit() {
  commitCounter += 1;
  return `bl688${String(commitCounter).padStart(5, '0')}`;
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

function recordBounce(ctx, cls) {
  return runCli(ctx, [
    '--ticket',
    TICKET,
    '--role',
    'coder',
    '--type',
    'defect',
    '--class',
    cls,
    '--commit',
    nextCommit(),
    '--by',
    'architect',
    '--evidence',
    EVIDENCE_PATH,
  ]);
}

function bounceHistoryEntryCount(root) {
  const yamlText = fs.readFileSync(ticketYamlPath(root), 'utf8');
  return (yamlText.match(/^\s*- \{ at:/gm) || []).length;
}

function registerSteps(registry) {
  function step(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  // ── Background: one pre-existing record, already-widened classes untouched ──
  step(/^a bounce log containing one record with failure class "([^"]*)" bounced by "([^"]*)"$/, (ctx, cls, by) => {
    ctx.target = mkFixtureRepo();
    ctx.result = runCli(ctx, ['--ticket', TICKET, '--role', 'coder', '--type', 'defect', '--class', cls, '--commit', nextCommit(), '--by', by, '--evidence', EVIDENCE_PATH]);
    if (!ctx.result || ctx.result.recorded !== true) {
      throw new Error(`background setup failed to record the seed bounce: ${JSON.stringify(ctx.result)} (stderr: ${ctx.cliStderr || ''})`);
    }
  });

  // ── recordable-spec-failure-classes-01/02/03/06: recording a bounce ─────
  step(/^a bounce is recorded with failure class "([^"]*)"$/, (ctx, cls) => {
    ctx.result = recordBounce(ctx, cls);
  });

  step(/^the recorder answers "(recorded|rejected)"$/, (ctx, outcome) => {
    if (outcome === 'recorded') {
      if (!ctx.result || ctx.result.recorded !== true) {
        throw new Error(`expected the recorder to answer recorded, got ${JSON.stringify(ctx.result)} (stderr: ${ctx.cliStderr || ''})`);
      }
    } else {
      if (ctx.result || !ctx.cliError) {
        throw new Error(`expected the recorder to reject the invocation, got result ${JSON.stringify(ctx.result)}`);
      }
    }
  });

  step(/^the bounce log holds "(\d+)" records$/, (ctx, count) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (records.length !== Number(count)) {
      throw new Error(`expected ${count} records for ${TICKET}, got ${records.length}: ${JSON.stringify(records)}`);
    }
  });

  // ── recordable-spec-failure-classes-02: rejected writes to neither store ──
  step(/^the recorder exits non-zero printing its usage$/, (ctx) => {
    if (!ctx.cliError) {
      throw new Error('expected the CLI invocation to exit non-zero');
    }
    if (!/^Usage: record-bounce\.js/.test(ctx.cliStderr)) {
      throw new Error(`expected usage output on stderr, got: ${ctx.cliStderr}`);
    }
  });

  step(/^no bounce_history entry is merged onto the ticket$/, (ctx) => {
    const count = bounceHistoryEntryCount(ctx.target);
    if (count !== 1) {
      throw new Error(`expected exactly 1 bounce_history entry (the Background seed only), got ${count}`);
    }
  });

  // ── recordable-spec-failure-classes-03/04: the briefing bounce line ─────
  step(/^the briefing bounce line is printed$/, (ctx) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    ctx.bounceLine = formatBounceLine(computeBounceTallyByBouncingRole(records), computeQaBounceTally(records));
  });

  step(/^it reports a total of "(\d+)" bounces$/, (ctx, total) => {
    const match = /Bounces: (\d+) total/.exec(ctx.bounceLine);
    if (!match || match[1] !== total) {
      throw new Error(`expected the briefing line to report a total of ${total} bounces, got: ${ctx.bounceLine}`);
    }
  });

  step(/^it attributes "(\d+)" bounce to bouncing role "([^"]*)"$/, (ctx, count, role) => {
    if (!new RegExp(`${role} x${count}\\b`).test(ctx.bounceLine)) {
      throw new Error(`expected the briefing line to attribute ${count} bounce(s) to ${role}, got: ${ctx.bounceLine}`);
    }
  });

  // ── recordable-spec-failure-classes-05: sibling deferral, widened class ──
  step(/^a sibling deferral for "([^"]*)" blocked by "([^"]*)" with failure class "([^"]*)"$/, (ctx, ticket, blockedBy, cls) => {
    ctx.dispositionTicket = ticket;
    ctx.openBlockers = [{ blockedBy, failureClass: cls, check: 'npm run acceptance:spec-gap-check', commit: 'abc1234567', at: '2026-07-27T10:00:00.000Z' }];
  });

  step(/^"([^"]*)" fails a check with failure class "([^"]*)"$/, (ctx, ticket, cls) => {
    if (ticket !== ctx.dispositionTicket) {
      throw new Error(`expected the failing ticket ${ticket} to match the deferred ticket ${ctx.dispositionTicket}`);
    }
    ctx.disposition = decideDisposition(ctx.openBlockers, { failureClass: cls, check: 'npm test' });
  });

  step(/^the disposition for "([^"]*)" is "([^"]*)"$/, (ctx, ticket, kind) => {
    if (ticket !== ctx.dispositionTicket) {
      throw new Error(`expected the queried ticket ${ticket} to match the deferred ticket ${ctx.dispositionTicket}`);
    }
    if (ctx.disposition.kind !== kind) {
      throw new Error(`expected disposition ${kind} for ${ticket}, got ${JSON.stringify(ctx.disposition)}`);
    }
  });

  // ── recordable-spec-failure-classes-06: architect prompt's own class ────
  step(/^the architect prompt instructs failure class "([^"]*)"$/, (ctx, cls) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt'), 'utf8');
    if (!text.includes(`\`${cls}\``)) {
      throw new Error(`expected architect.prompt to instruct failure class ${cls}`);
    }
    ctx.instructedClass = cls;
  });

  step(/^a bounce is recorded with that instructed class$/, (ctx) => {
    ctx.result = recordBounce(ctx, ctx.instructedClass);
  });

  step(/^the bounce log holds a record with failure class "([^"]*)"$/, (ctx, cls) => {
    const records = readBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (!records.some((r) => r.failureClass === cls)) {
      throw new Error(`expected a record with failureClass ${cls}, got ${JSON.stringify(records)}`);
    }
  });
}

module.exports = { registerSteps };
