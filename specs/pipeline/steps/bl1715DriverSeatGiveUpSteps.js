'use strict';

// BL-1715: step handlers for "a driver seat that fails a parcel hands it
// to its stage's Claude seat". Reuses BL-1697's own fixture
// (makeLocalParcelDriverFixture) with a second roles.tsv row added for
// the mixed pack's Claude sibling seat - the real driver (coder@2) via
// one bb CLI process per tick, a fake tmux, a real throwaway git checkout
// with the real `seat` script, exactly as BL-1697/1698 use it. The two
// seats' own CLAIM-PATH behaviour (never the driver's internal
// orchestration) is exercised by polling `ready_for_next_task.bb`
// directly - the LEAF script, never the seat/ready_for_next.sh wrapper
// (which would run this fixture's own simplified stub) - the same
// technique BL-1004's own acceptance step handler uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('../../../extension/test/helpers/localParcelDriverFixture');

const FEATURE = "BL-1715 A driver seat that fails a parcel hands it to its stage's Claude seat";

const KNOWN_PARCELS = new Set(['the handed-over parcel', 'a later rework bounce']);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function inProcessFiles(root) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

function newQueueFiles(root) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture coder stage with a Claude seat "coder" and a driver seat "coder@2"$/, (ctx) => {
    ctx.fixture = makeLocalParcelDriverFixture({ driverRole: 'coder@2' });
    ctx.fixture.installDeliverRoleAnswerStub();
    ctx.fixture.writeRolesTsv([
      { role: 'coder', agent: 'claude' },
      { role: 'coder@2', agent: 'aider' },
    ]);
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => ctx.fixture.cleanup());
  });

  scoped(/^coder@2 has claimed a low-cost coder parcel whose gate still fails after its last fix turn$/, (ctx) => {
    const { fixture } = ctx;
    fixture.writeTicket({ editablePaths: ['editable.txt'] });
    ctx.preClaimHead = git(fixture.root, ['rev-parse', 'HEAD']);

    ctx.senderSha = fixture.makeSenderCommit();
    fixture.queueParcel(ctx.senderSha);
    // Move the queued parcel straight to in_process, as `seat next` would.
    const newDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new');
    const procDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(procDir, { recursive: true });
    for (const f of fs.readdirSync(newDir)) {
      fs.renameSync(path.join(newDir, f), path.join(procDir, f));
    }
    git(fixture.root, ['merge', '--no-ff', ctx.senderSha, '-m', 'merge sender']);
    const postMergeHead = git(fixture.root, ['rev-parse', 'HEAD']);

    const specFiles = [fixture.ticketPath, fixture.featurePath];
    // The model's own last, still-broken attempt - already committed, pane
    // now idle, waiting for the driver's next gate check.
    fs.writeFileSync(path.join(fixture.root, 'editable.txt'), 'still broken\n');
    git(fixture.root, ['commit', '-q', '-am', 'model: last attempt, still broken']);
    for (const p of specFiles) fs.chmodSync(p, 0o444);

    fixture.writeDriverState({
      phase: 'awaiting-model',
      ticket: 'BL-9',
      senderRole: 'specifier',
      postMergeHead,
      commit: ctx.senderSha,
      priority: '50',
      preClaimHead: ctx.preClaimHead,
      startedAtMs: Date.now() - 1000,
      specFiles,
      specHashesBefore: Object.fromEntries(
        specFiles.map((p) => [p, execFileSync('sha256sum', [p]).toString().split(' ')[0]])
      ),
      editablePaths: ['editable.txt'],
      fixTurnsUsed: 1,
      fixTurnsLimit: 1,
      acceptancePath: fixture.featurePath,
    });
  });

  // ── Scenario 01 / 03 trigger, and scenario 02's own Given ──────────────
  function finishLastFixTurn(ctx) {
    ctx.tickResult = ctx.fixture.driveOneTick();
  }
  scoped(/^the driver finishes coder@2's last fix turn$/, (ctx) => finishLastFixTurn(ctx));
  scoped(/^coder@2 has given the parcel up$/, (ctx) => finishLastFixTurn(ctx));

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^coder@2 holds no in-process parcel$/, (ctx) => {
    assert.deepEqual(
      inProcessFiles(ctx.fixture.root),
      [],
      `expected no in-process parcel:\n${ctx.tickResult.stdout}\n${ctx.tickResult.stderr}`
    );
  });

  scoped(/^the Claude seat's next poll claims a parcel with the same task and received commit$/, (ctx) => {
    const poll = ctx.fixture.pollRole('coder');
    const files = inProcessFiles(ctx.fixture.root);
    assert.equal(files.length, 1, `expected the Claude seat to claim exactly one parcel:\n${poll.stdout}\n${poll.stderr}`);
    const text = fs.readFileSync(
      path.join(ctx.fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process', files[0]),
      'utf8'
    );
    assert.match(text, /^task: BL-9$/m, `expected the claimed parcel to name BL-9:\n${text}`);
    assert.match(
      text,
      new RegExp(`^commit: ${ctx.senderSha}$`, 'm'),
      `expected the claimed parcel to carry the original received commit:\n${text}`
    );
    assert.match(poll.stdout, /TASK_NAME: BL-9/, `expected the poll to print the claimed task:\n${poll.stdout}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(new RegExp(`^(${[...KNOWN_PARCELS].join('|')}) for that ticket is in the coder stage queue$`), (ctx, parcel) => {
    assert.ok(KNOWN_PARCELS.has(parcel), `unknown parcel shape "${parcel}" - the handlers know ${[...KNOWN_PARCELS]}`);
    const { fixture } = ctx;
    if (parcel === 'a later rework bounce') {
      // The give-up path already queued a fresh copy - clear it and queue a
      // DIFFERENT parcel for the SAME ticket, as a later QA bounce would.
      // Written with a real body (never fixture.queueParcel's headers-only
      // shape, which the real claim path's corrupt-handoff check quarantines
      // - only the fixture's own naive stub tolerates it): this scenario
      // polls ready_for_next_task.bb directly.
      const newDir = path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'new');
      for (const f of fs.readdirSync(newDir)) fs.unlinkSync(path.join(newDir, f));
      fs.writeFileSync(
        path.join(newDir, '00_20260926T000000Z_000002_from_QA_to_coder_for_coder.handoff'),
        [
          'type: git_handoff',
          'from: QA',
          'to: coder',
          'priority: 00',
          'task: BL-9',
          `commit: ${ctx.senderSha}`,
          '',
          `merge_and_process QA ${ctx.senderSha}`,
          '',
        ].join('\n')
      );
    }
    assert.equal(
      newQueueFiles(fixture.root).length,
      1,
      `expected exactly one queued parcel for BL-9: ${JSON.stringify(newQueueFiles(fixture.root))}`
    );
  });

  scoped(/^both seats poll$/, (ctx) => {
    // coder@2 polls FIRST - if the never-again exclusion were broken, this
    // is the poll that would wrongly claim it.
    ctx.pollCoder2 = ctx.fixture.pollRole('coder@2');
    ctx.pollCoder = ctx.fixture.pollRole('coder');
  });

  scoped(/^the Claude seat claims it and coder@2 does not$/, (ctx) => {
    assert.match(
      ctx.pollCoder2.stdout,
      /NO_TASK/,
      `expected coder@2's own poll to find nothing claimable:\n${ctx.pollCoder2.stdout}\n${ctx.pollCoder2.stderr}`
    );
    assert.match(
      ctx.pollCoder.stdout,
      /TASK_NAME: BL-9/,
      `expected the Claude seat's poll to claim BL-9:\n${ctx.pollCoder.stdout}\n${ctx.pollCoder.stderr}`
    );
    const files = inProcessFiles(ctx.fixture.root);
    assert.equal(files.length, 1, 'expected exactly one seat to hold the claim');
  });

  // Scenario 03 retired by BL-1778 (the tree/outcome-row contract now
  // lives in BL-1778's own feature, over the post-merge tree rather than
  // the pre-claim tree these two handlers pinned) - handlers removed,
  // never left orphaned.

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the Claude seat is removed from the fixture coder stage$/, (ctx) => {
    ctx.fixture.writeRolesTsv([{ role: 'coder@2', agent: 'aider' }]);
  });

  scoped(/^the parcel stays in process on coder@2 marked escalated$/, (ctx) => {
    assert.equal(inProcessFiles(ctx.fixture.root).length, 1, 'expected the parcel to remain in-process');
    const state = ctx.fixture.readDriverState();
    assert.ok(state && state.escalated === true, `expected an escalated driver record, got: ${JSON.stringify(state)}`);
    assert.equal(state.ticket, 'BL-9', `unexpected ticket in the escalated record: ${JSON.stringify(state)}`);
  });

  scoped(/^one outcome row records the ticket as "escalated"$/, (ctx) => {
    const rows = ctx.fixture.readOutcomes();
    assert.equal(rows.length, 1, `expected exactly one outcome row, got: ${JSON.stringify(rows)}`);
    assert.equal(rows[0].outcome, 'escalated', `unexpected outcome: ${JSON.stringify(rows[0])}`);
    assert.equal(rows[0].ticket, 'BL-9', `unexpected ticket: ${JSON.stringify(rows[0])}`);
  });
}

module.exports = { registerSteps };
