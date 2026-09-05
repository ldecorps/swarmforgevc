'use strict';

// BL-1083: step handlers for "a ticket reaches backlog/active only through the
// promotion gates".
//
// Scenario 01 is a repo-wide ENUMERATION, not a spot check. The defect was not
// a wrong gate - promotion_gates_lib.bb is correct - but a second way in
// beside it that nothing noticed, so checking only the paths someone
// remembers would reproduce the blind spot the ticket is about.
//
// Scenarios 02 and 03 drive the REAL mover (backlogWriter's promoteToActive)
// against a fixture carrying the REAL gate CLI, through the REAL Expedite
// effect (recordExpediteDecisionAndClose). Nothing about the gate rules is
// re-derived here: the scenarios assert which gate refused and that the ticket
// did not move, both of which are observable without knowing the rules.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findActivePromotionSources,
  referencesPromotionGates,
  gateRuleNamesInCode,
  GATE_RULE_NAMES,
} = require('./lib/activePromotionSources');
const { installPromotionGates } = require('./lib/promotionGatesFixture');

const FEATURE = 'a ticket reaches backlog/active only through the promotion gates';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { promoteToActive } = require(path.join(EXT_OUT, 'panel', 'backlogWriter'));
const { recordExpediteDecisionAndClose } = require(path.join(EXT_OUT, 'tools', 'telegramFrontDeskBotCore'));

// The chokepoint itself, which is allowed - indeed required - to contain the
// gate rules. Everything else must not.
const CHOKEPOINT = 'swarmforge/scripts/promotion_gates_lib.bb';

const TICKET_ID = 'BL-9001';
const DEP_ID = 'BL-9002';

