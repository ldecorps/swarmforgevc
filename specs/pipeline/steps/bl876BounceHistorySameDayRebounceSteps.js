'use strict';

// BL-876: step handlers for "A ticket's own bounce record keeps every
// distinct same-day bounce" - drives the REAL compiled record-bounce CLI
// (extension/out/tools/record-bounce.js) against a real fixture ticket,
// same posture as bl608BounceHistoryOnTicketSteps.js /
// bl635RecordBounceByRoleSteps.js: never reimplement the CLI's own
// merge/validation logic in JS.
//
// record-bounce has no --at flag, and this ticket's own Constraints section
// forbids adding one ("Neither CLI's flags change") - every bounce in a
// scenario is recorded within the same real wall-clock day, which is all
// the "same-day" behaviour under test actually needs. The feature file's
// literal "2026-08-07" text documents the real BL-819 incident date this
// ticket reproduces; no step enforces that literal date against the
// CLI-assigned `at`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const CLI = path.join(EXT_DIR, 'out', 'tools', 'record-bounce.js');

const FEATURE_NAME = "A ticket's own bounce record keeps every distinct same-day bounce";
const TICKET = 'BL-9876';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ticketYamlPath(root) {
  return path.join(root, 'backlog', 'active', `${TICKET}-fixture.yaml`);
}

function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl876-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(ticketYamlPath(root), `id: ${TICKET}\ntitle: "fixture ticket"\nstatus: active\nassigned_to: coder\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed fixture repo']);
  return root;
}

function readTicketYaml(ctx) {
  return fs.readFileSync(ticketYamlPath(ctx.target), 'utf8');
}

function bounceCount(yamlText) {
  const match = /bounce_count: (\d+)/.exec(yamlText);
  return match ? Number(match[1]) : 0;
}

function parseEntries(yamlText) {
  const lines = yamlText.split('\n').filter((l) => /^\s*- \{/.test(l));
  return lines.map((line) => {
    const match = /at: ([^,]+), by: ([^,]+), blamed: ([^,]+), class: ([^,]+), commit: ([^,]+), evidence: ([^}]+) \}/.exec(line);
    if (!match) {
      throw new Error(`unparsable bounce_history entry line: ${line}`);
    }
    const [, at, by, blamed, cls, commit] = match;
    return { at: at.trim(), by: by.trim(), blamed: blamed.trim(), failureClass: cls.trim(), commit: commit.trim() };
  });
}

function runCli(ctx, { cls, by, commit }) {
  ctx.evidenceSeq = (ctx.evidenceSeq || 0) + 1;
  const args = [
    '--ticket',
    TICKET,
    '--role',
    'coder',
    '--type',
    'defect',
    '--class',
    cls,
    '--commit',
    commit,
    '--by',
    by,
    '--evidence',
    `backlog/evidence/${TICKET}-bounce-${ctx.evidenceSeq}.md`,
  ];
  const out = execFileSync('node', [CLI, ...args], { cwd: ctx.target, encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  function step(pattern, handler) {
    registry.defineScoped(pattern, handler, FEATURE_NAME);
  }

  // ── Background / shared Given: seeds the fixture and records one bounce ──
  step(
    /^a bounce recorded against the ticket on \d{4}-\d{2}-\d{2} for failure class "([^"]+)" by "([^"]+)" citing commit "([^"]+)"$/,
    (ctx, cls, by, commit) => {
      ctx.target = ctx.target || mkFixtureRepo();
      ctx.result = runCli(ctx, { cls, by, commit });
    }
  );

  // ── When: records the bounce under test ──────────────────────────────────
  step(
    /^a bounce is recorded on \d{4}-\d{2}-\d{2} for failure class "([^"]+)" by "([^"]+)" citing commit "([^"]+)"$/,
    (ctx, cls, by, commit) => {
      ctx.result = runCli(ctx, { cls, by, commit });
    }
  );

  // ── Then / And ────────────────────────────────────────────────────────
  step(/^the ticket's own record carries a bounce history of size (\d+), oldest first$/, (ctx, size) => {
    const entries = parseEntries(readTicketYaml(ctx));
    if (entries.length !== Number(size)) {
      throw new Error(`expected ${size} bounce_history entries, got ${entries.length}: ${JSON.stringify(entries)}`);
    }
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].at < entries[i - 1].at) {
        throw new Error('expected bounce_history entries ordered oldest first');
      }
    }
  });

  step(/^the ticket's own record carries a bounce count of (\d+)$/, (ctx, count) => {
    const actual = bounceCount(readTicketYaml(ctx));
    if (actual !== Number(count)) {
      throw new Error(`expected bounce_count ${count}, got ${actual}`);
    }
  });
}

module.exports = { registerSteps };
