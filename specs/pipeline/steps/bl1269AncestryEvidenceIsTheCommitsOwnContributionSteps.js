'use strict';

// BL-1269: step handlers for "pre-QA ancestry evidence is a candidate
// commit's own contribution, not its parents'". Scenarios 01-03 drive
// pre_qa_gate_gather_lib.bb's findings-for-git-handoff directly (via a real
// git fixture, real merge commits) for fast, structured (JSON) assertions
// on the decision; scenario 04 drives the REAL swarm_handoff.sh end to end,
// the same pattern bl531PreQaDurabilityWiringGateSteps.js already
// establishes for this exact call chain - never a reimplementation of the
// wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');
const GATHER_LIB = path.join(SCRIPTS_DIR, 'pre_qa_gate_gather_lib.bb');
const FEATURE = "pre-QA ancestry evidence is a candidate commit's own contribution, not its parents'";
const { writeAcceptanceContractFixture } = require('../../../extension/test/helpers/acceptanceContractFixture');

const ACCEPTANCE_FEATURE_PATH = 'specs/features/bl1269-fixture.feature';

const TICKET_ID = 'BL-19269';

const KNOWN_CANDIDATES = new Set(['a merge of main into a branch', 'an ordinary single-parent commit']);
const KNOWN_ORIGINS = new Set([
  "a parent's contribution only",
  "the merge's own combined diff",
  'its own diff',
]);
const OUTLINE_VERDICT = {
  'a merge of main into a branch|a parent\'s contribution only': 'warning',
  "a merge of main into a branch|the merge's own combined diff": 'finding',
  'an ordinary single-parent commit|its own diff': 'finding',
};

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, [...GIT_ID, 'commit', '-q', '-m', message]);
}

function writeRoles({ root, coderWt }) {
  const rows = [
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\toff`,
    `QA\tQA\t${root}\tswarmforge-QA\tQa\tclaude\ttask\toff`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff`,
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
}

function mkRepo(ctx) {
  if (ctx.bl1269?.root) return;
  const root = mkTmp('bl1269-');
  git(root, ['init', '-q']);
  git(root, [...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'init']);
  git(root, ['checkout', '-q', '-b', 'main']);
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, '.swarmforge'));
  // Linked worktrees (coder-wt, sender-wt-*) live INSIDE root's own working
  // tree. Git tracks a nested worktree as a gitlink-like entry whose
  // pointer changes every time that worktree's own HEAD moves - left
  // untracked, every later `git add -A` on root would silently pick up
  // "coder-wt" (and its own tree) as a spuriously-changed path on every
  // root-side commit, polluting every diff this fixture measures. Ignore
  // both patterns before the FIRST `git add -A` ever runs.
  fs.writeFileSync(path.join(root, '.gitignore'), 'coder-wt/\nsender-wt-*/\n');
  // BL-761: the acceptance-contract gate shares this same findings-for-
  // git-handoff entry point - give the fixture ticket a resolvable
  // contract so that gate stays silent and this suite tests ancestry only.
  writeAcceptanceContractFixture(root, { featurePath: ACCEPTANCE_FEATURE_PATH, featureTitle: 'BL-1269 fixture contract' });
  const ticketYamlPath = path.join(root, 'backlog', 'active', `${TICKET_ID}-fixture.yaml`);
  fs.writeFileSync(ticketYamlPath, `id: ${TICKET_ID}\ntitle: fixture ticket\nstatus: active\nacceptance: ${ACCEPTANCE_FEATURE_PATH}\n`);
  git(root, ['add', '-A']);
  gitCommit(root, 'seed ticket yaml');
  const coderWt = path.join(root, 'coder-wt');
  git(root, ['worktree', 'add', '-q', '-b', 'swarmforge-coder', coderWt]);
  ctx.bl1269 = { root, coderWt, ticketYamlPath };
  writeRoles(ctx.bl1269);
}