function mkFixture(opts) {
  const root = installPromotionGates(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1083-')), opts);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'hold'), { recursive: true });
  return root;
}

function writeTicket(root, folder, id, extra) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-fixture.yaml`);
  fs.writeFileSync(file, `id: ${id}\ntitle: t\n${extra}`);
  return file;
}

function inFolder(root, folder, id) {
  const dir = path.join(root, 'backlog', folder);
  try {
    return fs.readdirSync(dir).some((f) => f.startsWith(id));
  } catch {
    return false;
  }
}

// The REAL Expedite effect, with just enough adapters to observe what it did.
// promoteTicketIfPaused is the real mover against the real gates; every other
// adapter records rather than simulates.
function runExpedite(ctx) {
  const notices = [];
  const dispatches = [];
  ctx.notices = notices;
  ctx.dispatches = dispatches;
  return recordExpediteDecisionAndClose(
    {
      recordApprovalReply: async () => {
        // The human's approval, recorded BEFORE the gates are consulted -
        // which is what makes Expedite satisfy human_approval rather than skip
        // it (scenario 03).
        ctx.approvalRecordedAt = ctx.approvalRecordedAt ?? 'before-gates';
        const file = ctx.ticketFile;
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf8').replace(/human_approval:.*/m, 'human_approval: approved')
        );
        return true;
      },
      promoteTicketIfPaused: async (backlogId) => {
        ctx.gatesConsultedAfterApproval = ctx.approvalRecordedAt === 'before-gates';
        return promoteToActive(ctx.root, backlogId);
      },
      dispatchExpediteBuild: async (backlogId) => {
        dispatches.push(backlogId);
        return true;
      },
      notifyApprovalsTopic: async (_topicId, text) => {
        notices.push(text);
        return true;
      },
    },
    TICKET_ID
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01 ───────────────────────────────────────────────────────────────────
  scoped(/^the sources that move a backlog ticket into the active folder$/, (ctx) => {
    ctx.searched = true;
  });

  scoped(/^every such move is enumerated$/, (ctx) => {
    assert.ok(ctx.searched, 'the enumeration is over the sources named in the Given');
    ctx.sources = findActivePromotionSources();
  });

  scoped(/^each one takes its verdict from the shared promotion-gates chokepoint$/, (ctx) => {
    const ungated = ctx.sources.filter((f) => !referencesPromotionGates(f));
    assert.deepEqual(
      ungated,
      [],
      `these move a ticket into backlog/active without consulting the gates: ${ungated.join(', ')}`
    );
  });

  scoped(/^no second copy of the gate rules exists outside that chokepoint$/, (ctx) => {
    // The rules are Babashka and one of the movers is TypeScript; no import
    // crosses that boundary, so a copy is the tempting fix and the wrong one.
    // Comments naming a gate are fine and wanted - only live code is a copy.
    const offenders = ctx.sources
      .filter((f) => f !== CHOKEPOINT)
      .map((f) => ({ file: f, names: gateRuleNamesInCode(f) }))
      .filter((r) => r.names.length > 0);
    assert.deepEqual(
      offenders,
      [],
      `gate rule names as live code outside ${CHOKEPOINT}: ` +
        offenders.map((o) => `${o.file} (${o.names.join(', ')})`).join('; ')
    );
    // Non-vacuity: the check means nothing unless those names really are the
    // gate rules, i.e. they really are live code in the chokepoint itself.
    const atChokepoint = gateRuleNamesInCode(CHOKEPOINT);
    assert.deepEqual(
      atChokepoint.sort(),
      [...GATE_RULE_NAMES].sort(),
      `the chokepoint must itself hold every gate rule, else this check is looking for the wrong names; found: ${atChokepoint.join(', ')}`
    );
  });

  scoped(/^more than one such path is found$/, (ctx) => {
    // The whole point: one gated path proves nothing, because the defect was
    // the SECOND path nobody was looking at.
    assert.ok(
      ctx.sources.length > 1,
      `expected more than one promotion path, found: ${ctx.sources.join(', ') || '(none)'}`
    );
  });

  // ── 02 ───────────────────────────────────────────────────────────────────
  scoped(/^a paused ticket the promotion gates refuse for (\S+)$/, (ctx, gate) => {
    // BL-1425 (reverses this row): active_backlog_max_depth is no longer a
    // gate an Expedite always refuses for - a queue-jump crosses it
    // deliberately. Only depends_on and hold remain in this Outline's
    // Examples.
    ctx.expectedGate = gate === 'hold' ? 'hold marker' : gate;
    if (gate === 'depends_on') {
      ctx.root = mkFixture();
      // The live shape: the dependency exists and is ACTIVE, not done.
      writeTicket(ctx.root, 'active', DEP_ID, '');
      ctx.ticketFile = writeTicket(ctx.root, 'paused', TICKET_ID, `human_approval: pending\ndepends_on: [${DEP_ID}]\n`);
    } else if (gate === 'hold') {
      ctx.root = mkFixture();
      ctx.ticketFile = writeTicket(ctx.root, 'hold', TICKET_ID, 'human_approval: pending\ndepends_on: []\n');
      ctx.startFolder = 'hold';
    } else {
      throw new Error(`unknown <gate>: ${gate}`);
    }
    ctx.startFolder = ctx.startFolder ?? 'paused';
  });

  scoped(/^the Expedite verb promotes it$/, async (ctx) => {
    ctx.result = await runExpedite(ctx);
  });

  scoped(/^the ticket is still in paused afterwards$/, (ctx) => {
    // "paused" in the feature's words means "wherever it was" - a held ticket
    // is refused out of hold and must not land in active either.
    assert.ok(
      inFolder(ctx.root, ctx.startFolder, TICKET_ID),
      `the refused ticket must stay in backlog/${ctx.startFolder}/`
    );
    assert.equal(
      inFolder(ctx.root, 'active', TICKET_ID),
      false,
      'a refused promotion must not reach backlog/active/'
    );
    // A refused promotion must not start a build either.
    assert.deepEqual(ctx.dispatches, [], 'no build may be dispatched for a ticket that was not promoted');
  });

  scoped(/^the operator is told which gate refused it and why$/, (ctx) => {
    assert.ok(ctx.result.refusal, `expected a refusal, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.refusal.gate, ctx.expectedGate);
    assert.ok(ctx.result.refusal.reason.length > 0, 'a refusal must carry a reason, not just a gate name');
    // In the topic the operator tapped in, not only in a log they will never
    // open (the ticket's own QA step 2).
    const told = ctx.notices.filter((t) => t.includes(ctx.expectedGate) && t.includes(TICKET_ID));
    assert.equal(
      told.length,
      1,
      `expected exactly one operator notice naming the gate, got: ${JSON.stringify(ctx.notices)}`
    );
  });

  // ── 03 ───────────────────────────────────────────────────────────────────
  scoped(/^a paused ticket awaiting human approval that no other gate refuses$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.startFolder = 'paused';
    ctx.ticketFile = writeTicket(ctx.root, 'paused', TICKET_ID, 'human_approval: pending\ndepends_on: []\n');
    // The premise, asserted rather than assumed: before the approval is
    // recorded, this ticket IS refused - for human_approval and nothing else.
    const before = promoteToActive(ctx.root, TICKET_ID);
    assert.equal(before.moved, false, 'the premise is a ticket that is refused before approval');
    assert.equal(before.refusal.gate, 'human_approval');
  });

  scoped(/^the approval is recorded before the gates are consulted$/, (ctx) => {
    assert.equal(
      ctx.gatesConsultedAfterApproval,
      true,
      'Expedite must record the approval FIRST - otherwise it skips the approval gate rather than satisfying it'
    );
  });

  scoped(/^the promotion is not refused for human approval$/, (ctx) => {
    assert.equal(
      ctx.result.refusal,
      undefined,
      `expected no refusal, got: ${JSON.stringify(ctx.result.refusal)}`
    );
  });

  scoped(/^the ticket is in active afterwards$/, (ctx) => {
    assert.ok(inFolder(ctx.root, 'active', TICKET_ID), 'a ticket no gate refuses must be promoted');
    assert.equal(inFolder(ctx.root, 'paused', TICKET_ID), false, 'and must not be left in paused');
  });
}

module.exports = { registerSteps };
