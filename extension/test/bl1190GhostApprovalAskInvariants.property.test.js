'use strict';

// BL-1190 declared invariants (coder first authorship - BL-654):
//
// 1. ApprovalRequested never fires unless findTicketFilePath succeeds for
//    the backlog id (mirror BL-582's record path).
// 2. When a backlog id's yaml disappears, its recorded ask reconciles
//    closed/stale - never left as a live, repeat-tappable button.
// 3. Specifier spec-ready handoff is refused when the named paused yaml
//    path is not committed on main.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from unit/coverage/mutation.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { runConciergeTick } = require('../out/concierge/conciergeTick');
const { ticketFileExists } = require('../out/concierge/pendingApprovalFor');
const { reconcileStaleApprovalAsks } = require('../out/tools/telegramFrontDeskBotCore');
const { checkMintDurability, attemptSpecReadyHandoff } = require('../out/concierge/mintDurabilityGate');

function writeTicketYaml(root, folder, filename, id) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `id: ${id}\ntitle: t\nhuman_approval: pending\n`);
}

function noopIconAdapters() {
  return {
    getIconStickers: async () => [],
    setTopicIcon: async () => true,
    readSwarmIconId: () => undefined,
    recordSwarmIconId: () => 'recorded',
  };
}

function conciergeAdapters(root, folders, sent) {
  const state = { snapshot: null, emittedKeys: [] };
  return {
    state,
    readFolders: () => folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => state,
    writeTickState: (s) => {
      state.snapshot = s.snapshot;
      state.emittedKeys = s.emittedKeys;
    },
    ticketFileExists: (backlogId) => ticketFileExists(root, backlogId),
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 1 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => 750,
      sendApprovalAsk: async (topicId, text, buttons) => {
        sent.push({ topicId, text, buttons });
        return { success: true, messageId: 42 + sent.length };
      },
      recordApprovalAskMessageId: () => {},
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 1,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: noopIconAdapters(),
  };
}

// ── Invariant 1: pre-post gate ──────────────────────────────────────────
//
// Non-vacuity (checked by hand): passing `undefined` for `ticketFileExists`
// at the conciergeTick.ts call site (dropping the gate wire) makes `fired`
// true regardless of `yamlExists`, failing this property on the first
// generated yamlExists=false case. Restored, all runs pass.
test('BL-1190 invariant 1: ApprovalRequested fires iff findTicketFilePath succeeds for the backlog id', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1000 }), fc.boolean(), async (n, yamlExists) => {
      const id = `BL-1190-${n}`;
      const root = mkTmpDir('bl1190-inv1-');
      const folders = { active: [], paused: [{ id, title: 'ghost', humanApproval: 'pending' }], done: [] };
      if (yamlExists) {
        writeTicketYaml(root, 'paused', `${id}.yaml`, id);
      }
      const sent = [];
      const adapters = conciergeAdapters(root, folders, sent);

      await runConciergeTick(adapters);

      const firedInSnapshot = (adapters.state.snapshot.pendingApproval || []).includes(id);
      const firedAsAsk = sent.some((m) => m.text.includes(`${id} needs your approval`));
      assert.equal(firedInSnapshot, yamlExists, `pendingApproval membership for ${id} must match yamlExists=${yamlExists}`);
      assert.equal(firedAsAsk, yamlExists, `posted ask for ${id} must match yamlExists=${yamlExists}`);
    }),
    { numRuns: 25 }
  );
});

// ── Invariant 2: stale-ask reconcile ────────────────────────────────────
//
// Non-vacuity (checked by hand): passing `() => true` in place of the real
// `ticketFileExists` binding inside reconcileStaleApprovalAsks's caller
// makes every generated "yaml gone" case fail to close, failing this
// property whenever the array contains at least one `false`. Restored, all
// runs pass.
test('BL-1190 invariant 2: a recorded ask reconciles closed with Stale exactly when its yaml is gone', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), async (existsFlags) => {
      const root = mkTmpDir('bl1190-inv2-');
      const ids = existsFlags.map((_, i) => `BL-${2000 + i}`);
      const askMessages = {};
      existsFlags.forEach((exists, i) => {
        askMessages[ids[i]] = { topicId: 1, messageId: i, text: `${ids[i]} needs your approval...` };
        if (exists) {
          writeTicketYaml(root, 'active', `${ids[i]}.yaml`, ids[i]);
        }
      });
      const closed = [];

      await reconcileStaleApprovalAsks(
        {
          readApprovalAskMessages: () => askMessages,
          ticketFileExists: (backlogId) => ticketFileExists(root, backlogId),
          closeApprovalAsk: async (backlogId, verdict) => {
            closed.push({ backlogId, verdict });
          },
        },
        0
      );

      const closedIds = new Set(closed.map((c) => c.backlogId));
      existsFlags.forEach((exists, i) => {
        assert.equal(closedIds.has(ids[i]), !exists, `${ids[i]} exists=${exists} must close=${!exists}`);
      });
      for (const c of closed) {
        assert.deepEqual(c.verdict, { kind: 'stale' });
      }
    }),
    { numRuns: 25 }
  );
});

// ── Invariant 3: mint durability gate ────────────────────────────────────
//
// Non-vacuity (checked by hand): replacing isFileCommitted's result with a
// constant `true` inside checkMintDurability makes every generated
// committed=false case fail to refuse, failing this property whenever the
// boolean is false. Restored, all runs pass.
test('BL-1190 invariant 3: spec-ready arms the ApprovalRequested path iff the paused yaml is committed', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (committed) => {
      const root = mkTmpDir('bl1190-inv3-');
      copySeededRepoInto(root);
      const rel = 'backlog/paused/BL-1190-slug.yaml';
      fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'id: BL-1190\n');
      if (committed) {
        execFileSync('git', ['-C', root, 'add', '--', rel], { stdio: 'ignore' });
        execFileSync('git', ['-C', root, 'commit', '-m', 'commit paused yaml'], { stdio: 'ignore' });
      }
      let armed = false;

      const result = attemptSpecReadyHandoff(root, rel, () => {
        armed = true;
      });

      assert.equal(result.refused, !committed);
      assert.equal(armed, committed);
      assert.equal(checkMintDurability(root, rel).refused, !committed);
    }),
    { numRuns: 8 }
  );
});