// Builds the "merge of main into a branch" candidate. `conflict` controls
// whether the merge is a clean non-conflicting merge of DIFFERENT paths
// (so --cc prunes everything, leaving only the parent's own contribution -
// the "parent's contribution only" row) or a genuine conflict on a SHARED
// path both sides edit differently, forced to a manual resolution (so the
// resolved content survives --cc as the merge's OWN contribution).
function buildMergeCandidate(ctx, { conflict }) {
  const { root, coderWt } = ctx.bl1269;
  if (conflict) {
    const shared = path.join(root, 'shared.txt');
    fs.writeFileSync(shared, 'base\n');
    git(root, ['add', '-A']);
    gitCommit(root, 'seed shared.txt');
    git(coderWt, [...GIT_ID, 'merge', '-q', '--ff-only', 'main']);
    fs.writeFileSync(path.join(coderWt, 'shared.txt'), 'coder version\n');
    git(coderWt, ['add', '-A']);
    gitCommit(coderWt, `${TICKET_ID}: coder edits shared`);
    fs.writeFileSync(shared, 'main version\n');
    git(root, ['add', '-A']);
    gitCommit(root, 'advance main, edit shared');
    const mainTip = gitOut(root, ['rev-parse', 'main']);
    const mergeResult = spawnSync('git', [...GIT_ID, 'merge', '-q', '--no-ff', mainTip, '-m', `${TICKET_ID}: merge main into swarmforge-coder`], {
      cwd: coderWt,
      encoding: 'utf8',
    });
    // Expected to conflict - resolve by hand.
    fs.writeFileSync(path.join(coderWt, 'shared.txt'), 'merged version\n');
    git(coderWt, ['add', 'shared.txt']);
    if (mergeResult.status !== 0) {
      git(coderWt, [...GIT_ID, 'commit', '-q', '--no-edit']);
    }
    ctx.bl1269.candidateCommit = gitOut(coderWt, ['rev-parse', '--short=10', 'HEAD']);
    ctx.bl1269.candidateBranch = 'swarmforge-coder';
    ctx.bl1269.parcelTouchPath = 'shared.txt';
  } else {
    // Everything coder-side happens as ONE commit (the merge itself, then
    // amended) so there is exactly ONE ticket-naming candidate on this
    // branch - a separate pre-merge coder commit would be its OWN distinct
    // stranded candidate and muddy which warning/finding belongs to the
    // merge under test. The merge still needs SOME own contribution
    // (coder-side-note.txt, added via amend) - a merge whose combined diff
    // is genuinely empty is excluded entirely as "no dropped work"
    // (condition 5), which is correct for a true no-op merge but is not
    // the shape 559d9bd19a (the real incident) has: that merge DOES
    // contribute 4 paths of its own, just none overlapping the parcel.
    fs.writeFileSync(path.join(root, 'main-only.txt'), 'main content\n');
    git(root, ['add', '-A']);
    gitCommit(root, 'advance main');
    const mainTip = gitOut(root, ['rev-parse', 'main']);
    // --no-ff: coderWt has no divergent history of its own yet at this
    // point, so a plain merge would silently fast-forward instead of
    // creating a real 2-parent merge commit - the candidate this scenario
    // needs.
    git(coderWt, [...GIT_ID, 'merge', '-q', '--no-ff', mainTip, '-m', `${TICKET_ID}: merge main into swarmforge-coder`]);
    fs.writeFileSync(path.join(coderWt, 'coder-side-note.txt'), 'coder content\n');
    git(coderWt, ['add', '-A']);
    git(coderWt, [...GIT_ID, 'commit', '-q', '--amend', '--no-edit']);
    ctx.bl1269.candidateCommit = gitOut(coderWt, ['rev-parse', '--short=10', 'HEAD']);
    ctx.bl1269.candidateBranch = 'swarmforge-coder';
    ctx.bl1269.parcelTouchPath = 'main-only.txt';
  }
}

function buildSingleParentCandidate(ctx) {
  const { coderWt } = ctx.bl1269;
  fs.writeFileSync(path.join(coderWt, 'single-parent-file.txt'), 'coder content\n');
  git(coderWt, ['add', '-A']);
  gitCommit(coderWt, `${TICKET_ID}: single parent commit`);
  ctx.bl1269.candidateCommit = gitOut(coderWt, ['rev-parse', '--short=10', 'HEAD']);
  ctx.bl1269.candidateBranch = 'swarmforge-coder';
  ctx.bl1269.parcelTouchPath = 'single-parent-file.txt';
}

