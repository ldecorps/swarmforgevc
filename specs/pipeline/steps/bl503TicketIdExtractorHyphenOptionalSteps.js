'use strict';

// BL-503: step handlers for "the pipeline board and dispatch-gap sweep
// resolve a ticket id from a task header that omits the prefix hyphen".
//
// Scenario 01's step text ("a ticket id is extracted from the task header
// ...") is BYTE-IDENTICAL to BL-504's own scenario (the TS metrics sibling
// of this defect) - registered here with registry.defineScoped (BL-425),
// bound to THIS feature's own name, so it resolves to THIS handler (which
// drives both real .bb extractors, per this ticket's own non-behavioral
// gate: "BOTH .bb extractors must satisfy scenario 01") only for BL-503's
// own scenarios, without colliding with or touching BL-504's separate
// unscoped registration (which drives the TS extractor only).
//
// Scenario 02/03 drive the REAL pipeline_stage_cli.bb and the REAL
// chase-sweep-lib dispatch-gap functions against fs fixtures - mirrors
// bl488HeldTicketIdResolvesWithoutLeadingTokenSteps.js's and
// dispatch_gap_test_runner.bb's own real-CLI/real-fs boundaries, never
// reimplementing the matching/reconciliation logic here.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PIPELINE_STAGE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_lib.bb');
const CHASE_SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const PIPELINE_STAGE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');

const FEATURE_NAME =
  'the pipeline board and dispatch-gap sweep resolve a ticket id from a task header that omits the prefix hyphen';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl503-ticket-id-'));
}

// Loads the real lib file and calls the named fully-qualified fn on text,
// passed as a command-line arg (never spliced into the Clojure source
// text) so arbitrary Examples-table text can never break out of the
// generated form.
function bbExtract(libFile, nsFn, text) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(load-file (nth *command-line-args* 0)) (println (or (${nsFn} (nth *command-line-args* 1)) "NIL"))`,
      '--',
      libFile,
      text,
    ],
    { encoding: 'utf8' }
  ).trim();
  return out === 'NIL' ? null : out;
}

function bbDispatchGapItems(activeDir, newDir) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      '(load-file (nth *command-line-args* 0)) (require (quote [cheshire.core :as json])) ' +
        '(println (json/generate-string (chase-sweep-lib/dispatch-gap-items (nth *command-line-args* 1) [(nth *command-line-args* 2)])))',
      '--',
      CHASE_SWEEP_LIB,
      activeDir,
      newDir,
    ],
    { encoding: 'utf8' }
  ).trim();
  return JSON.parse(out);
}

// The feature's own Scenario Outline load-bearing rule: validate the
// "resolved" Examples column against an explicit KNOWN_VALUES lookup, never
// a bare passthrough (engineering.prompt's Scenario Outline rule).
const KNOWN_VALUES = {
  'BL-493': (actual) => actual === 'BL-493',
  'GH-77': (actual) => actual === 'GH-77',
  NONE: (actual) => actual === null,
};

function writeRolesTsv(root, role) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const lines = [
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `${role}\t${role}\t${root}/wt-${role}\tswarmforge-${role}\t${role}\tclaude\ttask`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
    '',
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n'));
}

function writeBacklogActive(root, id, assignedTo) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  const assignedLine = assignedTo ? `\nassigned_to: ${assignedTo}` : '';
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture"${assignedLine}\n`);
}

function writeHandoff(dir, role, task) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '10_fixture.handoff'),
    `from: coordinator\nto: ${role}\ntype: git_handoff\npriority: 10\ntask: ${task}\ncommit: 0123456789\n\nbody\n`
  );
}

function report(root) {
  return JSON.parse(execFileSync('bb', [PIPELINE_STAGE_CLI, root, 'report'], { encoding: 'utf8' }));
}

function registerSteps(registry) {
  // ── Scenario 01 (scoped to this feature only - see header comment) ────
  registry.defineScoped(
    /^a ticket id is extracted from the task header "([^"]*)"$/,
    (ctx, task) => {
      ctx.pipelineStage = bbExtract(PIPELINE_STAGE_LIB, 'pipeline-stage-lib/extract-ticket-id', task);
      ctx.chaseSweep = bbExtract(CHASE_SWEEP_LIB, 'chase-sweep-lib/extract-ticket-id', task);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it resolves to "([^"]*)"$/,
    (ctx, resolved) => {
      const check = KNOWN_VALUES[resolved];
      if (!check) {
        throw new Error(`BL-503: unknown resolved value "${resolved}" - not in KNOWN_VALUES`);
      }
      if (!check(ctx.pipelineStage)) {
        throw new Error(`pipeline_stage_lib/extract-ticket-id: expected "${resolved}", got ${JSON.stringify(ctx.pipelineStage)}`);
      }
      if (!check(ctx.chaseSweep)) {
        throw new Error(`chase_sweep_lib/extract-ticket-id: expected "${resolved}", got ${JSON.stringify(ctx.chaseSweep)}`);
      }
    },
    FEATURE_NAME
  );

  // ── Scenario 02: pipeline board ────────────────────────────────────────
  registry.define(/^active ticket "([^"]+)" is held at "([^"]+)" with task header "([^"]*)"$/, (ctx, ticketId, role, task) => {
    ctx.root = mkTmp();
    writeRolesTsv(ctx.root, role);
    writeBacklogActive(ctx.root, ticketId);
    writeHandoff(path.join(ctx.root, `wt-${role}`, '.swarmforge', 'handoffs', 'inbox', 'in_process'), role, task);
  });

  registry.define(/^the pipeline stage sync runs$/, (ctx) => {
    ctx.stageMap = report(ctx.root);
  });

  registry.define(/^the board shows "([^"]+)" at "([^"]+)"$/, (ctx, ticketId, role) => {
    if (ctx.stageMap[ticketId] !== role) {
      throw new Error(`expected "${ticketId}" at "${role}", got stage map: ${JSON.stringify(ctx.stageMap)}`);
    }
  });

  // ── Scenario 03: dispatch-gap sweep ────────────────────────────────────
  registry.define(/^active ticket "([^"]+)" has a handoff whose task header is "([^"]*)"$/, (ctx, ticketId, task) => {
    ctx.root = mkTmp();
    writeBacklogActive(ctx.root, ticketId, 'coder');
    ctx.activeDir = path.join(ctx.root, 'backlog', 'active');
    ctx.newDir = path.join(ctx.root, 'coder-new');
    writeHandoff(ctx.newDir, 'coder', task);
  });

  registry.define(/^the dispatch-gap sweep runs$/, (ctx) => {
    ctx.gaps = bbDispatchGapItems(ctx.activeDir, ctx.newDir);
  });

  registry.define(/^"([^"]+)" is counted as dispatched and is not auto-routed as a gap$/, (ctx, ticketId) => {
    if (ctx.gaps.some((g) => g.id === ticketId)) {
      throw new Error(`expected "${ticketId}" NOT to be a dispatch gap, got: ${JSON.stringify(ctx.gaps)}`);
    }
  });
}

module.exports = { registerSteps };
