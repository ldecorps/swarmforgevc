'use strict';

// BL-608: step handlers for "a ticket's own YAML record carries its bounce
// count and per-bounce reasons". Per the ticket's own explicit mandate,
// these SHELL OUT to the REAL compiled CLI
// (extension/out/tools/record-qa-bounce.js) against a real temp fixture
// repo - the recordQaBounceCli.test.js pattern - never a reimplementation
// of the merge logic in JS. The durable-aggregate assertions read the same
// compiled qaBounceStore/qaBounce modules the CLI itself writes through.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-qa-bounce.js');
const { readQaBounceRecords } = require(path.join(EXT_DIR, 'out', 'metrics', 'qaBounceStore'));
const { computeQaBounceTally } = require(path.join(EXT_DIR, 'out', 'quality', 'qaBounce'));

const TICKET = 'BL-9101';
const PRODUCING_ROLE = 'coder';
const FAILURE_CLASS = 'behavior';
const EVIDENCE = 'backlog/evidence/BL-9101-qa-bounce-20260724.md';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ticketYamlPath(root) {
  return path.join(root, 'backlog', 'active', `${TICKET}-fixture.yaml`);
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl608-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    ticketYamlPath(root),
    `id: ${TICKET}\ntitle: "fixture ticket"\nstatus: active\nassigned_to: coder\n`
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

function readTicketYaml(ctx) {
  return fs.readFileSync(ticketYamlPath(ctx.target), 'utf8');
}

function parseEntries(yamlText) {
  const lines = yamlText.split('\n').filter((l) => /^\s*- \{/.test(l));
  return lines.map((line) => {
    const match = /at: ([^,]+), by: ([^,]+), blamed: ([^,]+), class: ([^,]+), commit: ([^,]+), evidence: ([^}]+) \}/.exec(line);
    if (!match) {
      throw new Error(`unparsable bounce_history entry line: ${line}`);
    }
    const [, at, by, blamed, cls, commit, evidence] = match;
    return {
      at: at.trim(),
      by: by.trim(),
      blamed: blamed.trim(),
      failureClass: cls.trim(),
      commit: commit.trim(),
      evidence: evidence.trim(),
    };
  });
}

function bounceCount(yamlText) {
  const match = /bounce_count: (\d+)/.exec(yamlText);
  return match ? Number(match[1]) : 0;
}

