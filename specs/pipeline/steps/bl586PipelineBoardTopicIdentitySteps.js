'use strict';

// BL-586: step handlers for "pipeline board topic identity is validated on
// every resolve and reuse-or-create".
//
// Every scenario drives the REAL compiled machinery over a real fixture
// root: syncPipelineBoard (extension/out/concierge/pipelineBoardSync) wired
// to the same adapters buildConciergeTickAdapters wires live -
// ensureBoardTopicAdapter over the fixture's own
// .swarmforge/operator/telegram-standing-topic-ids.json and
// telegram-topic-map.json, and readTopicMap reading that same map file. That
// wiring is the point: this ticket's required_wiring exists because a
// collision guard can be green as a pure helper while resolveBoardTopicId's
// trust branch never reaches it (the BL-419 shape), so these handlers assert
// through the live entry point rather than against validateBoardTopic
// directly.
//
// Nothing here touches Telegram. createForumTopic is driven through the
// adapter's own injected postFn seam, which also makes "no new topic is
// minted" a mechanical count rather than an inference.
//
// Invariant 1 (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { syncPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));
const { PIPELINE_BOARD_SUBJECT_ID } = require(path.join(EXT_OUT, 'tools', 'telegramTopicDecisions'));
const { ensureBoardTopicAdapter, readTopicMap } = require(path.join(EXT_OUT, 'tools', 'telegram-front-desk-bot'));

const FEATURE = 'pipeline board topic identity is validated on every resolve and reuse-or-create';

const STANDING_IDS_REL = path.join('.swarmforge', 'operator', 'telegram-standing-topic-ids.json');

// The board topic the 2026-07-23 repair minted by hand, reused here as the
// fixture's durable identity so "re-ensures from the durable standing
// record" has something real to resolve back to.
const STANDING_BOARD_TOPIC_ID = 6795;
// What the fixture's stubbed createForumTopic returns. Deliberately distinct
// from STANDING_BOARD_TOPIC_ID so "reused the durable record" and "minted a
// fresh topic" can never be confused for one another.
const MINTED_TOPIC_ID = 8801;

// Scenario Outline handler rule: each substituted parameter is validated
// against the closed set the feature's own Examples use. A row the handlers
// do not know is a hard failure, never a passthrough - an unknown subject
// would otherwise silently assert nothing.
const KNOWN_CROSSED_TOPIC_IDS = new Set(['14647', '1785', '3864']);
const KNOWN_SUBJECTS = new Set(['SUP-5', 'APPROVALS', 'OPERATOR']);

function writeJson(root, relPath, value) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value));
}

function readStandingIds(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STANDING_IDS_REL), 'utf8'));
  } catch {
    return {};
  }
}

// Board content whose rendered signature differs from `undefined`, so every
// resolve below takes the real resolve-and-post path rather than the
// skipped-unchanged short circuit.
function boardData() {
  return { rows: [], parked: [], collapsedEpics: [], rootIntake: [], recentlyClosed: [], links: [] };
}

// The same adapter set buildConciergeTickAdapters builds live, over the
// fixture root. `calls` records WHICH topic was written into and what the
// durable record held at the instant of the post - the ordering scenario 03
// gates cannot be read off the end state, which is identical either way.
function wireBoard(ctx) {
  const root = ctx.root;
  ctx.calls = { posted: [], created: 0, alerts: [], standingAtPostTime: [] };
  const postFn = async () => {
    ctx.calls.created += 1;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: MINTED_TOPIC_ID } } };
  };
  ctx.adapters = {
    ensureBoardTopic: () => ensureBoardTopicAdapter(root, 'fixture-token', 'fixture-chat', postFn),
    readTopicMap: async () => readTopicMap(root),
    emitCrossedTopicAlert: async (message) => {
      ctx.calls.alerts.push(message);
      return true;
    },
    postMessage: async (topicId) => {
      ctx.calls.posted.push(topicId);
      ctx.calls.standingAtPostTime.push(readStandingIds(root)[PIPELINE_BOARD_SUBJECT_ID]);
      return { messageId: 500 + ctx.calls.posted.length };
    },
    deleteMessage: async () => true,
  };
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

// Every handler body runs through this so a failing assertion can never leak
// the fixture directory (engineering rule: an mkdtemp fixture is removed in a
// finally, never only after the last assertion).
function guarded(ctx, fn, { done = false } = {}) {
  try {
    fn();
  } catch (e) {
    cleanup(ctx);
    throw e;
  }
  if (done) {
    cleanup(ctx);
  }
}

