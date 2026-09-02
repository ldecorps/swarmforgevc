'use strict';

// BL-1283: BL-848 stamp-off of Cursor hotfix 2b67f4b1a2, "Freeze the Telegram
// pipeline board while the pack is asleep."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes no
// hotfix source line, and writes nothing to the ledger (invariants 1 and 2).
//
// The board scenarios EXECUTE the real `runConciergeTick` over spy adapters
// rather than asserting on source text: the fault class here is a gate that
// reads correctly and is never consulted, which a source-text assertion
// cannot tell apart from a wired one. Scenario 05 states the failure
// DIRECTION for a wrong liveness answer instead of assuming the probe is
// sound - probeSwarmLiveness has a recorded false-green history on this host.
//
// Scenario 06 REPORTS on the two property-allowlist rows the same commit
// added; per the ticket's constraints it must not remove or re-attribute
// them, and acting on what it finds is the human's call.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Swarm stamp-off for the pipeline-board sleep freeze';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const HOTFIX = '2b67f4b1a2';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const ALLOWLIST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');

const { runConciergeTick, pipelineBoardShouldRefresh } = require(path.join(OUT, 'concierge', 'conciergeTick'));

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

// A minimal adapter set: everything runConciergeTick requires, with the board
// and pin paths as spies. Only the board halves matter here - the rest exist
// so the real tick runs end to end rather than a stubbed fragment of it.
function tickHarness() {
  const calls = { board: 0, pin: 0 };
  const adapters = {
    readFolders: () => ({
      active: [{ id: 'BL-1', title: 'held ticket', filename: 'BL-1.yaml' }],
      paused: [],
      done: [],
      hold: [],
    }),
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ({}),
    writeTickState: () => {},
    // Every REQUIRED field of RouteAdapters / TopicIconAdapters, stubbed
    // inert. None of it is what this stamp-off reviews; it exists so the
    // REAL tick runs end to end rather than a stubbed fragment of the path
    // the gate sits on.
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: false }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => undefined,
      ensureApprovalsTopic: async () => undefined,
      ensureBacklogTopic: async () => undefined,
      postMessage: async () => undefined,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => 'recorded',
    },
    boardAdapters: {
      ensureBoardTopic: async () => ({ topicId: 900 }),
      postMessage: async () => {
        calls.board += 1;
        return { messageId: 1 };
      },
      editMessage: async () => {
        calls.board += 1;
        return true;
      },
      deleteMessage: async () => true,
    },
    boardPinAdapters: {
      getTopPinnedMessageId: async () => {
        calls.pin += 1;
        return undefined;
      },
      unpinAllMessages: async () => {
        calls.pin += 1;
        return true;
      },
      pinMessage: async () => {
        calls.pin += 1;
        return true;
      },
    },
    readRoleHeldTickets: () => ({ coder: ['BL-1'] }),
  };
  return { adapters, calls };
}

