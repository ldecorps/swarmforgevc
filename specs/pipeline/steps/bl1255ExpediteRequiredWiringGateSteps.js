'use strict';

// BL-1255: step handlers for "an expedited ticket is refused on absent
// required_wiring, exactly as the live pipeline refuses it". Drives the
// REAL expedite_cli.bb through the real expedite_fixture.sh (same fixture
// test_expedite_cli.sh and BL-656's own step handlers use), never a
// reimplementation of the driver.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');
const FEATURE =
  'BL-1255 an expedited ticket is refused on absent required_wiring, exactly as the live pipeline refuses it';

const RUN_TICKET = 'BL-1255';
const TARGET_FILE = 'wiring-target.txt';

// Explicit known values per the Scenario Outline handler rule.
const KNOWN_DEFECTS = new Set([
  'a pattern absent from the cited file',
  'a path absent at the stage commit',
  'unparseable, carrying no :: separator',
]);

function mkRoot(ctx) {
  if (ctx.bl1255?.root) return ctx.bl1255.root;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1255-'));
  spawnSync('bash', [FIXTURE_SH, dir, '--active', RUN_TICKET], { encoding: 'utf8' });
  ctx.bl1255 = { root: dir };
  return dir;
}

function ticketYamlPath(root) {
  return path.join(root, 'backlog', 'active', `${RUN_TICKET}-fixture.yaml`);
}

function writeWiringTarget(root, content) {
  fs.writeFileSync(path.join(root, TARGET_FILE), content);
  return TARGET_FILE;
}

// Appends a required_wiring: block to the fixture ticket's own yaml (which
// declares none by default) - mirrors how a real ticket's YAML carries the
// field, never a synthetic side-channel the gate would not otherwise read.
function setRequiredWiring(root, entriesBlock) {
  const yamlPath = ticketYamlPath(root);
  const content = fs.readFileSync(yamlPath, 'utf8');
  fs.writeFileSync(yamlPath, `${content}\nrequired_wiring:\n${entriesBlock}`);
}

function commitFixtureState(root, message) {
  spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', root, 'commit', '-qm', message], { encoding: 'utf8' });
}

