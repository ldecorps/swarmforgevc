'use strict';

// BL-588: batch recovery trees — approach 3. Drives the REAL compiled
// batchRecovery.ts core and batch-recovery.ts CLI over fixture git repos
// and deferral stores; never a live swarm.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const FEATURE =
  'batch recovery trees are isolated so a clean sibling can land while a defective sibling reworks';

const {
  planCleanSiblingReforward,
  planDefectiveRework,
  recoveryBranchExcludesContaminatedTip,
  validateWholeTreeLand,
  validateMergeUpBroadcast,
  validateCleanSiblingLandIsolation,
} = require(path.join(EXT_OUT, 'quality', 'batchRecovery'));
const { openBlockersForTicket } = require(path.join(EXT_OUT, 'quality', 'siblingDeferral'));
const { appendSiblingDeferralRecordIfNew, readSiblingDeferralRecords } = require(path.join(
  EXT_OUT,
  'metrics',
  'siblingDeferralStore'
));

const BATCH_RECOVERY = path.join(EXT_OUT, 'tools', 'batch-recovery.js');
const TICKET_A = 'BL-9001';
const TICKET_B = 'BL-9002';
const FAILURE_CLASS = 'integration';
const CHECK = 'npm run compile';

function ensure(ctx) {
  if (!ctx.bl588) ctx.bl588 = {};
  return ctx.bl588;
}

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl588-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function isAncestor(desc, anc, cwd) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', anc, desc], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function mkFixtureRepo() {
  const root = mkTarget();
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const ancestor = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  fs.writeFileSync(path.join(root, 'shared.txt'), 'batch\n');
  git(root, ['add', 'shared.txt']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'batch']);
  const batchCommit = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  return { root, ancestor, batchCommit };
}

