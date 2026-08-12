'use strict';

// BL-880: step handlers for "BL-880 stale acceptance pointer refused at
// first hop". Drives the REAL swarm_handoff.bb (and its real
// pre_qa_gate_gather_lib.bb / acceptance_pointer_gate_lib.bb call chain, plus
// the UNCHANGED pre_qa_gate_lib.bb / acceptance_contract_gate_lib.bb QA-edge
// chain for scenario 05) against a real fixture git repo - same end-to-end
// pattern bl531PreQaDurabilityWiringGateSteps.js /
// bl761AcceptanceContractMustBeRunnableSteps.js use for swarm_handoff.bb
// coverage. SWARMFORGE_MAILBOX_ONLY=1 makes exit 0 mean "validated and
// queued" and exit 2 mean "refused by validate".
//
// Registered scoped to THIS feature's own name - the registry is global and
// first-match, and step text this generic ("the send is refused"/"the send
// proceeds") would otherwise silently win for some other ticket's feature.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

const FEATURE_NAME = 'BL-880 stale acceptance pointer refused at first hop';
const TICKET_ID = 'BL-999';

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

function writeRoles(ctx) {
  const rows = [
    `coder\tcoder\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask\toff`,
    `cleaner\tcleaner\t${ctx.root}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\toff`,
    `documenter\tdocumenter\t${ctx.root}\tswarmforge-documenter\tDocumenter\tclaude\ttask\toff`,
    `QA\tQA\t${ctx.root}\tswarmforge-QA\tQa\tclaude\ttask\toff`,
    `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff`,
  ];
  fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

// declaredAcceptance: undefined -> no acceptance: field at all; '' -> a
// present-but-blank field; otherwise the literal value written after
// "acceptance:" - a bare repo-relative path.
function writeTicketYaml(ctx, declaredAcceptance) {
  let content = `id: ${TICKET_ID}\ntitle: BL-880 fixture ticket\nstatus: active\n`;
  if (declaredAcceptance !== undefined) {
    content += `acceptance: ${declaredAcceptance}\n`;
  }
  fs.writeFileSync(ctx.ticketYamlPath, content);
  commit(ctx.root, `update ${TICKET_ID} ticket yaml`);
  ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
}

function runSwarmHandoff(ctx, draftContent, { role } = {}) {
  const draftPath = path.join(ctx.root, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draftContent);
  const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: role, SWARMFORGE_MAILBOX_ONLY: '1' },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

// Corrupts the fixture's OWN tree object (never the commit object, which
// must keep resolving - swarm_handoff.bb's own canonical-commit step already
// guarantees that upstream of any gate ever running) so "the tree cannot be
// read" has a real, non-hand-waved trigger, distinct from "the path is
// simply missing".
function corruptTreeObject(root, fullCommitSha) {
  const treeSha = gitOut(root, ['rev-parse', `${fullCommitSha}^{tree}`]);
  const objFile = path.join(root, '.git', 'objects', treeSha.slice(0, 2), treeSha.slice(2));
  fs.renameSync(objFile, `${objFile}.bak`);
}

// Scenario 05 needs a declared contract that EXISTS (so the BL-880 early
// check it never reaches stays irrelevant) but whose one scenario resolves
// no step handler - the shape the UNCHANGED BL-761 QA-edge gate must still
// refuse. Mirrors writeAcceptanceContractFixture's shape (stable tooling:
// stepRegistry.js/runtime.js/resolve_contract_steps.js copied verbatim, the
// vendored APS parser symlinked) but with a step no registered handler
// matches, instead of a resolvable one.
function writeUnresolvableContractFixture(root, featurePath) {
  mkdirp(path.join(root, 'specs', 'pipeline', 'steps'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js'), path.join(root, 'specs', 'pipeline', 'stepRegistry.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'runtime.js'), path.join(root, 'specs', 'pipeline', 'runtime.js'));
  fs.writeFileSync(
    path.join(root, 'specs', 'pipeline', 'steps', 'index.js'),
    "'use strict';\nfunction registerSteps(registry) { registry.define(/^a step nothing registers$/, () => {}); }\nmodule.exports = { registerSteps };\n"
  );
  const featureFullPath = path.join(root, featurePath);
  mkdirp(path.dirname(featureFullPath));
  fs.writeFileSync(featureFullPath, 'Feature: BL-999 unresolvable fixture\n\n  Scenario: broken\n    Given an unknown step nothing resolves\n');
  mkdirp(path.join(root, 'swarmforge', 'vendor'));
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps'), path.join(root, 'swarmforge', 'vendor', 'aps'), 'dir');
  mkdirp(path.join(root, 'specs', 'pipeline', 'scripts'));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js'),
    path.join(root, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js')
  );
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(/^a repository with a ticket "([^"]+)" whose YAML declares a single-line acceptance: path$/, (ctx) => {
    ctx.root = mkTmp('aps-bl880-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirp(path.join(ctx.root, 'backlog', 'active'));
    mkdirp(path.join(ctx.root, '.swarmforge'));
    ctx.ticketYamlPath = path.join(ctx.root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`);
    ctx.featurePath = 'specs/features/bl999-fixture.feature';
    writeRoles(ctx);
    writeTicketYaml(ctx, ctx.featurePath);
  }, FEATURE_NAME);

  registry.defineScoped(/^a git_handoff draft for ticket "([^"]+)" citing a commit$/, () => {
    // No-op: the cited commit is ctx.citedCommit, already pinned by the
    // Background's writeTicketYaml above and re-pinned by whichever Given
    // below shapes this scenario's own fixture state.
  }, FEATURE_NAME);

  // ── stale-acceptance-refused-first-hop-01: Background's declared path is
  //    never written to the fixture tree at all - nothing more to arrange ──
  registry.defineScoped(/^the declared acceptance path does not exist at the cited commit$/, () => {}, FEATURE_NAME);

  // ── stale-acceptance-refused-first-hop-02 ────────────────────────────
  registry.defineScoped(/^the declared acceptance path exists at the cited commit$/, (ctx) => {
    mkdirp(path.dirname(path.join(ctx.root, ctx.featurePath)));
    fs.writeFileSync(path.join(ctx.root, ctx.featurePath), 'Feature: fixture\n  Scenario: covered\n    Given a known step\n');
    commit(ctx.root, 'add acceptance feature file');
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }, FEATURE_NAME);

  registry.defineScoped(/^the declared acceptance path ends in "\.feature\.draft"$/, (ctx) => {
    // Renames (never re-creates) the file the previous Given just wrote, so
    // its existence at the cited commit survives the parked-draft shape
    // unchanged, and rewrites the ticket's own pointer to match.
    fs.renameSync(path.join(ctx.root, ctx.featurePath), path.join(ctx.root, `${ctx.featurePath}.draft`));
    ctx.featurePath = `${ctx.featurePath}.draft`;
    writeTicketYaml(ctx, ctx.featurePath);
  }, FEATURE_NAME);

  registry.defineScoped(/^the parked draft's steps have no registry handlers$/, () => {
    // No-op: this narrates exactly the legitimate BL-233 parked state this
    // gate must never police - existence is all it ever checks, and no
    // step-registry material exists in this fixture at all.
  }, FEATURE_NAME);

  // ── stale-acceptance-refused-first-hop-03 ────────────────────────────
  registry.defineScoped(/^the ticket's acceptance declaration is blank$/, (ctx) => {
    writeTicketYaml(ctx, '');
  }, FEATURE_NAME);

  // ── stale-acceptance-refused-first-hop-04 ────────────────────────────
  registry.defineScoped(/^the repository tree at the cited commit cannot be read$/, (ctx) => {
    corruptTreeObject(ctx.root, gitOut(ctx.root, ['rev-parse', 'HEAD']));
  }, FEATURE_NAME);

  // ── stale-acceptance-refused-first-hop-05 ────────────────────────────
  registry.defineScoped(/^its scenarios contain a step no registry handler resolves$/, (ctx) => {
    writeUnresolvableContractFixture(ctx.root, ctx.featurePath);
    commit(ctx.root, 'wire an unresolvable acceptance contract');
    ctx.citedCommit = gitOut(ctx.root, ['rev-parse', '--short=10', 'HEAD']);
  }, FEATURE_NAME);

  // ── recipient / When ─────────────────────────────────────────────────
  registry.defineScoped(/^the draft's recipient is "([^"]+)"$/, (ctx, recipient) => {
    ctx.recipient = recipient;
  }, FEATURE_NAME);

  registry.defineScoped(/^the sender runs swarm_handoff on the draft$/, (ctx) => {
    const draft = `type: git_handoff\nto: ${ctx.recipient}\npriority: 50\ntask: ${TICKET_ID}-fix\ncommit: ${ctx.citedCommit}\n`;
    // A hop's SENDER is the role immediately before its recipient in the
    // pipeline chain - only the identity that matters here (documenter is
    // the one real sender that ever addresses QA); every pre-QA scenario in
    // this feature addresses cleaner, so any non-QA sender role is fine.
    const role = ctx.recipient === 'QA' ? 'documenter' : 'coder';
    ctx.result = runSwarmHandoff(ctx, draft, { role });
  }, FEATURE_NAME);

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the send is refused$/, (ctx) => {
    if (ctx.result.status !== 2) {
      throw new Error(`expected the send to be refused (exit 2), got exit ${ctx.result.status}: ${combinedOutput(ctx.result)}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the send proceeds$/, (ctx) => {
    if (ctx.result.status === 2) {
      throw new Error(`expected the send to proceed, but it was refused: ${combinedOutput(ctx.result)}`);
    }
    if (/PRE_QA_GATE_FAIL acceptance-pointer/.test(combinedOutput(ctx.result))) {
      throw new Error(`expected no acceptance-pointer findings, got: ${combinedOutput(ctx.result)}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the refusal names ticket "([^"]+)", the declared acceptance path, and the cited commit$/, (ctx, ticketId) => {
    const out = combinedOutput(ctx.result);
    const prefix = `PRE_QA_GATE_FAIL acceptance-pointer ${ticketId}`;
    if (!out.includes(prefix)) {
      throw new Error(`expected an acceptance-pointer refusal naming ${ticketId}, got: ${out}`);
    }
    if (!out.includes(ctx.featurePath)) {
      throw new Error(`expected the refusal to name the declared path "${ctx.featurePath}", got: ${out}`);
    }
    if (!out.includes(ctx.citedCommit)) {
      throw new Error(`expected the refusal to name the cited commit ${ctx.citedCommit}, got: ${out}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^a warning names the infrastructure failure$/, (ctx) => {
    if (!/ACCEPTANCE_POINTER_GATE WARNING: acceptance-pointer:/.test(ctx.result.stderr)) {
      throw new Error(`expected an acceptance-pointer infrastructure warning, got stderr: ${ctx.result.stderr}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the send is refused with an acceptance-contract finding$/, (ctx) => {
    const out = combinedOutput(ctx.result);
    if (ctx.result.status !== 2) {
      throw new Error(`expected the send to be refused (exit 2), got exit ${ctx.result.status}: ${out}`);
    }
    if (!/PRE_QA_GATE_FAIL acceptance-contract/.test(out)) {
      throw new Error(`expected an acceptance-contract finding, got: ${out}`);
    }
    if (/PRE_QA_GATE_FAIL acceptance-pointer/.test(out)) {
      throw new Error(`expected NO acceptance-pointer finding at the QA edge (that check is pre-QA only), got: ${out}`);
    }
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