// The current parcel (citedCommit) - built on its OWN sender branch/worktree
// (never directly on `main` itself - parcel-paths-for-cited's merge-base
// against `main` would otherwise resolve to citedCommit's own self, making
// the three-dot diff trivially empty and hiding every path the parcel
// actually touches). Branched from main's CURRENT tip so the merge-base is
// exactly that tip and the diff is citedCommit's own new content only.
function buildCitedParcel(ctx) {
  const { root, parcelTouchPath } = ctx.bl1269;
  const mainTip = gitOut(root, ['rev-parse', 'main']);
  const senderWt = path.join(root, `sender-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  git(root, ['worktree', 'add', '-q', '-b', `sender-${path.basename(senderWt)}`, senderWt, mainTip]);
  const target = path.join(senderWt, parcelTouchPath);
  fs.appendFileSync(target, 'parcel line\n');
  git(senderWt, ['add', '-A']);
  gitCommit(senderWt, `${TICKET_ID}: parcel touches ${parcelTouchPath}`);
  ctx.bl1269.citedCommit = gitOut(senderWt, ['rev-parse', '--short=10', 'HEAD']);
}

function buildRow(ctx, candidate, origin) {
  if (candidate === 'an ordinary single-parent commit') {
    buildSingleParentCandidate(ctx);
  } else {
    buildMergeCandidate(ctx, { conflict: origin === "the merge's own combined diff" });
  }
  buildCitedParcel(ctx);
}

function runGather(ctx) {
  const { root, citedCommit } = ctx.bl1269;
  const script = `
(require '[cheshire.core :as json])
(load-file "${GATHER_LIB}")
(def result (pre-qa-gate-gather-lib/findings-for-git-handoff
  "${root}" {:to "QA" :task-name "${TICKET_ID}-fix" :cited-commit "${citedCommit}"}))
(println (json/generate-string result))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', env: processEnvAllowlist() });
  ctx.bl1269.result = JSON.parse(out.trim().split('\n').pop());
  return ctx.bl1269.result;
}

function ancestryFindings(result) {
  return (result.findings || []).filter((f) => f.class === 'ancestry');
}

function ancestryWarnings(result) {
  return (result.warnings || []).filter((w) => w.startsWith('ancestry '));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the pre-QA ancestry check is in force$/, (ctx) => {
    mkRepo(ctx);
  });

  scoped(/^a candidate commit on a role branch whose subject names the ticket$/, () => {
    // No-op marker - built once both the candidate kind and origin are
    // known (the second Given below), mirroring bl531's own lazy pattern.
  });

  scoped(/^the candidate is "(.+)"$/, (ctx, candidate) => {
    assert.ok(KNOWN_CANDIDATES.has(candidate), `unknown candidate "${candidate}"`);
    mkRepo(ctx);
    ctx.bl1269.candidateKind = candidate;
  });

  scoped(/^the parcel path appears in "(.+)"$/, (ctx, origin) => {
    assert.ok(KNOWN_ORIGINS.has(origin), `unknown origin "${origin}"`);
    buildRow(ctx, ctx.bl1269.candidateKind, origin);
    ctx.bl1269.originKind = origin;
  });

  scoped(/^the pre-QA gate evaluates the forward$/, (ctx) => {
    runGather(ctx);
  });

  scoped(/^the ancestry verdict is "(warning|finding)"$/, (ctx, expected) => {
    const key = `${ctx.bl1269.candidateKind}|${ctx.bl1269.originKind}`;
    assert.ok(Object.prototype.hasOwnProperty.call(OUTLINE_VERDICT, key), `unhandled outline row "${key}"`);
    assert.equal(OUTLINE_VERDICT[key], expected, `outline table disagrees with the feature file for "${key}"`);
    const findings = ancestryFindings(ctx.bl1269.result);
    const warnings = ancestryWarnings(ctx.bl1269.result);
    if (expected === 'finding') {
      assert.ok(findings.length > 0, `expected an ancestry finding, got findings=${JSON.stringify(ctx.bl1269.result.findings)} warnings=${JSON.stringify(ctx.bl1269.result.warnings)}`);
    } else {
      assert.equal(findings.length, 0, `expected no ancestry finding, got: ${JSON.stringify(findings)}`);
      assert.ok(warnings.length > 0, `expected an ancestry warning, got: ${JSON.stringify(ctx.bl1269.result.warnings)}`);
    }
  });

  scoped(/^a merge of main into a branch whose only overlap comes from a parent's contribution$/, (ctx) => {
    mkRepo(ctx);
    ctx.bl1269.candidateKind = 'a merge of main into a branch';
    buildRow(ctx, ctx.bl1269.candidateKind, "a parent's contribution only");
    ctx.bl1269.originKind = "a parent's contribution only";
  });

  scoped(/^the forward is allowed to proceed$/, (ctx) => {
    const findings = ancestryFindings(ctx.bl1269.result);
    assert.equal(findings.length, 0, `expected the forward not to be blocked by ancestry, findings: ${JSON.stringify(findings)}`);
  });

  scoped(/^a warning names that commit and its branch$/, (ctx) => {
    const { candidateCommit, candidateBranch } = ctx.bl1269;
    const expected = `ancestry ${TICKET_ID} ${candidateCommit} subject-only on ${candidateBranch}`;
    const warnings = ctx.bl1269.result.warnings || [];
    assert.ok(
      warnings.some((w) => w.includes(expected)),
      `expected a warning containing "${expected}", got: ${JSON.stringify(warnings)}`,
    );
  });

  scoped(
    /^a candidate park-sweep commit whose merge deletes another ticket's active YAML without naming it$/,
    (ctx) => {
      mkRepo(ctx);
      ctx.bl1269.candidateKind = 'a merge of main into a branch';
      // The park-sweep shape: main's own side additionally deletes another
      // ticket's active YAML (never named in the merge commit's own
      // subject, which only names THIS ticket) - the same shape 559d9bd19a
      // has in the real incident. The BL-1242 merge-deletion guard's own
      // refusal of exactly this shape is established by that ticket's own
      // suite (121+8 scenarios) - not re-proven here; this scenario is
      // about the ancestry gate no longer DEMANDING that merge.
      const otherTicket = path.join(ctx.bl1269.root, 'backlog', 'active', 'BL-1269OTHER-fixture.yaml');
      fs.writeFileSync(otherTicket, 'id: BL-1269OTHER\nstatus: active\n');
      git(ctx.bl1269.root, ['add', '-A']);
      gitCommit(ctx.bl1269.root, 'seed a second active ticket to be swept');
      buildMergeCandidateDeletingOtherTicket(ctx, otherTicket);
      buildCitedParcel(ctx);
      ctx.bl1269.originKind = "a parent's contribution only";
    },
  );

  scoped(/^the merge-deletion guard would refuse that merge$/, () => {
    // Documented, not independently re-driven here - see the comment on
    // the Given above.
  });

  scoped(/^the ancestry verdict is warning$/, (ctx) => {
    const findings = ancestryFindings(ctx.bl1269.result);
    const warnings = ancestryWarnings(ctx.bl1269.result);
    assert.equal(findings.length, 0, `expected no ancestry finding, got: ${JSON.stringify(findings)}`);
    assert.ok(warnings.length > 0, `expected an ancestry warning, got: ${JSON.stringify(ctx.bl1269.result.warnings)}`);
  });

  // ── Scenario 04: the real end-to-end path ───────────────────────────────
  scoped(
    /^a fixture reproducing the BL-1249 refusal with the park-sweep commit on a role branch$/,
    (ctx) => {
      mkRepo(ctx);
      ctx.bl1269.candidateKind = 'a merge of main into a branch';
      buildMergeCandidate(ctx, { conflict: false });
      buildCitedParcel(ctx);
    },
  );

  scoped(/^the documenter's forward is sent through swarm_handoff\.sh against that fixture$/, (ctx) => {
    const { root, coderWt, citedCommit } = ctx.bl1269;
    const draftPath = path.join(coderWt, `draft-${Date.now()}.txt`);
    fs.writeFileSync(draftPath, `type: git_handoff\nto: QA\npriority: 00\ntask: ${TICKET_ID}-fix\ncommit: ${citedCommit}\n`);
    const res = spawnSync('bb', [SWARM_HANDOFF, draftPath], {
      cwd: coderWt,
      encoding: 'utf8',
      env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'coder', SWARMFORGE_MAILBOX_ONLY: '1' },
    });
    ctx.bl1269.sendResult = { status: res.status, out: `${res.stdout || ''}\n${res.stderr || ''}` };
    void root;
  });

  scoped(/^the forward is not refused for ancestry$/, (ctx) => {
    const { status, out } = ctx.bl1269.sendResult;
    assert.notEqual(status, 2, `expected the send not to be refused (exit 2), got: ${out}`);
    assert.doesNotMatch(out, /PRE_QA_GATE_FAIL ancestry/, out);
  });

  scoped(/^no merge of the park-sweep commit was required to achieve it$/, () => {
    // Structural: this scenario never runs a merge of the candidate commit
    // into anything - the send above is the only action taken, and it
    // succeeded without one.
  });
}

// Same as buildMergeCandidate's non-conflict branch, plus main's own side
// deleting otherTicketPath (the "park sweep" shape).
function buildMergeCandidateDeletingOtherTicket(ctx, otherTicketPath) {
  const { root, coderWt } = ctx.bl1269;
  fs.writeFileSync(path.join(root, 'main-only.txt'), 'main content\n');
  fs.rmSync(otherTicketPath);
  git(root, ['add', '-A']);
  gitCommit(root, 'advance main: park sweep (delete other ticket active yaml)');
  fs.writeFileSync(path.join(coderWt, 'coder-only.txt'), 'coder content\n');
  git(coderWt, ['add', '-A']);
  gitCommit(coderWt, `${TICKET_ID}: coder work`);
  const mainTip = gitOut(root, ['rev-parse', 'main']);
  git(coderWt, [...GIT_ID, 'merge', '-q', mainTip, '-m', `${TICKET_ID}: merge main into swarmforge-coder`]);
  ctx.bl1269.candidateCommit = gitOut(coderWt, ['rev-parse', '--short=10', 'HEAD']);
  ctx.bl1269.candidateBranch = 'swarmforge-coder';
  ctx.bl1269.parcelTouchPath = 'main-only.txt';
}

module.exports = { registerSteps };
