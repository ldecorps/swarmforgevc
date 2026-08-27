'use strict';

// BL-761: step handlers for "a parcel reaches QA only with an acceptance
// contract that can actually run" - the third pre-QA gate finding beside
// ancestry and wiring (BL-531). Drives the REAL swarm_handoff.bb (and its
// real pre_qa_gate_lib.bb / pre_qa_gate_gather_lib.bb /
// acceptance_contract_gate_lib.bb / resolve_contract_steps.js call chain)
// against a real fixture git repo with a linked documenter worktree - same
// pattern bl531PreQaDurabilityWiringGateSteps.js uses for swarm_handoff.bb
// end-to-end coverage. SWARMFORGE_MAILBOX_ONLY=1 makes exit 0 mean
// "validated and queued" and exit 2 mean "refused by validate".
//
// Registered scoped to THIS feature's own name (the ticket's own
// constraint - the registry is global and first-match, and step text this
// generic would otherwise silently win for some other ticket's feature).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const FEATURE_NAME = 'a parcel reaches QA only with an acceptance contract that can actually run';
const TICKET_ID = 'BL-898';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

// ── fixture repo construction ──────────────────────────────────────────

const KNOWN_STEP_TEXT = 'the widget is known';
const OUTLINE_STEP_TEXT_TEMPLATE = 'a widget named <name>';

const FULL_REGISTRY_SOURCE = `'use strict';
function registerSteps(registry) {
  registry.define(/^${KNOWN_STEP_TEXT}$/, () => {});
}
module.exports = { registerSteps };
`;

const BROKEN_REGISTRY_SOURCE = `'use strict';
throw new Error('registry require() intentionally broken for BL-898 fixture');
`;

function writeStableTooling(ctx) {
  mkdirp(path.join(ctx.root, 'swarmforge', 'vendor'));
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps'), path.join(ctx.root, 'swarmforge', 'vendor', 'aps'), 'dir');
  mkdirp(path.join(ctx.root, 'specs', 'pipeline', 'scripts'));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js'),
    path.join(ctx.root, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js')
  );
}