async function guardedAsync(ctx, fn) {
  try {
    await fn();
  } catch (e) {
    cleanup(ctx);
    throw e;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  // A board that has been running has a durable identity already - that is
  // what "wired" means after this ticket. Scenario 03 clears it explicitly;
  // scenarios 02 and 04 restate it explicitly. Only scenario 01 leans on it,
  // and its own Then step reads the value back off disk rather than
  // hard-coding it, so the seed is never the thing being asserted.
  scoped(/^the front-desk pipeline board is wired to a forum-enabled chat$/, (ctx) => {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl586-acc-'));
    guarded(ctx, () => {
      writeJson(ctx.root, STANDING_IDS_REL, {
        APPROVALS: 1785,
        OPERATOR: 3864,
        [PIPELINE_BOARD_SUBJECT_ID]: STANDING_BOARD_TOPIC_ID,
      });
      wireBoard(ctx);
    });
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^the topic map attributes topic id (\d+) to (\S+)$/, (ctx, topicId, subject) => {
    guarded(ctx, () => {
      assert.ok(KNOWN_CROSSED_TOPIC_IDS.has(topicId), `unknown topic id "${topicId}" - the handlers know ${[...KNOWN_CROSSED_TOPIC_IDS]}`);
      assert.ok(KNOWN_SUBJECTS.has(subject), `unknown subject "${subject}" - the handlers know ${[...KNOWN_SUBJECTS]}`);
      assert.notEqual(subject, PIPELINE_BOARD_SUBJECT_ID, 'every row of this outline must name a subject that is NOT the board');
      const map = readTopicMap(ctx.root);
      map[topicId] = subject;
      writeJson(ctx.root, path.join('.swarmforge', 'operator', 'telegram-topic-map.json'), map);
      ctx.crossedTopicId = Number(topicId);
      ctx.crossedSubject = subject;
    });
  });

  scoped(/^the stored pipeline-board topic id is (\d+)$/, (ctx, topicId) => {
    guarded(ctx, () => {
      assert.ok(KNOWN_CROSSED_TOPIC_IDS.has(topicId), `unknown topic id "${topicId}" - the handlers know ${[...KNOWN_CROSSED_TOPIC_IDS]}`);
      ctx.prevState = { topicId: Number(topicId) };
    });
  });

  scoped(/^the pipeline-board tick state holds topic id (\d+) in memory$/, (ctx, topicId) => {
    guarded(ctx, () => {
      ctx.prevState = { topicId: Number(topicId) };
      ctx.crossedTopicId = Number(topicId);
    });
  });

  scoped(/^the standing topic record holds PIPELINE_BOARD as topic id (\d+)$/, (ctx, topicId) => {
    guarded(ctx, () => {
      const standing = readStandingIds(ctx.root);
      standing[PIPELINE_BOARD_SUBJECT_ID] = Number(topicId);
      writeJson(ctx.root, STANDING_IDS_REL, standing);
    });
  });

  scoped(/^the standing topic record holds no PIPELINE_BOARD entry$/, (ctx) => {
    guarded(ctx, () => {
      const standing = readStandingIds(ctx.root);
      delete standing[PIPELINE_BOARD_SUBJECT_ID];
      writeJson(ctx.root, STANDING_IDS_REL, standing);
      assert.equal(readStandingIds(ctx.root)[PIPELINE_BOARD_SUBJECT_ID], undefined);
    });
  });

  scoped(/^the pipeline-board tick state holds no topic id$/, (ctx) => {
    guarded(ctx, () => {
      ctx.prevState = { topicId: undefined };
    });
  });

  // ── Whens ────────────────────────────────────────────────────────────
  // Both phrasings drive the SAME live entry point. "mints a new topic" is
  // the same resolve with nothing durable left to reuse - the mint is an
  // outcome of the resolve, never a separate door into the code.
  const resolveForPost = (ctx) =>
    guardedAsync(ctx, async () => {
      ctx.result = await syncPipelineBoard(boardData(), ctx.prevState, ctx.adapters, 1000);
    });

  scoped(/^the board resolves its topic for a post$/, resolveForPost);
  scoped(/^the board mints a new topic$/, resolveForPost);

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^the board refuses to post into (\d+)$/, (ctx, topicId) => {
    guarded(ctx, () => {
      assert.ok(KNOWN_CROSSED_TOPIC_IDS.has(topicId), `unknown topic id "${topicId}" - the handlers know ${[...KNOWN_CROSSED_TOPIC_IDS]}`);
      assert.equal(
        ctx.calls.posted.includes(Number(topicId)),
        false,
        `the board posted into ${topicId}, which the map attributes to ${ctx.crossedSubject}: ${JSON.stringify(ctx.calls.posted)}`
      );
      // A refusal that posted nowhere at all would satisfy the line above
      // vacuously; the board must still have published its update.
      assert.equal(ctx.calls.posted.length, 1, `the board must still post, elsewhere: ${JSON.stringify(ctx.calls.posted)}`);
    });
  });

  scoped(/^an operator alert naming (\d+) and (\S+) is emitted$/, (ctx, topicId, subject) => {
    guarded(ctx, () => {
      assert.ok(KNOWN_CROSSED_TOPIC_IDS.has(topicId), `unknown topic id "${topicId}"`);
      assert.ok(KNOWN_SUBJECTS.has(subject), `unknown subject "${subject}"`);
      assert.equal(ctx.calls.alerts.length, 1, `exactly one alert must be emitted: ${JSON.stringify(ctx.calls.alerts)}`);
      // Both halves, because "the board topic looks wrong" would have been
      // useless to the human during either incident.
      assert.match(ctx.calls.alerts[0], new RegExp(`\\b${topicId}\\b`));
      assert.match(ctx.calls.alerts[0], new RegExp(subject.replace('-', '\\-')));
    });
  });

  scoped(/^the board re-ensures its topic from the durable standing record$/, (ctx) => {
    guarded(
      ctx,
      () => {
        const durable = readStandingIds(ctx.root)[PIPELINE_BOARD_SUBJECT_ID];
        assert.equal(typeof durable, 'number', 'the fixture must hold a durable board identity to re-ensure from');
        assert.deepEqual(ctx.calls.posted, [durable], `the board must post into the durably recorded topic, not ${JSON.stringify(ctx.calls.posted)}`);
        assert.equal(ctx.result.state.topicId, durable);
        assert.equal(ctx.calls.created, 0, 're-ensuring from a durable record must never mint a topic');
      },
      { done: true }
    );
  });

  scoped(/^the board resolves to topic id (\d+)$/, (ctx, topicId) => {
    guarded(ctx, () => {
      assert.equal(ctx.result.state.topicId, Number(topicId));
      assert.deepEqual(ctx.calls.posted, [Number(topicId)]);
    });
  });

  scoped(/^no new topic is minted$/, (ctx) => {
    guarded(
      ctx,
      () => {
        assert.equal(ctx.calls.created, 0, 'createForumTopic must not be called while the board topic is durably known');
      },
      { done: true }
    );
  });

  scoped(/^topic id (\d+) receives no board post$/, (ctx, topicId) => {
    guarded(
      ctx,
      () => {
        assert.equal(
          ctx.calls.posted.includes(Number(topicId)),
          false,
          `topic ${topicId} received a board post: ${JSON.stringify(ctx.calls.posted)}`
        );
        assert.equal(ctx.calls.posted.length, 1, 'the board must still have posted, in its own topic');
      },
      { done: true }
    );
  });

  // The crash window this ticket names. The END STATE is identical whether
  // the mint is recorded before or after the first post, so this asserts the
  // ORDERING: the adapter's post seam snapshots the standing record at the
  // instant it is called, and a record written afterwards reads as undefined
  // there.
  scoped(/^the minted id is written to the standing topic record before any post is attempted$/, (ctx) => {
    guarded(ctx, () => {
      assert.equal(ctx.calls.created, 1, 'this scenario must actually mint - nothing durable was left to reuse');
      assert.deepEqual(ctx.calls.posted, [MINTED_TOPIC_ID]);
      assert.deepEqual(
        ctx.calls.standingAtPostTime,
        [MINTED_TOPIC_ID],
        'the standing record must already name the minted topic at the instant of the first post'
      );
    });
  });

  scoped(/^the topic map binds the minted id to PIPELINE_BOARD$/, (ctx) => {
    guarded(
      ctx,
      () => {
        assert.equal(readTopicMap(ctx.root)[String(MINTED_TOPIC_ID)], PIPELINE_BOARD_SUBJECT_ID);
      },
      { done: true }
    );
  });
}

module.exports = { registerSteps };
