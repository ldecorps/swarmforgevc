'use strict';

// BL-1095: retire type: bug from the Article 3.2.4 expedite lane + mint gate.
// Drives the REAL promotion_gates_cli.bb select and specifier_backlog_hygiene_gate.bb.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const FEATURE = 'The Article 3.2.4 expedite lane recognises only `type: defect`';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');
const PROMO_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');

const KNOWN_TYPES = new Set(['defect', 'bug', 'feature']);
const KNOWN_SEVERITIES = new Set(['high', 'critical', 'none']);
const KNOWN_RANKINGS = new Set(['ranked', 'not ranked']);
const KNOWN_VERDICTS = new Set(['refuses', 'accepts']);
const KNOWN_ROWS = new Set([
  'defect|high|ranked',
  'defect|critical|ranked',
  'bug|high|not ranked',
  'bug|critical|not ranked',
  'defect|none|not ranked',
  'feature|high|not ranked',
]);

function processEnvAllowlist(extra) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

function ensureState(ctx) {
  if (!ctx.bl1095) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1095-'));
    fs.mkdirSync(path.join(tmpDir, 'backlog', 'paused'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'backlog', 'done'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'published'), { recursive: true });
    ctx.bl1095 = { tmpDir, pausedFiles: [], doneFiles: [] };
  }
  return ctx.bl1095;
}

function cleanup(ctx) {
  const st = ctx.bl1095;
  if (!st || !st.tmpDir) return;
  fs.rmSync(st.tmpDir, { recursive: true, force: true });
  st.tmpDir = null;
}

function writeTicket(ctx, { id, type, severity, priority, folder }) {
  const st = ensureState(ctx);
  const dir = path.join(st.tmpDir, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.yaml`);
  const lines = [
    `id: ${id}`,
    'title: fixture',
    `type: ${type}`,
    'epic: fixture-epic',
    'milestone: M8',
    ...(severity && severity !== 'none' ? [`severity: ${severity}`] : []),
    `priority: ${priority ?? 50}`,
    'human_approval: approved',
    'assigned_to:',
    '',
  ];
  fs.writeFileSync(filePath, lines.join('\n'));
  if (folder === 'paused') st.pausedFiles.push(filePath);
  if (folder === 'done') st.doneFiles.push(filePath);
  return filePath;
}

function runSelect(ctx, files) {
  const st = ensureState(ctx);
  const result = spawnSync('bb', [PROMO_CLI, 'select', st.tmpDir, '5', ...files], {
    encoding: 'utf8',
    env: processEnvAllowlist(),
  });
  return {
    status: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
    winner: (result.stdout || '').trim(),
  };
}

function runGate(ctx, filePath) {
  const st = ensureState(ctx);
  const result = spawnSync('bb', [GATE_BB, filePath], {
    encoding: 'utf8',
    env: processEnvAllowlist({
      BACKLOG_HYGIENE_ROOT: path.join(st.tmpDir, 'backlog'),
      BACKLOG_HYGIENE_PUBLISHED_ROOT: path.join(st.tmpDir, 'published'),
      BACKLOG_HYGIENE_REPO_ROOT: REPO_ROOT,
    }),
  });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the coordinator is ranking promotion candidates from backlog\/paused\/$/, (ctx) => {
    ensureState(ctx);
  });

  scoped(/^a paused candidate of type (\S+) with severity (\S+)$/, (ctx, type, severity) => {
    assert.ok(KNOWN_TYPES.has(type), `unknown <type>: ${type}`);
    assert.ok(KNOWN_SEVERITIES.has(severity), `unknown <severity>: ${severity}`);
    const st = ensureState(ctx);
    st.type = type;
    st.severity = severity;
    st.candidatePath = writeTicket(ctx, {
      id: 'BL-91095',
      type,
      severity,
      priority: 50,
      folder: 'paused',
    });
    // Better numeric priority but never expedited — so "ahead of every
    // non-expedited" is observable when the subject wins.
    writeTicket(ctx, {
      id: 'BL-91096',
      type: 'feature',
      severity: 'none',
      priority: 1,
      folder: 'paused',
    });
  });

  scoped(/^the expedite lane classifies the candidate$/, (ctx) => {
    const st = ensureState(ctx);
    st.select = runSelect(ctx, st.pausedFiles);
  });

  scoped(/^the candidate is (ranked|not ranked) ahead of every non-expedited ticket$/, (ctx, ranking) => {
    assert.ok(KNOWN_RANKINGS.has(ranking), `unknown <ranking>: ${ranking}`);
    const st = ensureState(ctx);
    const row = `${st.type}|${st.severity}|${ranking}`;
    assert.ok(KNOWN_ROWS.has(row), `unknown Outline row: ${row}`);
    try {
      if (ranking === 'ranked') {
        assert.ok(
          st.select.winner.includes('BL-91095'),
          `expected expedited winner, got: ${st.select.winner}\n${st.select.out}`
        );
      } else {
        assert.ok(
          !st.select.winner.includes('BL-91095'),
          `retired/non-expedited must not win: ${st.select.winner}\n${st.select.out}`
        );
      }
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a ticket of type bug with severity high exists in backlog\/done\/$/, (ctx) => {
    writeTicket(ctx, {
      id: 'BL-91097',
      type: 'bug',
      severity: 'high',
      priority: 1,
      folder: 'done',
    });
    writeTicket(ctx, {
      id: 'BL-91098',
      type: 'feature',
      severity: 'none',
      priority: 20,
      folder: 'paused',
    });
  });

  scoped(/^the coordinator ranks promotion candidates$/, (ctx) => {
    const st = ensureState(ctx);
    // Production ranks backlog/paused/*.yaml only — done/ is never passed.
    st.select = runSelect(ctx, st.pausedFiles);
  });

  scoped(/^that ticket is not among the candidates$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.ok(!st.select.winner.includes('BL-91097'), st.select.out);
      assert.ok(!st.select.out.includes('BL-91097'), st.select.out);
      assert.equal(st.pausedFiles.length, 1);
      assert.ok(st.pausedFiles[0].includes('BL-91098'));
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^a ticket YAML carrying type (\S+) and a valid epic$/, (ctx, type) => {
    assert.ok(type === 'bug' || type === 'defect', `unknown mint type: ${type}`);
    const st = ensureState(ctx);
    st.mintType = type;
    st.mintPath = writeTicket(ctx, {
      id: 'BL-91099',
      type,
      severity: 'high',
      priority: 5,
      folder: 'paused',
    });
  });

  scoped(/^the specifier backlog hygiene gate runs on it$/, (ctx) => {
    const st = ensureState(ctx);
    st.gate = runGate(ctx, st.mintPath);
  });

  scoped(/^the gate (refuses|accepts) the ticket$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown <verdict>: ${verdict}`);
    const st = ensureState(ctx);
    try {
      if (verdict === 'refuses') {
        assert.notEqual(st.gate.status, 0, st.gate.out);
        assert.match(st.gate.out, /RETIRED-TICKET-TYPE/);
        assert.match(st.gate.out, /bug/);
      } else {
        assert.equal(st.gate.status, 0, st.gate.out);
        assert.doesNotMatch(st.gate.out, /RETIRED-TICKET-TYPE/);
      }
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