// Scenario 05's Outline values, validated explicitly rather than passed
// through. Each pair states what a WRONG probe answer costs, in the
// direction it actually fails.
const KNOWN_REALITY = ['awake', 'asleep'];
const KNOWN_PROBE = ['awake', 'asleep'];
const KNOWN_OUTCOME = {
  'awake/asleep': 'frozen-while-working',
  'asleep/awake': 'reposting-while-idle',
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background: the reviewed tree IS the landed hotfix ──────────────────

  scoped(/^the landed sources at commit 2b67f4b1a2$/, (ctx) => {
    ctx.bl1283 = {};
    assert.equal(git('cat-file', '-t', HOTFIX).trim(), 'commit', `${HOTFIX} must be reachable`);
    const message = git('log', '-1', '--format=%B', HOTFIX);
    assert.match(
      message,
      /Hotfix-Certification:\s*pending/,
      `${HOTFIX} is not pending certification - a stamp-off has nothing to review`
    );
    // qa_e2e (1): the gate exists and is legacy-safe by default.
    assert.equal(typeof pipelineBoardShouldRefresh, 'function');
    assert.equal(pipelineBoardShouldRefresh(undefined), true);
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^a concierge tick whose pipeline board is reported asleep$/, (ctx) => {
    ctx.bl1283.harness = tickHarness();
    ctx.bl1283.harness.adapters.isPipelineBoardAwake = () => false;
  });

  scoped(/^a concierge tick whose pipeline board is reported awake$/, (ctx) => {
    ctx.bl1283.harness = tickHarness();
    ctx.bl1283.harness.adapters.isPipelineBoardAwake = () => true;
  });

  scoped(/^a concierge tick with no pipeline board liveness adapter wired$/, (ctx) => {
    // The legacy shape: no adapter at all. `awake ?? true` is what keeps a
    // caller that predates the hotfix behaving exactly as it did.
    ctx.bl1283.harness = tickHarness();
    assert.equal(ctx.bl1283.harness.adapters.isPipelineBoardAwake, undefined);
  });

  scoped(/^a pack that is really "([^"]+)"$/, (ctx, reality) => {
    assert.ok(KNOWN_REALITY.includes(reality), `unknown reality "${reality}"`);
    ctx.bl1283 = ctx.bl1283 ?? {};
    ctx.bl1283.reality = reality;
  });

  scoped(/^a liveness probe answering "([^"]+)"$/, (ctx, probe) => {
    assert.ok(KNOWN_PROBE.includes(probe), `unknown probe answer "${probe}"`);
    ctx.bl1283.probe = probe;
    ctx.bl1283.harness = tickHarness();
    // The BOARD follows the probe, never the reality - that is the whole
    // point of stating the failure direction.
    ctx.bl1283.harness.adapters.isPipelineBoardAwake = () => probe === 'awake';
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the tick runs$/, async (ctx) => {
    const { adapters } = ctx.bl1283.harness;
    ctx.bl1283.result = await runConciergeTick(adapters);
  });

  scoped(/^the review completes with every scenario green$/, (ctx) => {
    ctx.bl1283.reviewGreen = true;
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the board is neither recomputed nor reposted$/, (ctx) => {
    assert.equal(ctx.bl1283.harness.calls.board, 0, 'an asleep tick must not touch the board');
  });

  scoped(/^the board pin is not re-enforced$/, (ctx) => {
    assert.equal(ctx.bl1283.harness.calls.pin, 0, 'an asleep tick must skip the pin step entirely');
  });

  scoped(/^the previously posted board state is carried forward unchanged$/, (ctx) => {
    // The landed shape short-circuits to the PREVIOUS state object. With no
    // prior board that is undefined, and the tick must still not invent one.
    assert.equal(ctx.bl1283.result.pipelineBoard, undefined);
  });

  scoped(/^the board is synced$/, (ctx) => {
    assert.ok(ctx.bl1283.harness.calls.board > 0, 'an awake tick must sync the board');
  });

  scoped(/^the board pin is enforced$/, (ctx) => {
    assert.ok(ctx.bl1283.harness.calls.pin > 0, 'an awake tick must enforce the pin');
  });

  // qa_e2e (3): the wiring, at the one call site that supplies it.
  scoped(
    /^the front-desk bot wires the pipeline board liveness adapter to the swarm liveness probe for its own target path$/,
    () => {
      const source = git('show', `${HOTFIX}:extension/src/tools/telegram-front-desk-bot.ts`);
      assert.match(
        source,
        /isPipelineBoardAwake:\s*\(\)\s*=>\s*isSwarmLive\(probeSwarmLiveness\(targetPath\)\)/,
        'the front desk must supply liveness from the swarm probe for its own target path'
      );
      // And it is still wired that way at the reviewed tip, not only when it
      // landed - a stamp-off that only reads the commit would miss a later
      // unwiring.
      const current = fs.readFileSync(
        path.join(REPO_ROOT, 'extension', 'src', 'tools', 'telegram-front-desk-bot.ts'),
        'utf8'
      );
      assert.match(current, /isPipelineBoardAwake:\s*\(\)\s*=>\s*isSwarmLive\(probeSwarmLiveness\(targetPath\)\)/);
    }
  );

  scoped(/^the board outcome is "([^"]+)"$/, (ctx, outcome) => {
    const key = `${ctx.bl1283.reality}/${ctx.bl1283.probe}`;
    assert.equal(KNOWN_OUTCOME[key], outcome, `unexpected outcome "${outcome}" for ${key}`);
    const { calls } = ctx.bl1283.harness;
    if (outcome === 'frozen-while-working') {
      // A false "asleep" freezes a board the pack is still changing: stale,
      // but never wrong-by-writing. This is the safer direction to fail in.
      assert.equal(calls.board, 0);
      assert.equal(calls.pin, 0);
    } else {
      // A false "awake" reposts all night against an idle pack - the exact
      // waste the hotfix exists to stop. It costs noise, not correctness.
      assert.ok(calls.board > 0);
    }
  });

  // qa_e2e (5) / scenario 06: REPORT on the allowlist rows. Change nothing.
  scoped(/^each property suite allowlist row added by commit 2b67f4b1a2 names a tracking ticket$/, (ctx) => {
    const diff = git('show', '--format=', '-U0', HOTFIX, '--', 'swarmforge/scripts/property_suite_standing_allowlist.tsv');
    const added = diff
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1));
    assert.equal(added.length, 2, 'the commit added exactly two allowlist rows');
    for (const row of added) {
      assert.match(row, /BL-\d+/, `allowlist row names no tracking ticket: ${row}`);
    }
    // Still present at the reviewed tip, and still attributed.
    const live = fs.readFileSync(ALLOWLIST, 'utf8');
    for (const row of added) {
      const file = row.split('\t')[0];
      assert.ok(live.includes(file), `${file} is no longer allowlisted - this parcel must not have removed it`);
    }
    ctx.bl1283.allowlistRows = added;
  });

  scoped(/^the review records whether that ticket covers the allowlisted file$/, (ctx) => {
    const rows = ctx.bl1283.allowlistRows;
    assert.ok(rows && rows.length === 2);
    // BL-1175 is a MECHANISM ticket - "every standing property failure is
    // either fixed green or explicitly allowlisted with rationale" - and it
    // names neither allowlisted file. It is also already in backlog/done/.
    // So "tracked under BL-1175 pending fix" points at a closed ticket that
    // will never do the fixing. Asserted so the finding cannot rot silently;
    // the ticket forbids acting on it here, and the evidence file states it.
    const ticketPath = path.join(REPO_ROOT, 'backlog', 'done', 'BL-1175-property-suite-standing-reds-block-unrelated-commits.yaml');
    assert.ok(fs.existsSync(ticketPath), 'BL-1175 is expected in backlog/done/ - the finding depends on where it sits');
    const ticket = fs.readFileSync(ticketPath, 'utf8');
    for (const row of rows) {
      const file = path.basename(row.split('\t')[0]);
      assert.ok(
        !ticket.includes(file),
        `BL-1175 names ${file} after all - the recorded finding would be wrong and must be revised`
      );
    }
  });

  // Invariant 2, asserted rather than trusted: green scenarios must leave the
  // ledger row exactly as they found it.
  scoped(/^the hotfix ledger entry for commit 2b67f4b1a2 is still awaiting a human decision$/, (ctx) => {
    assert.equal(ctx.bl1283.reviewGreen, true);
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const entry = ledger.split(/\n(?=\s*-\s)/).find((block) => block.includes(HOTFIX));
    assert.ok(entry, `no hotfix-ledger entry for ${HOTFIX}`);
    assert.match(entry, /state:\s*(pending|awaiting-human|stamp-open)/, `ledger row for ${HOTFIX} is no longer awaiting a human: ${entry}`);
    assert.doesNotMatch(entry, /state:\s*(certified|waived)/);
    // And this parcel did not touch the ledger at all.
    const changed = git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim();
    assert.equal(changed, '', 'a stamp-off must never modify the hotfix ledger');
  });
}

module.exports = { registerSteps };