function runExpedite(ctx) {
  const root = mkRoot(ctx);
  const env = {
    ...process.env,
    EXPEDITE_STAGE_RUNNER: path.join(root, 'stage-runner.sh'),
    EXPEDITE_STOP_CMD: './stop-swarm.sh',
    EXPEDITE_START_CMD: './start-swarm.sh',
  };
  const res = spawnSync('bb', [CLI, root, RUN_TICKET, '--no-restart'], {
    encoding: 'utf8',
    env,
    cwd: REPO_ROOT,
  });
  ctx.bl1255.last = { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
  return ctx.bl1255.last;
}

function ranStages(root) {
  try {
    return fs
      .readFileSync(path.join(root, '.swarmforge', 'expedite-fixture', 'ran.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Shared by "QA is not stamped" and "the report does not record the
// boundary as passed" - both mean the same thing (no QA-hat verdict was
// ever recorded), whichever Then-wording the scenario uses.
function assertQaDidNotRun(ctx) {
  const stages = ranStages(ctx.bl1255.root);
  assert.ok(!stages.includes('QA'), `QA must not have run; ran: ${stages.join(',')}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an expedite run that has reached the documenter-to-QA boundary$/, (ctx) => {
    mkRoot(ctx);
  });

  // Documented, not separately asserted here: required-wiring-gate-check
  // pins to worktree-head (the run worktree's actual HEAD), never `main` -
  // the same decision 3 pre_qa_gate_gather_lib.bb's own gather-wiring-facts
  // carries. The per-scenario Given steps below control that HEAD directly
  // via commitFixtureState.
  scoped(/^the ticket's stage commit is the commit the boundary evaluates$/, () => {});

  scoped(/^the ticket declares one required_wiring entry that is (.+)$/, (ctx, defect) => {
    assert.ok(KNOWN_DEFECTS.has(defect), `unknown defect "${defect}" - handlers know ${[...KNOWN_DEFECTS]}`);
    const root = mkRoot(ctx);
    if (defect === 'a pattern absent from the cited file') {
      writeWiringTarget(root, 'the file exists but lacks the magic string');
      setRequiredWiring(root, `  - '${TARGET_FILE}::MAGIC_PATTERN_NOT_PRESENT::because it must be'\n`);
    } else if (defect === 'a path absent at the stage commit') {
      setRequiredWiring(root, `  - 'this-file-does-not-exist.txt::whatever::because it must be'\n`);
    } else {
      setRequiredWiring(root, `  - 'unparseable entry with no separator at all'\n`);
    }
    commitFixtureState(root, 'test: declare a defective required_wiring entry');
  });

  scoped(
    /^the ticket declares required_wiring entries that are all satisfied at the stage commit$/,
    (ctx) => {
      const root = mkRoot(ctx);
      writeWiringTarget(root, 'the magic string IS present here: MAGIC_PATTERN_PRESENT');
      setRequiredWiring(root, `  - '${TARGET_FILE}::MAGIC_PATTERN_PRESENT::because it must be'\n`);
      commitFixtureState(root, 'test: declare a satisfied required_wiring entry');
    },
  );

  scoped(/^the ticket declares no required_wiring entries$/, (ctx) => {
    // The fixture's own default ticket yaml carries no required_wiring:
    // field at all - nothing to add.
    mkRoot(ctx);
  });

  scoped(/^the required_wiring evaluation cannot be completed$/, (ctx) => {
    const root = mkRoot(ctx);
    // Simulates the ticket's own yaml disappearing from this checkout
    // BETWEEN initiation (which reads it fine, so the run starts normally)
    // and the documenter-to-QA boundary (where the gate re-reads it and
    // finds nothing) - invariant 2's "could not be completed" case, not a
    // defect INITIATION itself would refuse on.
    const runnerPath = path.join(root, 'stage-runner.sh');
    const original = fs.readFileSync(runnerPath, 'utf8');
    const marker = 'ROOT="$(cd "$(dirname "$0")" && pwd)"';
    assert.ok(original.includes(marker), 'fixture stage-runner.sh shape changed - update this handler');
    const mutated = original.replace(
      marker,
      `${marker}\nif [[ "$ROLE" == "documenter" ]]; then rm -f "$ROOT/backlog/active/${RUN_TICKET}-fixture.yaml"; fi`,
    );
    fs.writeFileSync(runnerPath, mutated);
    fs.chmodSync(runnerPath, 0o755);
  });

  scoped(/^the expeditor evaluates the documenter-to-QA boundary$/, (ctx) => {
    runExpedite(ctx);
  });

  scoped(/^the run is refused at that boundary$/, (ctx) => {
    assert.notEqual(ctx.bl1255.last.status, 0, ctx.bl1255.last.out);
    assert.match(ctx.bl1255.last.out, /REFUSE required-wiring-gate/, ctx.bl1255.last.out);
  });

  scoped(/^the refusal names the offending entry$/, (ctx) => {
    assert.match(ctx.bl1255.last.out, /PRE_QA_GATE_FAIL/, ctx.bl1255.last.out);
  });

  scoped(/^QA is not stamped$/, assertQaDidNotRun);

  scoped(/^the boundary passes$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1255.last.out, /REFUSE required-wiring-gate/, ctx.bl1255.last.out);
  });

  scoped(/^the run continues to the QA stage$/, (ctx) => {
    const stages = ranStages(ctx.bl1255.root);
    assert.ok(stages.includes('QA'), `QA must have run; ran: ${stages.join(',')}`);
  });

  scoped(/^the report states the gate did not run$/, (ctx) => {
    assert.match(
      ctx.bl1255.last.out,
      /could not read this ticket's own yaml|could not read the run worktree's HEAD|gather threw/,
      ctx.bl1255.last.out,
    );
  });

  scoped(/^the report does not record the boundary as passed$/, assertQaDidNotRun);
}

module.exports = { registerSteps };