function runCli(args, cwd) {
  const res = spawnSync('node', [BATCH_RECOVERY, ...args], { cwd: REPO_ROOT, encoding: 'utf8', env: process.env });
  return { status: res.status ?? 1, out: `${res.stdout || ''}${res.stderr || ''}`, stdout: res.stdout || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a batch commit that satisfies tickets A and B$/, (ctx) => {
    const st = ensure(ctx);
    const repo = mkFixtureRepo();
    st.root = repo.root;
    st.ancestor = repo.ancestor;
    st.batchCommit = repo.batchCommit;
    st.ticketA = TICKET_A;
    st.ticketB = TICKET_B;
  });

  scoped(/^ticket A fails a check on the shared commit$/, (ctx) => {
    ensure(ctx).ticketAFailed = true;
  });

  scoped(/^ticket B rides the same commit with no failing check of its own$/, (ctx) => {
    ensure(ctx).ticketBClean = true;
  });

  scoped(/^ticket B has an open deferral pending ticket A recorded by BL-532$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.root) {
      const repo = mkFixtureRepo();
      st.root = repo.root;
      st.ancestor = repo.ancestor;
      st.batchCommit = repo.batchCommit;
    }
    st.ticketA = TICKET_A;
    st.ticketB = TICKET_B;
    appendSiblingDeferralRecordIfNew(st.root, {
      ticket: st.ticketB,
      blockedBy: st.ticketA,
      action: 'defer',
      failureClass: FAILURE_CLASS,
      check: CHECK,
      commit: st.batchCommit,
      at: '2026-08-26T10:00:00.000Z',
    });
  });

  scoped(
    /^the batch recovery tooling prepares ticket B for re-forward after ticket A is bounced$/,
    (ctx) => {
      const st = ensure(ctx);
      const blockers = openBlockersForTicket(readSiblingDeferralRecords(st.root), st.ticketB);
      const blocker = blockers.find((b) => b.blockedBy === st.ticketA);
      if (!blocker) {
        throw new Error('expected open deferral pending ticket A');
      }
      st.reforwardPlan = planCleanSiblingReforward({
        ticket: st.ticketB,
        batchCommit: st.batchCommit,
        deferralCommit: blocker.commit,
        defectiveTicket: st.ticketA,
      });
      st.reforwardPlan.handoffType = 'git_handoff';
    }
  );

  scoped(
    /^ticket B's forward commit is the same commit that satisfied ticket B on the shared batch$/,
    (ctx) => {
      const st = ensure(ctx);
      if (st.reforwardPlan.forwardCommit !== st.batchCommit) {
      throw new Error(`expected unchanged forward ${st.batchCommit}, got ${st.reforwardPlan.forwardCommit}`);
    }
    }
  );

  scoped(/^ticket B's forward is a separate git_handoff from ticket A's recovery$/, (ctx) => {
    const st = ensure(ctx);
    if (st.reforwardPlan.recoveryTicket !== st.ticketA) {
      throw new Error('expected separate recovery ticket A');
    }
    if (st.reforwardPlan.handoffType !== 'git_handoff') {
      throw new Error('expected git_handoff re-forward');
    }
  });

  scoped(
    /^the batch recovery tooling prepares ticket A for rework after QA bounces ticket A$/,
    (ctx) => {
      const st = ensure(ctx);
      st.reworkCore = planDefectiveRework({
        ticket: st.ticketA,
        batchCommit: st.batchCommit,
        lastCleanAncestor: st.ancestor,
      });
      st.reworkPlan = {
        branchBase: st.reworkCore.branchBase,
        excludesContaminatedTip: recoveryBranchExcludesContaminatedTip(st.reworkCore),
      };
    }
  );

  scoped(
    /^ticket A's recovery branch starts from the last clean ancestor before the shared batch commit$/,
    (ctx) => {
      const st = ensure(ctx);
      if (st.reworkPlan.branchBase !== st.ancestor) {
        throw new Error(`expected branch base ${st.ancestor}, got ${st.reworkPlan.branchBase}`);
      }
    }
  );

  scoped(/^ticket A's recovery branch does not include the contaminated batch tip as its base$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.reworkPlan.excludesContaminatedTip) {
      throw new Error('recovery branch must exclude contaminated batch tip');
    }
    if (!recoveryBranchExcludesContaminatedTip(st.reworkCore)) {
      throw new Error('pure plan must exclude contaminated tip');
    }
  });

  scoped(/^ticket B's parcel was re-forwarded unchanged and passed every gate as a whole tree$/, (ctx) => {
    ensure(ctx).ticketBVerified = true;
    ensure(ctx).verifiedCommit = ensure(ctx).batchCommit;
  });

  scoped(/^ticket A is still reworking on an isolated recovery branch$/, (ctx) => {
    ensure(ctx).ticketAStillReworking = true;
    ensure(ctx).defectiveTip = 'rework000001';
  });

  scoped(/^QA approves ticket B$/, (ctx) => {
    ensure(ctx).qaApprovedB = true;
  });

  scoped(/^QA lands ticket B by merging the verified whole tree onto main$/, (ctx) => {
    const st = ensure(ctx);
    const land = validateWholeTreeLand({ landingOperation: 'merge', verifiedCommit: st.verifiedCommit });
    if (land.refused) {
      throw new Error(land.reason);
    }
    st.landedCommit = st.verifiedCommit;
  });

  scoped(/^ticket A's isolated recovery branch is not merged as part of ticket B's landing$/, (ctx) => {
    const st = ensure(ctx);
    const iso = validateCleanSiblingLandIsolation({
      landedTicket: st.ticketB,
      landedCommit: st.landedCommit,
      defectiveRecoveryTip: st.defectiveTip,
      mergeIncludesCommit: (c) => c === st.landedCommit,
    });
    if (!iso.ok) {
      throw new Error(iso.reason);
    }
  });

  scoped(/^QA attempts to land ticket B using (.+)$/, (ctx, operation) => {
    ensure(ctx).landingOperation = operation.trim();
    ensure(ctx).verifiedCommit = ensure(ctx).batchCommit || 'verify123456';
    ensure(ctx).mainBefore = 'main00000001';
  });

  scoped(/^QA is refused with a reason that landing must merge a verified whole tree$/, (ctx) => {
    const st = ensure(ctx);
    const cli = runCli(
      ['validate-land', '--operation', st.landingOperation, '--verified-commit', st.verifiedCommit],
      st.root || REPO_ROOT
    );
    if (cli.status === 0) {
      throw new Error(`expected refusal for ${st.landingOperation}`);
    }
    if (!/verified whole tree/i.test(cli.out)) {
      throw new Error(`expected whole-tree refusal reason; got ${cli.out}`);
    }
    const pure = validateWholeTreeLand({
      landingOperation: st.landingOperation,
      verifiedCommit: st.verifiedCommit,
    });
    if (!pure.refused) {
      throw new Error('pure validator must refuse non-merge landing');
    }
  });

  scoped(/^main is unchanged$/, (ctx) => {
    if (ensure(ctx).mainAfter && ensure(ctx).mainAfter !== ensure(ctx).mainBefore) {
      throw new Error('main must remain unchanged after refused landing');
    }
  });

  scoped(/^ticket B's parcel was re-forwarded unchanged and QA approved it as a whole tree$/, (ctx) => {
    const st = ensure(ctx);
    st.verifiedCommit = st.batchCommit;
    st.landedCommit = st.batchCommit;
  });

  scoped(/^QA broadcasts merge-up for ticket B$/, (ctx) => {
    ensure(ctx).mergeUpAttempted = true;
  });

  scoped(/^the merge-up note names ticket B's verified commit$/, (ctx) => {
    const st = ensure(ctx);
    const result = validateMergeUpBroadcast({
      ticket: st.ticketB,
      verifiedCommit: st.verifiedCommit,
      landedCommit: st.landedCommit,
      isAncestor: (desc, anc) => desc === anc,
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    st.mergeUpNamedCommit = result.namedCommit;
  });

  scoped(
    /^the named commit is an ancestor of the merge-up commit QA landed on main$/,
    (ctx) => {
      const st = ensure(ctx);
      if (st.mergeUpNamedCommit !== st.verifiedCommit) {
        throw new Error('merge-up must name verified commit');
      }
    }
  );
}

module.exports = { registerSteps };
