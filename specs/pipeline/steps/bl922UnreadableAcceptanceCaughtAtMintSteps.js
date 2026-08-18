'use strict';

// BL-922: a block-scalar acceptance: field hiding a real feature-file
// pointer is caught by the specifier's hygiene gate (and the repo-wide
// audit sharing its lib) at mint time, instead of five pipeline stages
// later at the documenter->QA hop. Drives the REAL
// specifier_backlog_hygiene_gate.bb CLI and backlog_epic_milestone_audit.bb
// against fixture ticket YAML files, plus the real repo-wide audit for
// scenario 04 (the ticket's own acceptance requires the LIVE backlog be
// clean, per its approval_context).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');
const AUDIT_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'backlog_epic_milestone_audit.bb');
const FEATURE = 'an unreadable acceptance declaration is caught where it is written';

const INDICATOR_MAP = {
  pipe: '|',
  'pipe-strip': '|-',
  'pipe-keep': '|+',
  fold: '>',
  'fold-strip': '>-',
};

function ensureState(ctx) {
  if (!ctx.bl922) {
    ctx.bl922 = { tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl922-hygiene-')), tickets: [] };
  }
  return ctx.bl922;
}

function baseTicketLines(id) {
  return [`id: ${id}`, 'title: fixture ticket', 'type: feature', 'epic: fixture-epic', 'milestone: M8'];
}

function writeTicket(ctx, id, acceptanceLines) {
  const st = ensureState(ctx);
  const lines = [...baseTicketLines(id), ...acceptanceLines, 'priority: 5', ''];
  const filePath = path.join(st.tmpDir, `${id}.yaml`);
  fs.writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

function runGate(paths) {
  const result = spawnSync('bb', [GATE_BB, ...paths], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function registerSteps(registry) {
  registry.defineScoped(/^a backlog ticket YAML carrying an id and a type$/, (ctx) => {
    ensureState(ctx).ticketId = 'BL-991';
  }, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────
  registry.defineScoped(/^the ticket's acceptance field uses the block-scalar indicator "([^"]+)"$/, (ctx, indicatorName) => {
    const st = ensureState(ctx);
    const indicator = INDICATOR_MAP[indicatorName];
    if (!indicator) throw new Error(`unknown block-scalar indicator name: ${indicatorName}`);
    st.acceptanceLine = `acceptance: ${indicator}`;
  }, FEATURE);

  registry.defineScoped(/^the block body names a feature file under specs\/features$/, (ctx) => {
    const st = ensureState(ctx);
    st.featurePath = `specs/features/${st.ticketId}-fixture.feature`;
    st.bodyLines = [`  ${st.featurePath}`, '  (some prose about the contract)'];
  }, FEATURE);

  registry.defineScoped(/^the specifier hygiene gate runs on the ticket$/, (ctx) => {
    const st = ensureState(ctx);
    const filePath = writeTicket(ctx, st.ticketId, [st.acceptanceLine, ...(st.bodyLines || [])]);
    st.result = runGate([filePath]);
    st.singleTicketPath = filePath;
  }, FEATURE);

  registry.defineScoped(/^the gate reports an unreadable-acceptance violation naming the ticket id and its path$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.result.out.includes('UNREADABLE-ACCEPTANCE')) {
      throw new Error(`expected an UNREADABLE-ACCEPTANCE line, got:\n${st.result.out}`);
    }
    if (!st.result.out.includes(st.ticketId)) {
      throw new Error(`violation output does not name the ticket id ${st.ticketId}:\n${st.result.out}`);
    }
    if (!st.result.out.includes(st.featurePath)) {
      throw new Error(`violation output does not name the hidden feature path ${st.featurePath}:\n${st.result.out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the gate exits non-zero$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.result.status === 0) {
      throw new Error(`expected non-zero exit, got 0:\n${st.result.out}`);
    }
  }, FEATURE);

  // ── Scenario 02 ───────────────────────────────────────────────────────
  registry.defineScoped(/^the ticket's acceptance field has the shape "([^"]+)"$/, (ctx, shape) => {
    const st = ensureState(ctx);
    st.featurePath = null;
    switch (shape) {
      case 'single-line-pointer':
        st.acceptanceLine = `acceptance: specs/features/${st.ticketId}-fixture.feature`;
        st.bodyLines = [];
        break;
      case 'block-scalar-naming-no-feature-file':
        st.acceptanceLine = 'acceptance: |';
        st.bodyLines = ['  Specifier writes the scenarios. Minimum:', '  - covers the happy path'];
        break;
      case 'absent':
        st.acceptanceLine = null;
        st.bodyLines = [];
        break;
      default:
        throw new Error(`unknown acceptance shape: ${shape}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the gate reports no unreadable-acceptance violation$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.result.out.includes('UNREADABLE-ACCEPTANCE')) {
      throw new Error(`expected no UNREADABLE-ACCEPTANCE line, got:\n${st.result.out}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the gate exits zero$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.result.status !== 0) {
      throw new Error(`expected exit 0, got ${st.result.status}:\n${st.result.out}`);
    }
  }, FEATURE);

  // ── Scenario 03 ───────────────────────────────────────────────────────
  registry.defineScoped(/^two tickets whose acceptance fields both hide a feature-file pointer behind a block scalar$/, (ctx) => {
    const st = ensureState(ctx);
    st.twoTicketIds = ['BL-981', 'BL-982'];
    st.twoTicketPaths = st.twoTicketIds.map((id) =>
      writeTicket(ctx, id, ['acceptance: |', `  specs/features/${id}-fixture.feature`, '  (prose)'])
    );
  }, FEATURE);

  registry.defineScoped(/^the specifier hygiene gate runs on both tickets in one invocation$/, (ctx) => {
    const st = ensureState(ctx);
    st.result = runGate(st.twoTicketPaths);
  }, FEATURE);

  registry.defineScoped(/^the gate reports an unreadable-acceptance violation naming the ticket id and its path for each of the two$/, (ctx) => {
    const st = ensureState(ctx);
    for (const id of st.twoTicketIds) {
      if (!st.result.out.includes(id)) {
        throw new Error(`violation output does not name ticket ${id}:\n${st.result.out}`);
      }
    }
    const count = (st.result.out.match(/UNREADABLE-ACCEPTANCE/g) || []).length;
    if (count < 2) {
      throw new Error(`expected 2 UNREADABLE-ACCEPTANCE lines (one per ticket), got ${count}:\n${st.result.out}`);
    }
  }, FEATURE);

  // ── Scenario 04 ───────────────────────────────────────────────────────
  registry.defineScoped(/^the repo-wide backlog audit$/, (ctx) => {
    ensureState(ctx).auditNote = true;
  }, FEATURE);

  registry.defineScoped(/^it scans every ticket in backlog\/active and backlog\/paused$/, (ctx) => {
    const st = ensureState(ctx);
    const result = spawnSync('bb', [AUDIT_BB, REPO_ROOT], { encoding: 'utf8' });
    st.auditResult = { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
  }, FEATURE);

  registry.defineScoped(/^it reports zero unreadable-acceptance violations$/, (ctx) => {
    const st = ensureState(ctx);
    if (!/unreadable acceptance \(block scalar hiding a feature pointer\): 0\b/.test(st.auditResult.out)) {
      throw new Error(`expected zero unreadable-acceptance violations against the live backlog, got:\n${st.auditResult.out}`);
    }
    fs.rmSync(st.tmpDir, { recursive: true, force: true });
  }, FEATURE);
}

module.exports = { registerSteps };