function writeRoles(ctx) {
  const rows = [
    `documenter\tdocumenter\t${ctx.documenterWt}\tswarmforge-documenter\tDocumenter\tclaude\ttask\toff`,
    `QA\tQA\t${ctx.root}\tswarmforge-QA\tQa\tclaude\ttask\toff`,
    `cleaner\tcleaner\t${ctx.root}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\toff`,
    `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff`,
  ];
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

// declaredAcceptance: undefined -> no acceptance: field at all; otherwise the
// literal value written after "acceptance:" - a bare path, or "|\n  ..." for
// an inline block-scalar declaration.
function writeTicketYaml(ctx, declaredAcceptance) {
  let content = `id: ${TICKET_ID}\ntitle: pre-qa-gate acceptance-contract fixture ticket\nstatus: active\n`;
  if (declaredAcceptance !== undefined) {
    content += `acceptance: ${declaredAcceptance}\n`;
  }
  fs.writeFileSync(ctx.ticketYamlPath, content);
  commit(ctx.root, `update ${TICKET_ID} ticket yaml`);
  ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
}

// Writes the fixture's specs/pipeline (stepRegistry.js/runtime.js copied
// verbatim from this checkout's real files - the real matching logic runs,
// nothing is reimplemented) plus a caller-supplied steps/index.js and
// feature file, then commits. Updates ctx.citedCommit unless
// `pinCitedCommit` is set (BL-761 judged-at-the-cited-commit-04: a
// follow-up commit that must NOT move the cited commit forward).
function writeContractState(ctx, { stepsSource = FULL_REGISTRY_SOURCE, featureText, draftCompanionText, pinCitedCommit = false } = {}) {
  mkdirp(path.join(ctx.root, 'specs', 'pipeline', 'steps'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js'), path.join(ctx.root, 'specs', 'pipeline', 'stepRegistry.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'runtime.js'), path.join(ctx.root, 'specs', 'pipeline', 'runtime.js'));
  fs.writeFileSync(path.join(ctx.root, 'specs', 'pipeline', 'steps', 'index.js'), stepsSource);
  if (featureText !== undefined) {
    mkdirp(path.dirname(path.join(ctx.root, ctx.featurePath)));
    fs.writeFileSync(path.join(ctx.root, ctx.featurePath), featureText);
  }
  if (draftCompanionText !== undefined) {
    fs.writeFileSync(path.join(ctx.root, `${ctx.featurePath}.draft`), draftCompanionText);
  }
  commit(ctx.root, 'update contract state');
  if (!pinCitedCommit) {
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }
}

function featureOf(scenarioLines) {
  return `Feature: ${FEATURE_NAME}\n\n${scenarioLines}\n`;
}

function runSwarmHandoff(ctx, draftContent, { role = 'documenter', cwd = ctx.documenterWt } = {}) {
  const draftPath = path.join(cwd, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role, SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function draftForOtherParcel(kind, ctx) {
  if (kind === 'a git_handoff addressed to cleaner') {
    return `type: git_handoff\nto: cleaner\npriority: 50\ntask: ${TICKET_ID}-fix\ncommit: ${ctx.citedCommit}\n`;
  }
  if (kind === 'a note addressed to QA') {
    return 'type: note\nto: QA\npriority: 00\nmessage: checking in\n';
  }
  throw new Error(`unrecognized parcel kind: "${kind}"`);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(/^a ticket in backlog\/active\/ whose parcel commit is ready to forward to QA$/, (ctx) => {
    ctx.root = mkTmp('aps-bl761-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    git(ctx.root, ['checkout', '-q', '-b', 'main']);
    mkdirp(path.join(ctx.root, 'backlog', 'active'));
    mkdirp(path.join(ctx.root, '.swarmforge'));
    ctx.ticketYamlPath = path.join(ctx.root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`);
    ctx.featurePath = `specs/features/${TICKET_ID.toLowerCase()}-fixture.feature`;
    ctx.documenterWt = path.join(ctx.root, 'documenter-wt');
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'worktree', 'add', '-q', '-b', 'swarmforge-documenter', ctx.documenterWt]);
    writeRoles(ctx);
    writeStableTooling(ctx);
    writeTicketYaml(ctx, ctx.featurePath);
  }, FEATURE_NAME);

  // ── unrunnable-contract-refused-01 / gate-scope-06 / draft-companion-07 ─
  registry.defineScoped(/^the ticket's acceptance feature file (.+)$/, (ctx, state) => {
    if (state === 'has a registered handler for every step') {
      writeContractState(ctx, { featureText: featureOf(`  Scenario: covered\n    Given ${KNOWN_STEP_TEXT}\n`) });
    } else if (state === 'has one scenario whose step matches no registered handler') {
      writeContractState(ctx, {
        featureText: featureOf(
          `  Scenario: broken\n    Given an unknown step\n\n  Scenario: covered\n    Given ${KNOWN_STEP_TEXT}\n`
        ),
      });
    } else if (state === 'has a step that matches no handler in its last scenario') {
      writeContractState(ctx, {
        featureText: featureOf(
          `  Scenario: covered\n    Given ${KNOWN_STEP_TEXT}\n\n  Scenario: broken last\n    Given an unknown final step\n`
        ),
      });
    } else if (state === 'has a scenario whose step matches no registered handler') {
      // gate-scope-06: contract state is irrelevant here (the draft never
      // reaches an edge the gate arms on) - a broken contract proves the
      // scope check, not a clean one.
      writeContractState(ctx, { featureText: featureOf('  Scenario: broken\n    Given an unknown step\n') });
    } else if (
      state === 'has a Scenario Outline whose steps resolve for the first example row' ||
      state === 'uses that same step text'
    ) {
      // No-op: these narrate a combined fixture built by a LATER Given in
      // the same scenario (every-outline-row-resolved-02 /
      // feature-scoped-handler-does-not-leak-03) - both matched here first
      // because this pattern is registered before the more specific ones
      // below, and the registry is first-match.
    } else {
      throw new Error(`unrecognized contract state: "${state}"`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^a \.feature\.draft companion beside it holds a later slice's scenarios with no handlers$/, (ctx) => {
    fs.writeFileSync(
      path.join(ctx.root, `${ctx.featurePath}.draft`),
      featureOf('  Scenario: not built yet\n    Given a step nothing has ever registered\n')
    );
    // Deliberately untracked-by-the-check but present on disk beside the
    // real, already-committed, fully-covered feature file - amend the same
    // commit so it travels with the cited commit too (proving the gate
    // still ignores it even when it IS part of the cited tree).
    commit(ctx.root, 'add .feature.draft companion');
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }, FEATURE_NAME);

  // ── every-outline-row-resolved-02 ────────────────────────────────────
  registry.defineScoped(/^one later example row substitutes to a step no handler matches$/, (ctx) => {
    writeContractState(ctx, {
      stepsSource: `'use strict';
function registerSteps(registry) {
  registry.define(/^${OUTLINE_STEP_TEXT_TEMPLATE.replace('<name>', 'ok')}$/, () => {});
}
module.exports = { registerSteps };
`,
      featureText: featureOf(
        `  Scenario Outline: outline\n    Given a widget named <name>\n\n    Examples:\n      | name   |\n      | ok     |\n      | not-ok |\n`
      ),
    });
  }, FEATURE_NAME);

  // ── feature-scoped-handler-does-not-leak-03 ─────────────────────────
  registry.defineScoped(/^a step handler is registered scoped to a different feature's name$/, () => {
    // No-op: built together with the next Given below.
  }, FEATURE_NAME);

  registry.defineScoped(/^no unscoped handler matches that step text$/, (ctx) => {
    writeContractState(ctx, {
      stepsSource: `'use strict';
function registerSteps(registry) {
  registry.defineScoped(/^shared step text across tickets$/, () => {}, 'an unrelated fixture feature');
}
module.exports = { registerSteps };
`,
      featureText: featureOf('  Scenario: leaks scope\n    Given shared step text across tickets\n'),
    });
  }, FEATURE_NAME);

  // ── judged-at-the-cited-commit-04 ────────────────────────────────────
  registry.defineScoped(/^the cited commit registers a handler for every step of the feature file$/, (ctx) => {
    writeContractState(ctx, { featureText: featureOf(`  Scenario: covered\n    Given ${KNOWN_STEP_TEXT}\n`) });
  }, FEATURE_NAME);

  registry.defineScoped(/^the sender's working tree has since deleted that handler file$/, (ctx) => {
    fs.rmSync(path.join(ctx.root, 'specs', 'pipeline', 'steps', 'index.js'));
    writeContractState(ctx, { stepsSource: BROKEN_REGISTRY_SOURCE, pinCitedCommit: true });
    // ctx.citedCommit deliberately stays pinned to the earlier commit that
    // still contains the working handler - the gate must judge THAT
    // commit, never the working tree's current (broken) tip.
  }, FEATURE_NAME);

  // ── absent-contract-fails-closed-05 ─────────────────────────────────
  registry.defineScoped(/^the ticket's acceptance declaration (.+)$/, (ctx, declaration) => {
    if (declaration === 'is absent from the ticket') {
      writeTicketYaml(ctx, undefined);
    } else if (declaration === 'is inline Gherkin instead of a feature file path') {
      writeTicketYaml(ctx, `|\n  Feature: inline\n    Scenario: x\n      Given ${KNOWN_STEP_TEXT}`);
    } else if (declaration === 'names a feature file that does not exist at the commit') {
      writeTicketYaml(ctx, 'specs/features/does-not-exist-anywhere.feature');
    } else {
      throw new Error(`unrecognized declaration state: "${declaration}"`);
    }
  }, FEATURE_NAME);

  // ── registry-unreadable-fails-open-08 ────────────────────────────────
  registry.defineScoped(/^the step registry cannot be loaded at the cited commit$/, (ctx) => {
    writeContractState(ctx, {
      stepsSource: BROKEN_REGISTRY_SOURCE,
      featureText: featureOf(`  Scenario: irrelevant\n    Given ${KNOWN_STEP_TEXT}\n`),
    });
  }, FEATURE_NAME);

  // ── When ──────────────────────────────────────────────────────────────
  registry.defineScoped(/^the documenter forwards the parcel to QA$/, (ctx) => {
    const draft = `type: git_handoff\nto: QA\npriority: 00\ntask: ${TICKET_ID}-fix\ncommit: ${ctx.citedCommit}\n`;
    ctx.result = runSwarmHandoff(ctx, draft);
  }, FEATURE_NAME);

  registry.defineScoped(/^the sender forwards (.+)$/, (ctx, parcelKind) => {
    ctx.result = runSwarmHandoff(ctx, draftForOtherParcel(parcelKind, ctx), { role: 'cleaner', cwd: ctx.root });
  }, FEATURE_NAME);

  // ── Then ──────────────────────────────────────────────────────────────
  registry.defineScoped(/^the parcel is (forwarded|held back)$/, (ctx, outcome) => {
    const out = combinedOutput(ctx.result);
    if (outcome === 'forwarded') {
      if (ctx.result.status === 2) {
        throw new Error(`expected the parcel to be forwarded, but it was refused: ${out}`);
      }
      if (/PRE_QA_GATE_FAIL acceptance-contract/.test(out)) {
        throw new Error(`expected no acceptance-contract findings, got: ${out}`);
      }
    } else {
      if (ctx.result.status !== 2) {
        throw new Error(`expected the parcel to be held back (exit 2), got exit ${ctx.result.status}: ${out}`);
      }
      if (!/PRE_QA_GATE_FAIL acceptance-contract/.test(out)) {
        throw new Error(`expected an acceptance-contract finding, got: ${out}`);
      }
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the finding names the scenario, the example row, and the substituted step$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!out.includes('outline')) {
      throw new Error(`expected the finding to name the scenario "outline", got: ${out}`);
    }
    if (!out.includes('example row 2')) {
      throw new Error(`expected the finding to name example row 2 (the second/1-indexed row that fails), got: ${out}`);
    }
    if (!out.includes('a widget named not-ok')) {
      throw new Error(`expected the finding to name the substituted step text, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the finding names the acceptance declaration as unreadable$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (!/PRE_QA_GATE_FAIL acceptance-contract .*unreadable/.test(out)) {
      throw new Error(`expected the finding to name the declaration as unreadable, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^a warning names the check that could not run$/, (ctx) => {
    if (!new RegExp(`PRE_QA_GATE WARNING: acceptance-contract:${TICKET_ID}`).test(ctx.result.stderr)) {
      throw new Error(`expected an acceptance-contract warning naming ${TICKET_ID}, got stderr: ${ctx.result.stderr}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