function runCli(ctx, { commit, evidence = EVIDENCE, cls = FAILURE_CLASS } = {}) {
  const args = [
    '--ticket',
    TICKET,
    '--role',
    PRODUCING_ROLE,
    '--type',
    'feature',
    '--class',
    cls,
    '--commit',
    commit,
    '--by',
    'QA',
    '--evidence',
    evidence,
  ];
  const out = execFileSync('node', [CLI, ...args], { cwd: ctx.target, encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a ticket exists in the backlog with no recorded bounce history$/, (ctx) => {
    ctx.target = mkFixtureRepo();
  });

  // ── shared Given/When across scenarios ───────────────────────────────
  registry.define(/^a bounce has been recorded against the ticket$/, (ctx) => {
    ctx.result = runCli(ctx, { commit: 'abc1234567' });
  });

  registry.define(/^a bounce is recorded against the ticket$/, (ctx) => {
    ctx.result = runCli(ctx, { commit: 'abc1234567' });
  });

  registry.define(/^that same bounce is recorded again$/, (ctx) => {
    // Same date + failure class -> same natural key as the first recording,
    // even with a different commit hex - the idempotency case.
    ctx.result = runCli(ctx, { commit: 'deadbeef00' });
  });

  registry.define(/^a later distinct bounce is recorded against the ticket$/, (ctx) => {
    ctx.result = runCli(ctx, {
      commit: 'deadbeef00',
      cls: 'compile',
      evidence: 'backlog/evidence/BL-9101-qa-bounce-20260725.md',
    });
  });

  registry.define(/^a later distinct bounce has been recorded against the ticket$/, (ctx) => {
    ctx.result = runCli(ctx, {
      commit: 'deadbeef00',
      cls: 'compile',
      evidence: 'backlog/evidence/BL-9101-qa-bounce-20260725.md',
    });
  });

  registry.define(/^the ticket's own record cannot be written$/, (ctx) => {
    const ticketPath = ticketYamlPath(ctx.target);
    fs.chmodSync(ticketPath, 0o444);
    fs.chmodSync(path.dirname(ticketPath), 0o555);
    ctx.cleanupTicketPerms = () => {
      fs.chmodSync(path.dirname(ticketPath), 0o755);
      fs.chmodSync(ticketPath, 0o644);
    };
  });

  // ── Then / And ────────────────────────────────────────────────────────
  registry.define(/^the ticket's own record carries a bounce history of (\d+) entr(?:y|ies), oldest first$/, (ctx, count) => {
    const entries = parseEntries(readTicketYaml(ctx));
    if (entries.length !== Number(count)) {
      throw new Error(`expected ${count} bounce_history entries, got ${entries.length}: ${JSON.stringify(entries)}`);
    }
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].at < entries[i - 1].at) {
        throw new Error('expected bounce_history entries ordered oldest first');
      }
    }
  });

  registry.define(/^the ticket's own record carries a bounce count of (\d+)$/, (ctx, count) => {
    const text = readTicketYaml(ctx);
    if (bounceCount(text) !== Number(count)) {
      throw new Error(`expected bounce_count ${count}, got ${bounceCount(text)}`);
    }
  });

  registry.define(
    /^the newest entry states the bounce date, the bouncing role, the role held responsible, the failure class, the bounce commit, and the evidence file$/,
    (ctx) => {
      const entries = parseEntries(readTicketYaml(ctx));
      const newest = entries[entries.length - 1];
      if (!newest || !/^\d{4}-\d{2}-\d{2}$/.test(newest.at)) {
        throw new Error(`expected the newest entry to carry a yyyy-mm-dd date, got ${JSON.stringify(newest)}`);
      }
      if (newest.by !== 'QA') {
        throw new Error(`expected the newest entry's bouncing role to be QA, got ${newest.by}`);
      }
      if (newest.blamed !== PRODUCING_ROLE) {
        throw new Error(`expected the newest entry's blamed role to be ${PRODUCING_ROLE}, got ${newest.blamed}`);
      }
      if (newest.failureClass !== FAILURE_CLASS) {
        throw new Error(`expected the newest entry's failure class to be ${FAILURE_CLASS}, got ${newest.failureClass}`);
      }
      if (newest.commit !== 'abc1234567') {
        throw new Error(`expected the newest entry's commit to be abc1234567, got ${newest.commit}`);
      }
      if (newest.evidence !== EVIDENCE) {
        throw new Error(`expected the newest entry's evidence path to be ${EVIDENCE}, got ${newest.evidence}`);
      }
    }
  );

  registry.define(/^the durable aggregate bounce log gains a matching record$/, (ctx) => {
    const records = readQaBounceRecords(ctx.target).filter((r) => r.ticket === TICKET);
    if (records.length === 0) {
      throw new Error('expected the durable aggregate bounce log to gain a record for the ticket');
    }
  });

  registry.define(/^the aggregate bounce metrics report the same bounce$/, (ctx) => {
    const records = readQaBounceRecords(ctx.target);
    const tally = computeQaBounceTally(records);
    const coderTally = tally.byRole.find((r) => r.role === PRODUCING_ROLE);
    if (!coderTally || coderTally.count < 1) {
      throw new Error(`expected the aggregate tally to include the recorded bounce, got ${JSON.stringify(tally)}`);
    }
  });

  registry.define(/^the recording reports that the ticket record was not updated$/, (ctx) => {
    if (ctx.result.ticketRecordUpdated !== false) {
      throw new Error(`expected ticketRecordUpdated to be false, got ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.cleanupTicketPerms) {
      ctx.cleanupTicketPerms();
    }
  });

  registry.define(/^the recording does not fail$/, (ctx) => {
    if (!ctx.result || typeof ctx.result.recorded !== 'boolean') {
      throw new Error('expected the CLI invocation to complete and report a recorded boolean, not fail');
    }
  });

  registry.define(/^the ticket's own record is read without reading evidence files or the aggregate log$/, (ctx) => {
    ctx.ticketOnlyText = readTicketYaml(ctx);
  });

  registry.define(/^how many times the ticket bounced is answerable$/, (ctx) => {
    if (bounceCount(ctx.ticketOnlyText) !== 2) {
      throw new Error(`expected bounce_count 2 readable from the ticket record alone, got ${bounceCount(ctx.ticketOnlyText)}`);
    }
  });

  registry.define(/^why each bounce happened is answerable$/, (ctx) => {
    const entries = parseEntries(ctx.ticketOnlyText);
    if (entries.length !== 2) {
      throw new Error(`expected 2 bounce_history entries readable from the ticket record alone, got ${entries.length}`);
    }
    for (const entry of entries) {
      if (!entry.failureClass || !entry.blamed || !entry.evidence) {
        throw new Error(`expected every entry to carry a failure class, blamed role, and evidence path: ${JSON.stringify(entry)}`);
      }
    }
  });
}

module.exports = { registerSteps };
